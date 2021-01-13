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
  extend as ex,
  fs,
  govnSvcVersion as gsv,
  inspect as insp,
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
  O extends PublishCommandHandlerOptions = PublishCommandHandlerOptions,
  C extends PublishCommandHandlerContext = PublishCommandHandlerContext,
> {
  readonly calledFromMetaURL: string;
  readonly calledFromMain: boolean;
  readonly version: string;
  readonly projectHome?: string;
  readonly docoptSpec?: (chsOptions: CommandHandlerSpecOptions) => string;
  readonly customHandlers?: PublishCommandHandler<C>[];
  readonly enhanceHookContext?: (suggested: HookContext<C>) => HookContext<C>;
  readonly prepareOptions?: (
    chsOptions: CommandHandlerSpecOptions,
    cliOptions: docopt.DocOptions,
  ) => O;
  readonly prepareCmdHandlerContext?: (
    options: O,
  ) => C;
}

export function defaultDocoptSpec(
  { version: version }: CommandHandlerSpecOptions,
): string {
  return `
Publication Controller ${version}.

Usage:
  pubctl install [<target>]... [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl validate hooks [<target>]... [--project=<path>] [--hooks=<glob>]... [--dry-run] [--verbose] [--arg=<name>]... [--argv=<value>]...
  pubctl describe [<target>]... [--project=<path>] [--hooks=<glob>]... [--arg=<name>]... [--argv=<value>]...
  pubctl inspect [<target>]... [--project=<path>] [--hooks=<glob>]... [--arg=<name>]... [--argv=<value>]...
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
  DESCRIBE = "describe",
  INSTALL = "install",
  DOCTOR = "doctor",
  BUILD = "build",
  INSPECT = "inspect",
  GENERATE = "generate",
  CLEAN = "clean",
  UPDATE = "update",
}

export interface HookContext<T extends PublishCommandHandlerContext>
  extends
    ex.CommandProxyPluginContext<PublishCommandHandlerContext>,
    insp.InspectionContext {
  readonly onInspectionDiags?: (
    // deno-lint-ignore no-explicit-any
    id: insp.InspectionDiagnostics<any, Error>,
    suggestedCategory?: string,
  ) => void;
}

export function isHookContext<T extends PublishCommandHandlerContext>(
  o: unknown,
): o is HookContext<T> {
  return ex.isCommandProxyPluginContext(o);
}

// deno-lint-ignore require-await
export async function defaultPubCtlHook<
  T extends PublishCommandHandlerContext,
>(hc: HookContext<T>): Promise<ex.DenoFunctionModuleHandlerResult> {
  return defaultPubCtlHookSync(hc);
}

export function defaultPubCtlHookSync<
  T extends PublishCommandHandlerContext,
>(hc: HookContext<T>): ex.DenoFunctionModuleHandlerResult {
  switch (hc.command.proxyCmd) {
    case HookLifecycleStep.INSTALL:
    case HookLifecycleStep.DOCTOR:
      console.log("No external dependencies");
      return defaultPubCtlHookResultEnhancer(hc);

    case HookLifecycleStep.DESCRIBE:
    case HookLifecycleStep.GENERATE:
    case HookLifecycleStep.BUILD:
    case HookLifecycleStep.INSPECT:
    case HookLifecycleStep.CLEAN:
    case HookLifecycleStep.UPDATE:
      console.log(`${hc.command.proxyCmd} not implemented`);
      return defaultPubCtlHookResultEnhancer(hc);
  }

  console.log(`${hc.command.proxyCmd} unknown command`);
  return defaultPubCtlHookResultEnhancer(hc);
}

/**
 * defaultPubCtlHookResultEnhancer should be called by all Deno TypeScript
 * hooks so that we can do centralized "enhancing" of the results of any
 * hook. This allows logging, middleware, and other standard function 
 * handling capabilities.
 * @param dfmhResult 
 */
export function defaultPubCtlHookResultEnhancer<
  T extends PublishCommandHandlerContext,
>(
  hc: HookContext<T>,
  dfmhResult?: ex.DenoFunctionModuleHandlerResult,
): ex.DenoFunctionModuleHandlerResult {
  if (!dfmhResult) return {};
  return dfmhResult;
}

export class PublishCommandHandlerOptions {
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
}

export class PublishCommandHandlerPluginsManager<
  T extends PublishCommandHandlerContext,
> extends ex.fs.CommandProxyFileSystemPluginsManager<T> {
  constructor(
    pchc: T,
    readonly pchOptions: PublishCommandHandlerOptions,
  ) {
    super(
      pchc,
      {},
      {
        discoveryPath: pchOptions.projectHome,
        localFsSources: pchOptions.hooksGlobs,
        shellCmdEnvVarsDefaultPrefix: "PUBCTLHOOK_",
      },
    );
  }

  enhanceShellCmd(
    pc: ex.CommandProxyPluginContext<T>,
    suggestedCmd: string[],
  ): string[] {
    if (!isHookContext(pc)) throw new Error("pc must be HookContext");
    const cmd = [...suggestedCmd];
    cmd.push(pc.command.proxyCmd);
    if (this.pchOptions.targets.length > 0) {
      cmd.push(...this.pchOptions.targets);
    }
    if (this.pchOptions.isVerbose) cmd.push("--verbose");
    if (this.pchOptions.isDryRun) cmd.push("--dry-run");
    for (
      const arg of Object.entries(pc.arguments || this.pchOptions.arguments)
    ) {
      const [name, value] = arg;
      cmd.push(name, value);
    }
    return cmd;
  }

  prepareShellCmdEnvVars(
    pc: ex.CommandProxyPluginContext<T>,
    envVarsPrefix: string,
  ): Record<string, string> {
    const result = super.prepareShellCmdEnvVars(pc, envVarsPrefix);
    if (!isHookContext(pc)) throw new Error("pc must be HookContext");
    if (!ex.fs.isDiscoverFileSystemPluginSource(pc.plugin.source)) {
      throw new Error(
        "pc.plugin.source must be DiscoverFileSystemPluginSource",
      );
    }
    const hookHome = path.dirname(pc.plugin.source.absPathAndFileName);
    result[`${envVarsPrefix}VERBOSE`] = this.pchOptions.isVerbose ? "1" : "0";
    result[`${envVarsPrefix}DRY_RUN`] = this.pchOptions.isDryRun ? "1" : "0";
    result[`${envVarsPrefix}PROJECT_HOME_ABS`] = this.pchOptions.projectHome;
    result[`${envVarsPrefix}PROJECT_HOME_REL`] = path.relative(
      hookHome,
      this.pchOptions.projectHome,
    );
    result[`${envVarsPrefix}OPTIONS_JSON`] = JSON.stringify(
      this.pchOptions.cliOptions,
    );
    if (this.pchOptions.schedule) {
      result[`${envVarsPrefix}SCHEDULE`] = this.pchOptions.schedule;
    }
    if (this.pchOptions.targets.length > 0) {
      result[`${envVarsPrefix}TARGETS`] = this.pchOptions.targets.join(" ");
    }
    const cmdArgs = pc.arguments || this.pchOptions.arguments;
    if (Object.keys(cmdArgs).length > 0) {
      result[`${envVarsPrefix}ARGS_JSON`] = JSON.stringify(cmdArgs);
    }
    return result;
  }
}

export class PublishCommandHandlerContext implements ex.PluginExecutive {
  readonly pluginsMgr: PublishCommandHandlerPluginsManager<
    PublishCommandHandlerContext
  >;
  constructor(readonly options: PublishCommandHandlerOptions) {
    this.pluginsMgr = new PublishCommandHandlerPluginsManager<
      PublishCommandHandlerContext
    >(this, options);
  }

  async init(): Promise<void> {
    await this.pluginsMgr.init();
  }

  reportShellCmd(cmd: string): string {
    if (this.options.isVerbose && !this.options.isDryRun) {
      console.log(colors.brightCyan(cmd));
    }
    return cmd;
  }

  validateHooks(): void {
    for (const glob of this.options.hooksGlobs) {
      console.log(`Searched for hooks in '${colors.yellow(glob)}'`);
    }

    let firstValid = true;
    for (const hook of this.pluginsMgr.plugins) {
      if (firstValid) {
        console.log("--", colors.brightCyan("Registered hooks"), "--");
        firstValid = false;
      }
      const suggestedHookCtx: HookContext<PublishCommandHandlerContext> = {
        container: this,
        plugin: hook,
        command: { proxyCmd: HookLifecycleStep.DOCTOR },
        onActivity: (a: ex.PluginActivity): ex.PluginActivity => {
          if (this.options.isVerbose) {
            console.log(a.message);
          }
          return a;
        },
      };
      const hookCtx = this.options.chsOptions.enhanceHookContext
        ? this.options.chsOptions.enhanceHookContext(suggestedHookCtx)
        : suggestedHookCtx;
      if (ex.isShellExePlugin<PublishCommandHandlerContext>(hook)) {
        if (hook.envVars) {
          console.log(
            colors.yellow(hook.source.friendlyName),
            colors.green(hook.nature.identity),
            colors.blue("will be called with environment variables"),
            hook.envVars(hookCtx),
          );
        } else {
          console.log(
            colors.yellow(hook.source.friendlyName),
            colors.green(hook.nature.identity),
          );
        }
        console.log(colors.dim(hook.shellCmd(hookCtx).join(" ")));
        continue;
      }
      if (ex.isDenoFunctionModulePlugin(hook)) {
        console.log(
          colors.yellow(hook.source.friendlyName),
          colors.green(hook.nature.identity),
          hook.isAsync ? colors.brightBlue("async") : colors.brightBlue("sync"),
        );
      }
    }

    let firstInvalid = true;
    for (const ipr of this.pluginsMgr.invalidPlugins) {
      if (firstInvalid) {
        console.log(
          "--",
          colors.red("Hooks that could not be registered"),
          "--",
        );
        firstInvalid = false;
      }
      console.log(colors.yellow(ipr.source.systemID));
      for (const issue of ipr.issues) {
        console.warn(
          issue.diagnostics.map((d) => colors.red(d.toString())).join("\n"),
        );
      }
    }
  }

  async executeHooks(command: ex.ProxyableCommand): Promise<void> {
    await this.pluginsMgr.execute(command);
  }

  async generateAssets() {
    return await this.executeHooks({ proxyCmd: HookLifecycleStep.GENERATE });
  }

  async build() {
    return await this.executeHooks({ proxyCmd: HookLifecycleStep.BUILD });
  }

  async clean() {
    await this.executeHooks({ proxyCmd: HookLifecycleStep.CLEAN });
    const hugoModClean = this.reportShellCmd(`hugox mod clean --all`);
    await shell.runShellCommand(hugoModClean, {
      ...(this.options.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.options.isDryRun,
    });
    ["go.sum", "public", "resources"].forEach((f) => {
      if (fs.existsSync(f)) {
        if (this.options.isDryRun) {
          console.log("rm -f", colors.red(f));
        } else {
          Deno.removeSync(f, { recursive: true });
          if (this.options.isVerbose) console.log(colors.red(`deleted ${f}`));
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
    const denoModules = this.pluginsMgr.plugins.filter((p) => {
      return ex.isDenoModulePlugin(p) &&
          ex.fs.isFileSystemPluginSource(p.source)
        ? true
        : false;
    }).map((p) => p.source.systemID);
    const updatePkgs = this.reportShellCmd(
      `udd pubctl.ts ${denoModules.join(" ")}`,
    );
    await shell.runShellCommand(updatePkgs, {
      ...(this.options.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.options.isDryRun,
    });
    this.executeHooks({ proxyCmd: HookLifecycleStep.UPDATE });
  }
}

export async function installHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "install": install } = ctx.options.cliOptions;
  if (install) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.INSTALL });
    return true;
  }
}

// deno-lint-ignore require-await
export async function validateHooksHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "validate": validate, "hooks": hooks } = ctx.options.cliOptions;
  if (validate && hooks) {
    ctx.validateHooks();
    return true;
  }
}

export async function inspectHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "inspect": inspect } = ctx.options.cliOptions;
  if (inspect) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.INSPECT });
    return true;
  }
}

export async function describeHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "describe": describe } = ctx.options.cliOptions;
  if (describe) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.DESCRIBE });
    return true;
  }
}

// TODO: merge into `inspect`
// export async function lintHandler(
//   ctx: PublishCommandHandlerContext,
// ): Promise<true | void> {
//   const { "lint": lint, "--cli-suggestions": cliSuggestions } =
//     ctx.options.cliOptions;
//   if (lint) {
//     const results = ctx.lint(ctx.options.projectHome);
//     if (cliSuggestions) {
//       for (const fni of results.fileNameIssues) {
//         for (const diag of fni.diagnostics) {
//           if (diag.correctionLinuxCmd) {
//             console.log(diag.correctionLinuxCmd);
//           }
//         }
//       }
//     } else {
//       for (const fni of results.fileNameIssues) {
//         const relPath = path.relative(ctx.options.projectHome, fni.file.path);
//         console.log(`${colors.yellow(relPath)}:`);
//         for (const diag of fni.diagnostics) {
//           console.log(`    ${colors.red(diag.diagnostic)}`);
//           if (diag.correctionLinuxCmd) {
//             console.log(`    ${colors.green(diag.correctionLinuxCmd)}`);
//           }
//         }
//       }
//     }
//     // TODO: this needs to be integrated into ctx.lint() such that each hook
//     // can "contribute" lint results -- perhaps use github.com/shah/ts-inspect?
//     ctx.executeHooks(HookLifecycleStep.LINT);
//     return true;
//   }
// }

export async function generateHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "generate": generate } = ctx.options.cliOptions;
  if (generate) {
    await ctx.generateAssets();
    return true;
  }
}

export async function buildHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "build": build } = ctx.options.cliOptions;
  if (build) {
    await ctx.build();
    return true;
  }
}

export async function cleanHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "clean": clean } = ctx.options.cliOptions;
  if (clean) {
    await ctx.clean();
    return true;
  }
}

export async function doctorHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "doctor": doctor } = ctx.options.cliOptions;
  if (doctor) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.DOCTOR });
    return true;
  }
}

export async function updateHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "update": update } = ctx.options.cliOptions;
  if (update) {
    await ctx.update();
    return true;
  }
}

export async function versionHandler(
  ctx: PublishCommandHandlerContext,
): Promise<true | void> {
  const { "version": version } = ctx.options.cliOptions;
  if (version) {
    console.log(
      `pubctl ${colors.yellow(ctx.options.chsOptions.version)}`,
    );
    console.log(
      `hugo-aide ${colors.yellow(await determineVersion(import.meta.url))}`,
    );
    return true;
  }
}

export const commonHandlers = [
  describeHandler,
  installHandler,
  validateHooksHandler,
  inspectHandler,
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
  const {
    docoptSpec,
    customHandlers,
    prepareOptions,
    prepareCmdHandlerContext: prepareContext,
  } = chsOptions;
  try {
    const cliOptions = docopt.default(
      docoptSpec ? docoptSpec(chsOptions) : defaultDocoptSpec(chsOptions),
    );
    const pchOptions = prepareOptions
      ? prepareOptions(chsOptions, cliOptions)
      : new PublishCommandHandlerOptions(chsOptions, cliOptions);
    const context = prepareContext
      ? prepareContext(pchOptions)
      : new PublishCommandHandlerContext(pchOptions);
    await context.init();
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
