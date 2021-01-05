/**
 * `publish.ts` provides common functionality that all `pubctl.ts` CLI
 * utilities use in Hugo static sites. When a command is common to all or 
 * most Hugo-based publications, it is implemented in this library. When a
 * command is custom to a specific Hugo-based publication then that 
 * functionality is included in the `pubctl.ts` CLI utility of the specific
 * site/publication.
 */

import {
  colors,
  docopt,
  fs,
  govnSvcVersion as gsv,
  path,
  shell,
} from "./deps.ts";

export function determineVersion(importMetaURL: string): Promise<string> {
  return gsv.determineVersionFromRepoTag(
    importMetaURL,
    { repoIdentity: "shah/hugo-aide" },
  );
}

export interface CommandHandlerSpecOptions<
  T extends PublishCommandHandlerContext = PublishCommandHandlerContext,
> {
  readonly calledFromMetaURL: string;
  readonly calledFromMain: boolean;
  readonly version: string;
  readonly projectHome?: string;
  readonly docoptSpec?: (chsOptions: CommandHandlerSpecOptions) => string;
  readonly customHandlers?: PublishCommandHandler<T>[];
  readonly prepareContext?: (
    chsOptions: CommandHandlerSpecOptions,
    cliOptions: docopt.DocOptions,
  ) => T;
}

export function defaultDocoptSpec(
  { version: version }: CommandHandlerSpecOptions,
): string {
  return `
Publication Controller ${version}.

Usage:
  pubctl inspect hooks
  pubctl lint [--cli-suggestions]
  pubctl prepare-build [--project] [--build-hooks] [--dry-run] [--verbose]
  pubctl build [--project] [--build-hooks] [--dry-run] [--verbose]
  pubctl clean [--dry-run] [--verbose]
  pubctl update [--dry-run] [--verbose]
  pubctl version
  pubctl -h | --help

Options:
  --project        The project's home directory (default Deno.cwd())
  --build-hooks    Deno "prepare-build" modules which will be found and executed (default "**/*/*.hook-publ.ts")
  --dry-run        Show what will be done (but don't actually do it)
  --verbose        Be explicit about what's going on
  -h --help        Show this screen
`;
}

export interface PublishCommandHandler<T extends PublishCommandHandlerContext> {
  (ctx: T): Promise<true | void>;
}

export enum BuildLifecycleStep {
  PREPARE = "prepare",
  FINALIZE = "finalize",
  INSPECT = "inspect",
}

export interface BuildLifecycleHandler<T extends PublishCommandHandlerContext> {
  (ctx: T, step: BuildLifecycleStep): Promise<true | void>;
}

export interface PublishLintFileNameIssueDiagnostic {
  readonly diagnostic: string;
  readonly correctionLinuxCmd?: string;
}

export interface PublishLintFileNameIssue {
  readonly file: fs.WalkEntry;
  readonly diagnostics: PublishLintFileNameIssueDiagnostic[];
}

export interface PublishLintResults {
  readonly fileNameIssues: PublishLintFileNameIssue[];
}

export class PublishCommandHandlerContext {
  readonly projectHome: string;
  readonly buildLifecyleHandlerGlob: string;
  readonly isVerbose: boolean;
  readonly isDryRun: boolean;

  constructor(
    readonly chsOptions: CommandHandlerSpecOptions,
    readonly cliOptions: docopt.DocOptions,
  ) {
    const {
      "--project": projectHome,
      "--build-hooks": prepBuildGlob,
      "--verbose": verbose,
      "--dry-run": dryRun,
    } = this.cliOptions;
    this.projectHome = projectHome
      ? projectHome as string
      : (chsOptions.projectHome || Deno.cwd());
    this.buildLifecyleHandlerGlob = prepBuildGlob
      ? prepBuildGlob as string
      : "**/*/*.hook-pubctl.ts";
    this.isDryRun = dryRun ? true : false;
    this.isVerbose = this.isDryRun || (verbose ? true : false);
  }

  reportShellCmd(cmd: string): string {
    if (this.isVerbose && !this.isDryRun) {
      console.log(colors.brightCyan(cmd));
    }
    return cmd;
  }

  async inspectHooks(): Promise<void> {
    for (const we of fs.expandGlobSync(this.buildLifecyleHandlerGlob)) {
      if (we.isFile) {
        const prepModuleName = path.relative(this.projectHome, we.path);
        try {
          // the hugo-aide package is going to be URL-imported but the files
          // we're importing are local to the calling pubctl.ts in the project
          // so we need to use absolute paths
          const module = await import(
            path.toFileUrl(we.path).toString()
          );
          if (module) {
            if (typeof module.default === "function") {
              const isAsync =
                module.default.constructor.name === "AsyncFunction";
              console.log(
                colors.yellow(prepModuleName),
                colors.green("valid"),
                isAsync
                  ? colors.brightBlue("async")
                  : colors.brightBlue("sync"),
              );
              if (isAsync) {
                await module.default(this, BuildLifecycleStep.INSPECT);
              } else {
                module.default(this, BuildLifecycleStep.INSPECT);
              }
            } else {
              console.log(
                colors.yellow(prepModuleName),
                colors.brightRed(`invalid: does not have a default function`),
              );
            }
          } else {
            console.log(
              colors.yellow(prepModuleName),
              colors.brightRed(`invalid: unable to import module`),
            );
          }
        } catch (err) {
          console.log(colors.brightRed(prepModuleName));
          console.log(err);
        }
      }
    }
  }

  getBuildHookModuleRelNames(): string[] {
    const result = [];
    for (const we of fs.expandGlobSync(this.buildLifecyleHandlerGlob)) {
      if (we.isFile) {
        const prepModuleName = path.relative(this.projectHome, we.path);
        result.push(prepModuleName);
      }
    }
    return result;
  }

  /**
   * Finds and executes build hooks. Hooks are Deno modules that are 
   * dynamically imported and then "executed" by calling the default 
   * function.
   * 
   * Here's what an example hook looks like:
   * ---------------------------------------
   * import * as haPublish from "https://denopkg.com/shah/hugo-aide@v0.2.5/publish.ts";
   * export async function buildHook(
   *   ctx: haPublish.PublishCommandHandlerContext,
   *   step: haPublish.BuildLifecycleStep,
   * ): Promise<true | void> {
   *   console.log(step, "in", import.meta.url, ctx);
   * }
   * export default buildHook;
   * @param step The build lifecylce being executed
   */
  async handleProjectBuildHooks(
    step: BuildLifecycleStep,
  ): Promise<string[]> {
    const result = [];
    for (const we of fs.expandGlobSync(this.buildLifecyleHandlerGlob)) {
      if (we.isFile) {
        const prepModuleName = path.relative(this.projectHome, we.path);
        try {
          // the hugo-aide package is going to be URL-imported but the files
          // we're importing are local to the calling pubctl.ts in the project
          // so we need to use absolute paths
          const module = await import(
            path.toFileUrl(we.path).toString()
          );
          if (this.isDryRun || this.isVerbose) {
            console.log(
              step,
              colors.yellow(prepModuleName),
              module ? colors.green("imported") : colors.red("not imported"),
            );
          }
          if (!this.isDryRun) {
            if (typeof module.default === "function") {
              const handler = module.default as BuildLifecycleHandler<
                PublishCommandHandlerContext
              >;
              const isAsync = handler.constructor.name === "AsyncFunction";
              if (isAsync) {
                await handler(this, step);
              } else {
                handler(this, step);
              }
              if (this.isVerbose) {
                console.log(
                  step,
                  colors.yellow(prepModuleName),
                  colors.green("executed"),
                );
              }
            } else {
              console.log(
                colors.brightRed(
                  `${prepModuleName} does not have a default function`,
                ),
              );
            }
          }
        } catch (err) {
          console.log(colors.brightRed(prepModuleName));
          console.log(err);
        }
        result.push(prepModuleName);
      }
    }
    return result;
  }

  async prepareBuild(): Promise<string[]> {
    return await this.handleProjectBuildHooks(
      BuildLifecycleStep.PREPARE,
    );
  }

  async build() {
    await this.prepareBuild();
    const updatePkgs = this.reportShellCmd(`hugox`);
    await shell.runShellCommand(updatePkgs, {
      ...(this.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.isDryRun,
    });
    await this.finalizeBuild();
  }

  async finalizeBuild() {
    await this.handleProjectBuildHooks(
      BuildLifecycleStep.FINALIZE,
    );
  }

  async clean() {
    const hugoModClean = this.reportShellCmd(`hugox mod clean --all`);
    await shell.runShellCommand(hugoModClean, {
      ...(this.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.isDryRun,
    });
    ["go.sum", "public", "resources"].forEach((f) => {
      if (fs.existsSync(f)) {
        if (this.isDryRun) {
          console.log("delete", colors.red(f));
        } else {
          Deno.removeSync(f, { recursive: true });
          if (this.isVerbose) console.log(colors.red(`deleted ${f}`));
        }
      }
    });
  }

  /** 
   * Update the pubctl.ts that uses this library so that it's using the latest
   * version(s) of all dependencies. This requires the [udd](https://github.com/hayd/deno-udd) 
   * library to be present in the PATH.
   */
  async update() {
    const updatePkgs = this.reportShellCmd(
      `udd pubctl.ts ${this.getBuildHookModuleRelNames().join(" ")}`,
    );
    await shell.runShellCommand(updatePkgs, {
      ...(this.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.isDryRun,
    });
  }

  suggestFileName(source: string): string {
    return source.trim().replaceAll(/ +/g, "-").toLocaleLowerCase();
  }

  lint(root: string): PublishLintResults {
    const result: PublishLintResults = {
      fileNameIssues: [],
    };
    for (const we of fs.walkSync(root, { skip: [/\.git/, /README.md/] })) {
      const dirName = path.relative(this.projectHome, path.dirname(we.path));
      let issue: PublishLintFileNameIssue;
      const addIssue = (suggestedCmd: string, diagnostic: string) => {
        if (!issue) {
          issue = {
            file: we,
            diagnostics: [],
          };
          result.fileNameIssues.push(issue);
        }
        issue.diagnostics.push(
          { diagnostic: diagnostic, correctionLinuxCmd: suggestedCmd },
        );
      };

      if (we.name.includes(" ")) {
        addIssue(
          `(cd ${dirName}; mv "${we.name}" ${this.suggestFileName(we.name)})`,
          `should be renamed because it has spaces (replace all spaces with hyphens '-')`,
        );
      }

      if (we.name != we.name.toLocaleLowerCase()) {
        addIssue(
          `(cd ${dirName}; mv "${we.name}" ${this.suggestFileName(we.name)})`,
          `should be renamed because it has mixed case letters (all text should be lowercase only)`,
        );
      }
    }
    return result;
  }
}

export async function inspectHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "inspect": inspect, "hooks": hooks } = ctx.cliOptions;
  if (inspect && hooks) {
    await ctx.inspectHooks();
    return true;
  }
}

// deno-lint-ignore require-await
export async function lintHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "lint": lint, "--cli-suggestions": cliSuggestions } = ctx.cliOptions;
  if (lint) {
    const results = ctx.lint(ctx.projectHome);
    if (cliSuggestions) {
      for (const fni of results.fileNameIssues) {
        for (const diag of fni.diagnostics) {
          if (diag.correctionLinuxCmd) {
            console.log(diag.correctionLinuxCmd);
          }
        }
      }
    } else {
      for (const fni of results.fileNameIssues) {
        const relPath = path.relative(ctx.projectHome, fni.file.path);
        console.log(`${colors.yellow(relPath)}:`);
        for (const diag of fni.diagnostics) {
          console.log(`    ${colors.red(diag.diagnostic)}`);
          if (diag.correctionLinuxCmd) {
            console.log(`    ${colors.green(diag.correctionLinuxCmd)}`);
          }
        }
      }
    }
    return true;
  }
}

export async function prepareBuildHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "prepare-build": auto } = ctx.cliOptions;
  if (auto) {
    await ctx.prepareBuild();
    return true;
  }
}

export async function buildHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "build": build } = ctx.cliOptions;
  if (build) {
    await ctx.build();
    return true;
  }
}

export async function cleanHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "clean": clean } = ctx.cliOptions;
  if (clean) {
    await ctx.clean();
    return true;
  }
}

export async function updateHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "update": update } = ctx.cliOptions;
  if (update) {
    await ctx.update();
    return true;
  }
}

export async function versionHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "version": version } = ctx.cliOptions;
  if (version) {
    console.log(
      `pubctl ${colors.yellow(ctx.chsOptions.version)}`,
    );
    console.log(
      `hugo-aide ${colors.yellow(await determineVersion(import.meta.url))}`,
    );
    return true;
  }
}

export const commonHandlers = [
  inspectHandler,
  lintHandler,
  prepareBuildHandler,
  buildHandler,
  cleanHandler,
  updateHandler,
  versionHandler,
];

export async function CLI(
  chsOptions: CommandHandlerSpecOptions,
): Promise<void> {
  const { docoptSpec, customHandlers, prepareContext } = chsOptions;
  try {
    const cliOptions = docopt.default(
      docoptSpec ? docoptSpec(chsOptions) : defaultDocoptSpec(chsOptions),
    );
    const context = prepareContext
      ? prepareContext(chsOptions, cliOptions)
      : new PublishCommandHandlerContext(chsOptions, cliOptions);
    let handled: true | void;
    if (customHandlers) {
      for (const handler of customHandlers) {
        handled = await handler(context);
        if (handled) break;
      }
    }
    for (const handler of commonHandlers) {
      handled = await handler(context);
      if (handled) break;
    }
    if (!handled) {
      console.error("Unable to handle validly parsed docoptSpec:");
      console.dir(cliOptions);
    }
  } catch (e) {
    console.error(e.message);
  }
}

// All `pubctl.ts` files should have something like this as part of their main
// entry point:
// ---------------------------------------------------------------------------
// if (import.meta.main) {
//   await haPublish.CLI({
//     calledFromMain: import.meta.main,
//     calledFromMetaURL: import.meta.url,
//     version: "v0.1.0",
//   });
// }
