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
  pubctl validate hooks [<target>]... [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl inspect [<target>]... [--project=<path>] [--hooks=<glob>]... [--arg=<name>]... [--argv=<value>]...
  pubctl lint [<target>]... [--project=<path>] [--cli-suggestions] [--hooks=<glob>]... [--arg=<name>]... [--argv=<value>]...
  pubctl build [<target>]... [--schedule=<cronSpec>] [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl generate [<target>]... [--schedule=<cronSpec>] [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl clean [<target>]... [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl doctor [<target>]... [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl update [<target>]... [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl version
  pubctl -h | --help

Options:
  <target>               One or more identifiers that the hook will understand
  --schedule=CRONSPEC    Cron spec for schedule [default: * * * * *]
  --project=PATH         The project's home directory, defaults to current directory
  --hooks=GLOB           Glob of hooks which will be found and executed [default: **/*/*.hook-pubctl.*]
  --dry-run              Show what will be done (but don't actually do it) [default: false]
  --verbose              Be explicit about what's going on [default: false]
  --arg=NAME             Name of an arbitrary argument to pass to handler
  --argv=VALUE           Value of an arbitrary argument to pass to handler, must match same order as --arg
  -h --help              Show this screen
`;
}

export interface PublishCommandHandler<T extends PublishCommandHandlerContext> {
  (ctx: T): Promise<true | void>;
}

export enum HookLifecycleStep {
  DOCTOR = "doctor",
  LINT = "lint",
  BUILD = "build",
  INSPECT = "inspect",
  GENERATE = "generate",
  CLEAN = "clean",
  UPDATE = "update",
}

export interface HookModuleContext {
  readonly name: string;
  readonly absPathOnly: string;
  readonly absPathAndName: string;
  readonly pathRelToProject: string;
  readonly pathRelToCwd: string;
}

export interface HookHandler<T extends PublishCommandHandlerContext> {
  (
    step: HookLifecycleStep,
    hookModuleCtx: HookModuleContext,
    pubCtlCtx: T,
  ): Promise<true | void> | true | void;
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
  readonly hooksGlobs: string[];
  readonly targets: string[];
  readonly arguments: Record<string, string> = {};
  readonly schedule?: string;
  readonly isVerbose: boolean;
  readonly isDryRun: boolean;

  constructor(
    readonly chsOptions: CommandHandlerSpecOptions,
    readonly cliOptions: docopt.DocOptions,
  ) {
    const {
      "--project": projectHome,
      "--hooks": hooksGlob,
      "--verbose": verbose,
      "--dry-run": dryRun,
      "--schedule": schedule,
      "<target>": targets,
      "--arg": argNames,
      "--argv": argsValues,
    } = this.cliOptions;
    this.projectHome = projectHome
      ? projectHome as string
      : (chsOptions.projectHome || Deno.cwd());
    this.hooksGlobs = hooksGlob as string[];
    this.targets = targets as string[];
    this.schedule = schedule ? schedule.toString() : undefined;
    this.isDryRun = dryRun ? true : false;
    this.isVerbose = this.isDryRun || (verbose ? true : false);

    if (argNames) {
      const an = argNames as string[];
      const av = argsValues as string[];

      if (an.length == av.length) {
        for (let i = 0; i < an.length; i++) {
          const key = an[i];
          const value = av[i];
          this.arguments[key] = value;
        }
      } else {
        console.error(
          colors.brightRed("--arg and --argv must be balanced") + ": ",
          `there are ${colors.yellow(an.length.toString())} arg names and ${
            colors.yellow(av.length.toString())
          } values`,
        );
      }
    }
  }

  reportShellCmd(cmd: string): string {
    if (this.isVerbose && !this.isDryRun) {
      console.log(colors.brightCyan(cmd));
    }
    return cmd;
  }

  isExecutable(path: string, step?: HookLifecycleStep): false | string[] {
    const fi = Deno.statSync(path);
    const isExe = fi.mode != null ? (fi.mode & 0o0001 ? true : false) : true;
    if (isExe) {
      const cmd = ["/bin/sh", "-c", path];
      if (step) cmd.push(step);
      if (this.targets.length > 0) cmd.push(...this.targets);
      if (this.isVerbose) cmd.push("--verbose");
      if (this.isDryRun) cmd.push("--dry-run");
      for (const arg of Object.entries(this.arguments)) {
        const [name, value] = arg;
        cmd.push(name, value);
      }
      return cmd;
    }
    return false;
  }

  subprocessEnvVars(
    hookAbsPath: string,
    step?: HookLifecycleStep,
    addEnvVars?: Record<string, string>,
  ): Record<string, string> {
    const hookHome = path.dirname(hookAbsPath);
    const result: Record<string, string> = {
      PUBCTLHOOK_LIFECYLE_STEP: step || "validate",
      PUBCTLHOOK_VERBOSE: this.isVerbose ? "1" : "0",
      PUBCTLHOOK_DRY_RUN: this.isDryRun ? "1" : "0",
      PUBCTLHOOK_HOME_ABS: hookHome,
      PUBCTLHOOK_HOME_REL: path.relative(this.projectHome, hookHome),
      PUBCTLHOOK_NAME: path.basename(hookAbsPath),
      PUBCTLHOOK_PROJECT_HOME_ABS: this.projectHome,
      PUBCTLHOOK_PROJECT_HOME_REL: path.relative(hookHome, this.projectHome),
      PUBCTLHOOK_CLI_OPTIONS_JSON: JSON.stringify(this.cliOptions),
    };
    if (this.schedule) result.PUBCTLHOOK_SCHEDULE = this.schedule;
    if (this.targets.length > 0) {
      result.PUBCTLHOOK_TARGETS = this.targets.join(" ");
    }
    if (Object.keys(this.arguments).length > 0) {
      result.PUBCTLHOOK_ARGS_JSON = JSON.stringify(this.arguments);
    }
    if (addEnvVars) {
      return { ...result, ...addEnvVars };
    }
    return result;
  }

  async validateHooks(): Promise<void> {
    for (const glob of this.hooksGlobs) {
      console.log(`Hooks with glob '${colors.brightCyan(glob)}':`);
      for (const we of fs.expandGlobSync(glob)) {
        if (we.isFile) {
          const prepModuleName = path.relative(this.projectHome, we.path);

          if (path.extname(we.name) != ".ts") {
            const exeCmd = this.isExecutable(we.path);
            if (exeCmd) {
              console.log(
                colors.yellow(prepModuleName),
                colors.green("executable"),
                colors.blue("will be called with environment variables"),
                this.subprocessEnvVars(we.path),
              );
              console.log(colors.dim(exeCmd.join(" ")));
            } else {
              console.log(
                colors.yellow(prepModuleName),
                colors.brightRed("not executable"),
              );
            }
            continue;
          }

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
                  colors.green("TypeScript valid Deno hook"),
                  isAsync
                    ? colors.brightBlue("async")
                    : colors.brightBlue("sync"),
                );
              } else {
                console.log(
                  colors.yellow(prepModuleName),
                  colors.brightRed(
                    `invalid TypeScript Deno hook: does not have a default function`,
                  ),
                );
              }
            } else {
              console.log(
                colors.yellow(prepModuleName),
                colors.brightRed(
                  `invalid TypeScript Deno hook: unable to import module`,
                ),
              );
            }
          } catch (err) {
            console.log(colors.brightRed(prepModuleName));
            console.log(err);
          }
        }
      }
    }
  }

  getHookModuleRelNames(): string[] {
    const result = [];
    for (const glob of this.hooksGlobs) {
      for (const we of fs.expandGlobSync(glob)) {
        if (we.isFile) {
          const prepModuleName = path.relative(this.projectHome, we.path);
          result.push(prepModuleName);
        }
      }
    }
    return result;
  }

  /**
   * Finds and executes hooks. Hooks are either executable shell scripts
   * or Deno modules that are dynamically imported and then "executed" by 
   * calling the default function.
   * 
   * Here's what an example hook looks like in Deno TypeScript:
   * ---------------------------------------------------------
   * import * as haPublish from "https://denopkg.com/shah/hugo-aide@v0.2.5/publish.ts";
   * export async function buildHook(
   *   ctx: haPublish.PublishCommandHandlerContext,
   *   step: haPublish.BuildLifecycleStep,
   * ): Promise<false | number | void> {
   *   console.log(step, "in", import.meta.url, ctx);
   * }
   * export default buildHook;
   * @param step The build lifecylce being executed
   */
  async handleHooks(step: HookLifecycleStep): Promise<string[]> {
    const result = [];
    for (const glob of this.hooksGlobs) {
      for (const we of fs.expandGlobSync(glob)) {
        if (we.isFile) {
          const prepModuleName = path.relative(this.projectHome, we.path);
          const env = this.subprocessEnvVars(we.path, step);

          if (path.extname(we.name) != ".ts") {
            if (this.isExecutable(we.path)) {
              const blockHeader =
                (): shell.CliVerboseShellBlockHeaderResult => {
                  return {
                    headerText: `${prepModuleName}`,
                    separatorText: "",
                  };
                };

              const cmd = [
                "/bin/sh",
                "-c",
                ...shell.commandComponents(we.path),
                step,
              ];
              for (const arg of Object.entries(this.arguments)) {
                const [name, value] = arg;
                cmd.push(name, value);
              }
              await shell.runShellCommand(
                {
                  cmd: cmd,
                  cwd: path.dirname(we.path),
                  env: env,
                },
                {
                  // the subprocess is responsible for checking verbose/dry-run
                  ...shell.cliVerboseShellBlockOutputOptions(blockHeader),
                },
              );
            } else {
              console.log(
                colors.yellow(prepModuleName),
                colors.brightRed("not executable"),
              );
            }
            continue;
          }

          console.log(colors.yellow(path.relative(this.projectHome, we.path)));
          try {
            // the hugo-aide package is going to be URL-imported but the files
            // we're importing are local to the calling pubctl.ts in the project
            // so we need to use absolute paths
            const module = await import(
              path.toFileUrl(we.path).toString()
            );
            if (this.isVerbose) {
              console.log(
                step,
                colors.yellow(prepModuleName),
                module ? colors.green("imported") : colors.red("not imported"),
              );
            }
            if (typeof module.default === "function") {
              const handler = module.default as HookHandler<
                PublishCommandHandlerContext
              >;
              const isAsync = handler.constructor.name === "AsyncFunction";
              const hmCtx: HookModuleContext = {
                name: we.name,
                absPathOnly: path.dirname(we.path),
                absPathAndName: we.path,
                pathRelToProject: path.relative(this.projectHome, we.path),
                pathRelToCwd: path.relative(Deno.cwd(), we.path),
              };
              if (isAsync) {
                await handler(step, hmCtx, this);
              } else {
                handler(step, hmCtx, this);
              }
              if (this.isVerbose) {
                console.log(
                  step,
                  colors.yellow(prepModuleName),
                  colors.green("executed"),
                  colors.blue(isAsync ? "(async)" : "(sync)"),
                );
              }
            } else {
              console.log(
                colors.brightRed(
                  `${prepModuleName} does not have a default function`,
                ),
              );
            }
          } catch (err) {
            console.log(colors.brightRed(prepModuleName));
            console.log(err);
          }
          result.push(prepModuleName);
        }
      }
    }
    return result;
  }

  async generateAssets(): Promise<string[]> {
    return await this.handleHooks(HookLifecycleStep.GENERATE);
  }

  async build() {
    return await this.handleHooks(HookLifecycleStep.BUILD);
  }

  async clean() {
    this.handleHooks(HookLifecycleStep.CLEAN);
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
      `udd pubctl.ts ${this.getHookModuleRelNames().join(" ")}`,
    );
    await shell.runShellCommand(updatePkgs, {
      ...(this.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.isDryRun,
    });
    this.handleHooks(HookLifecycleStep.UPDATE);
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

export async function validateHooksHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "validate": validate, "hooks": hooks } = ctx.cliOptions;
  if (validate && hooks) {
    await ctx.validateHooks();
    return true;
  }
}

export async function inspectHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "inspect": inspect } = ctx.cliOptions;
  if (inspect) {
    await ctx.handleHooks(HookLifecycleStep.INSPECT);
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
    ctx.handleHooks(HookLifecycleStep.LINT);
    return true;
  }
}

export async function generateHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "generate": generate } = ctx.cliOptions;
  if (generate) {
    await ctx.generateAssets();
    return true;
  }
}

export async function buildHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "build": build, "<target>": targets } = ctx.cliOptions;
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

export async function doctorHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "doctor": doctor } = ctx.cliOptions;
  if (doctor) {
    await ctx.handleHooks(HookLifecycleStep.DOCTOR);
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
  validateHooksHandler,
  inspectHandler,
  lintHandler,
  buildHandler,
  generateHandler,
  cleanHandler,
  doctorHandler,
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
