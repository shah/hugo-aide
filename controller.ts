/**
 * `publish.ts` provides common functionality that all `pubctl.ts` CLI
 * utilities use in Hugo static sites. When a command is common to all or 
 * most Hugo-based publications, it is implemented in this library. When a
 * command is custom to a specific Hugo-based publication then that 
 * functionality is included in the `pubctl.ts` CLI utility of the specific
 * site/publication.
 */

import {
  artfPersist as ap,
  artfPersistDoc as apd,
  colors,
  contextMgr as cm,
  docopt,
  extend as ex,
  fs,
  govnSvcVersion as gsv,
  inflect,
  inspect as insp,
  path,
  safety,
  shell,
  valueMgr as vm,
} from "./deps.ts";
import * as hugo from "./hugo-config.ts";
import * as p from "./publication.ts";

export function determineVersion(importMetaURL: string): Promise<string> {
  return gsv.determineVersionFromRepoTag(
    importMetaURL,
    { repoIdentity: "shah/hugo-aide" },
  );
}

export interface CommandHandlerCaller {
  readonly calledFromMetaURL: string;
  readonly calledFromMain: boolean;
  readonly version: string;
  readonly projectHome?: string;
}

export function defaultDocoptSpec(caller: CommandHandlerCaller): string {
  const targetable = "[<target>]...";
  const schedulable = "--schedule=<cronSpec>";
  const paths = `[--project=<path>] [--union-home=<path>]`;
  const hookable = `[--hooks=<glob>]...`;
  const observable = "[--verbose] [--dry-run]";
  const customizable = `[--arg=<name>]... [--argv=<value>]...`;
  const stdArgs =
    `${targetable} ${paths} ${hookable} ${observable} ${customizable}`;
  return `
Publication Orchestrator ${caller.version}.

Usage:
  pubctl init workspace ${stdArgs}
  pubctl hugo init ${targetable} --publ=<publ-id> [--module=<module-id>]... [--dest=<dest>] ${paths} ${hookable} ${observable} ${customizable}
  pubctl hugo inspect ${targetable} ${paths} ${hookable} ${customizable}
  pubctl hugo clean ${targetable} ${paths} ${hookable} ${customizable}
  pubctl install ${stdArgs}
  pubctl validate hooks ${stdArgs}
  pubctl describe ${targetable} ${paths} ${hookable} ${customizable}
  pubctl inspect (publications | publishable-modules | ${targetable}) ${paths} ${hookable} ${customizable}
  pubctl build ${targetable} ${schedulable} ${paths} ${hookable} ${observable} ${customizable}
  pubctl generate ${targetable} ${schedulable} ${paths} ${hookable} ${observable} ${customizable}
  pubctl clean ${stdArgs}
  pubctl doctor ${stdArgs}
  pubctl update ${stdArgs}
  pubctl version
  pubctl -h | --help

Options:
  <target>                 One or more identifiers that the hook will understand
  --union-home=PATH        The path where workspace dependencies will be stored and 'union'ed into the publication [default: union]
  --publ-id=PUBLICATION    A publication configuration supplier name [default: sandbox]
  --module=MODULE          One or more Hugo module identifiers that should be included in the init or configure process
  --schedule=CRONSPEC      Cron spec for schedule [default: * * * * *]
  --project=PATH           The project's home directory, defaults to current directory [default: .]
  --hooks=GLOB             Glob of hooks which will be found and executed [default: {content,data,static}/**/*.hook-pubctl.*]
  --dry-run                Show what will be done (but don't actually do it) [default: false]
  --verbose                Be explicit about what's going on [default: false]
  --arg=NAME               Name of an arbitrary argument to pass to handler
  --argv=VALUE             Value of an arbitrary argument to pass to handler, must match same order as --arg
  -h --help                Show this screen
`;
}

export interface PublicationsControllerCommandHandler<
  PC extends PublicationsController,
> {
  (ctx: PC): Promise<true | void>;
}

export enum HookLifecycleStep {
  HUGO_INIT = "hugo-init",
  HUGO_INSPECT = "hugo-inspect",
  HUGO_CLEAN = "hugo-clean",
  INSTALL = "install",
  UNINSTALL = "uninstall",
  DOCTOR = "doctor",
  DESCRIBE = "describe",
  INSPECT = "inspect",
  GENERATE = "generate",
  BUILD = "build",
  CLEAN = "clean",
  UPDATE = "update",
}

export interface HugoPublProxyableCommand<O> extends ex.ProxyableCommand {
  readonly publ: hugo.HugoPublication<O>;
}

export function isHugoPublProxyableCommand<O>(
  o: unknown,
): o is HugoPublProxyableCommand<O> {
  const isHugoPublProxyableCommand = safety.typeGuard<
    HugoPublProxyableCommand<O>
  >("proxyCmd", "publ");
  return isHugoPublProxyableCommand(o);
}

export function hugoPublProxyableCommand<O>(
  step: HookLifecycleStep,
  publ: hugo.HugoPublication<O>,
): HugoPublProxyableCommand<O> {
  return {
    proxyCmd: step.toString(),
    publ,
  };
}

export interface HookContext<PC extends PublicationsController>
  extends ex.CommandProxyPluginContext<PC>, insp.InspectionContext, cm.Context {
  readonly pluginPathRelativeToProjectHome: string;
  readonly createMutableTextArtifact: (
    options: ap.MutableTextArtifactOptions,
  ) => ap.MutableTextArtifact;
  readonly persistMarkdownArtifact: (
    artifactName: vm.TextValue,
    artifact: apd.MarkdownArtifact,
    options?: ap.PersistArtifactOptions,
  ) => ap.PersistenceResult | undefined;
  readonly persistExecutableScriptArtifact: (
    artifactName: vm.TextValue,
    artifact: ap.TextArtifact,
    options?: ap.PersistArtifactOptions,
  ) => ap.PersistenceResult | undefined;
  readonly persistTextArtifact: (
    artifactName: vm.TextValue,
    artifact: ap.TextArtifact,
    options?: ap.PersistArtifactOptions,
  ) => ap.PersistenceResult | undefined;
  readonly onInspectionDiags?: (
    // deno-lint-ignore no-explicit-any
    id: insp.InspectionDiagnostics<any, Error>,
    suggestedCategory?: string,
  ) => void;
}

export function isHookContext<PC extends PublicationsController>(
  o: unknown,
): o is HookContext<PC> {
  if (!ex.isCommandProxyPluginContext(o)) return false;
  const isHookCtx = safety.typeGuard<HookContext<PC>>("persistTextArtifact");
  return isHookCtx(o);
}

// deno-lint-ignore require-await
export async function defaultPubCtlHook<
  PC extends PublicationsController,
>(hc: HookContext<PC>): Promise<ex.DenoFunctionModuleHandlerResult> {
  return defaultPubCtlHookSync(hc);
}

export function defaultPubCtlHookSync<
  PC extends PublicationsController,
>(hc: HookContext<PC>): ex.DenoFunctionModuleHandlerResult {
  switch (hc.command.proxyCmd) {
    case HookLifecycleStep.INSTALL:
    case HookLifecycleStep.DOCTOR:
      if (hc.container.pco.isVerbose) {
        console.log(
          colors.dim(`[${hc.plugin.source.abbreviatedName}]`),
          `No external dependencies in`,
          colors.cyan(hc.plugin.source.friendlyName),
        );
      }
      return defaultPubCtlHookResultEnhancer(hc);

    case HookLifecycleStep.HUGO_INIT:
    case HookLifecycleStep.HUGO_INSPECT:
    case HookLifecycleStep.HUGO_CLEAN:
    case HookLifecycleStep.DESCRIBE:
    case HookLifecycleStep.GENERATE:
    case HookLifecycleStep.BUILD:
    case HookLifecycleStep.INSPECT:
    case HookLifecycleStep.CLEAN:
    case HookLifecycleStep.UPDATE:
      if (hc.container.pco.isVerbose) {
        console.log(
          colors.dim(`[${hc.plugin.source.abbreviatedName}]`),
          `command '${colors.yellow(hc.command.proxyCmd)}' not implemented in`,
          colors.cyan(hc.plugin.source.friendlyName),
        );
      }
      return defaultPubCtlHookResultEnhancer(hc);
  }

  if (hc.container.pco.isVerbose) {
    console.log(
      colors.dim(`[${hc.plugin.source.abbreviatedName}]`),
      `unknown command '${colors.yellow(hc.command.proxyCmd)}' in ${
        colors.cyan(hc.plugin.source.friendlyName)
      }`,
    );
  }
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
  PC extends PublicationsController,
>(
  hc: HookContext<PC>,
  dfmhResult?: ex.DenoFunctionModuleHandlerResult,
): ex.DenoFunctionModuleHandlerResult {
  if (!dfmhResult) return {};
  return dfmhResult;
}

export interface CliArgsSupplier {
  readonly cliArgs: docopt.DocOptions;
}

export interface PublicationsControllerOptions {
  readonly projectHome: string;
  readonly unionHome: string;
  readonly htmlDestHome: string;
  readonly hooksGlobs: string[];
  readonly targets: string[];
  readonly arguments: Record<string, string>;
  readonly schedule?: string;
  readonly isVerbose: boolean;
  readonly isDryRun: boolean;
  readonly buildHostID: string;
  readonly customModules: p.PublicationModuleIdentity[];
  readonly observabilitySrcHome: string;
  readonly observabilityHtmlDestHome: string;
}

export function publicationsControllerOptions(
  caller: CommandHandlerCaller,
  cliArgs: docopt.DocOptions,
): PublicationsControllerOptions {
  const {
    "--project": projectArg,
    "--module": customModules,
    "--union-home": unionPathArg,
    "--hooks": hooksArg,
    "--verbose": verboseArg,
    "--dry-run": dryRunArg,
    "--schedule": scheduleArg,
    "<target>": targetsArg,
    "--arg": argNames,
    "--argv": argsValues,
  } = cliArgs;
  const projectHome = projectArg
    ? projectArg as string
    : (caller.projectHome || Deno.cwd());
  const unionHome = unionPathArg
    ? unionPathArg as string
    : (path.join(projectHome, "union"));
  const hooksGlobs = hooksArg as string[];
  const targets = targetsArg as string[];
  const schedule = scheduleArg ? scheduleArg.toString() : undefined;
  const isDryRun = dryRunArg ? true : false;
  const isVerbose = isDryRun || (verboseArg ? true : false);

  const defaultHookGlobs = ["*.hook-pubctl.*"];
  defaultHookGlobs.forEach((dg) => {
    if (!hooksGlobs.find((hg) => hg == dg)) hooksGlobs.unshift(dg);
  });

  const customArgs: Record<string, string> = {};
  if (argNames) {
    const an = argNames as string[];
    const av = argsValues as string[];

    if (an.length == av.length) {
      for (let i = 0; i < an.length; i++) {
        const key = an[i];
        const value = av[i];
        customArgs[key] = value;
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

  return {
    projectHome: path.isAbsolute(projectHome)
      ? projectHome
      : path.resolve(Deno.cwd(), projectHome),
    customModules: Array.isArray(customModules) ? customModules : [],
    unionHome: path.isAbsolute(unionHome) ? unionHome
    : path.resolve(Deno.cwd(), unionHome),
    htmlDestHome: path.join(projectHome, "public"), // TODO: make "public" CLI configurable
    observabilitySrcHome: path.join(projectHome, "static", "analytics"),
    observabilityHtmlDestHome: path.join(projectHome, "public", "analytics"),
    hooksGlobs,
    targets,
    schedule,
    isDryRun,
    isVerbose,
    arguments: customArgs,
    buildHostID: Deno.hostname(), // TODO: make "buildHostID" CLI configurable
  };
}

export class PublicationsControllerPluginsManager<
  O extends PublicationsControllerOptions,
  C extends PublicationsController,
> extends ex.fs.CommandProxyFileSystemPluginsManager<C> {
  readonly fsPH: ap.FileSystemPersistenceHandler;
  constructor(readonly pc: C, readonly cli: CliArgsSupplier, readonly pco: O) {
    super(
      pc,
      {}, // TODO add allowable commands for better error checking / typesafety?
      {
        discoveryPath: pco.projectHome,
        localFsSources: pco.hooksGlobs,
        shellCmdEnvVarsDefaultPrefix: "PUBCTLHOOK_",
      },
    );
    this.fsPH = new ap.FileSystemPersistenceHandler({
      projectPath: pco.projectHome,
      destPath: pco.projectHome,
      dryRun: pco.isDryRun,
      report: (ctx, ph, result) => {
        console.log(
          "Created",
          colors.yellow(
            typeof result === "string"
              ? result
              : result.finalArtifactNamePhysicalRel,
          ),
        );
      },
    });
  }

  createExecutePluginContext(
    command: ex.ProxyableCommand,
    plugin: ex.Plugin,
    options?: {
      readonly onActivity?: ex.PluginActivityReporter;
    },
  ): ex.CommandProxyPluginContext<C> {
    const result: HookContext<C> = {
      isContext: true,
      execEnvs: {
        isExecutionEnvironments: true,
        environmentsName: inflect.guessCaseValue(
          "PublicationsControllerPluginsManager",
        ),
      },
      pluginPathRelativeToProjectHome:
        ex.fs.isFileSystemPluginSource(plugin.source)
          ? path.relative(
            this.pco.projectHome,
            path.dirname(plugin.source.absPathAndFileName),
          )
          : "(ex.fs.isFileSystemPluginSource(plugin.source) is false)",
      createMutableTextArtifact: (options) => {
        return this.fsPH.createMutableTextArtifact(result, options);
      },
      persistMarkdownArtifact: (artifactName, artifact, options?) => {
        return this.fsPH.persistTextArtifact(
          result,
          artifactName,
          artifact,
          options,
        );
      },
      persistExecutableScriptArtifact: (artifactName, artifact, options?) => {
        return this.fsPH.persistTextArtifact(
          result,
          artifactName,
          artifact,
          { chmod: 0o755, ...options },
        );
      },
      persistTextArtifact: (artifactName, artifact, options?) => {
        return this.fsPH.persistTextArtifact(
          result,
          artifactName,
          artifact,
          options,
        );
      },
      onActivity: options?.onActivity || ((a) => {
        console.log(a.message);
        return a;
      }),
      container: this.executive,
      plugin,
      command,
    };
    return result;
  }

  enhanceShellCmd(
    pc: ex.CommandProxyPluginContext<C>,
    suggestedCmd: string[],
  ): string[] {
    if (!isHookContext(pc)) throw new Error("pc must be HookContext");
    const cmd = [...suggestedCmd];
    cmd.push(pc.command.proxyCmd);
    if (this.pco.targets.length > 0) {
      cmd.push(...this.pco.targets);
    }
    if (this.pco.isVerbose) cmd.push("--verbose");
    if (this.pco.isDryRun) cmd.push("--dry-run");
    for (
      const arg of Object.entries(pc.arguments || this.pco.arguments)
    ) {
      const [name, value] = arg;
      cmd.push(name, value);
    }
    return cmd;
  }

  prepareShellCmdEnvVars(
    pc: ex.CommandProxyPluginContext<C>,
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
    result[`${envVarsPrefix}BUILD_HOST_ID`] = this.pco.buildHostID;
    result[`${envVarsPrefix}VERBOSE`] = this.pco.isVerbose ? "1" : "0";
    result[`${envVarsPrefix}DRY_RUN`] = this.pco.isDryRun ? "1" : "0";
    result[`${envVarsPrefix}PROJECT_HOME_ABS`] =
      path.isAbsolute(this.pco.projectHome)
        ? this.pco.projectHome
        : path.join(Deno.cwd(), this.pco.projectHome);
    result[`${envVarsPrefix}PROJECT_HOME_REL`] = path.relative(
      hookHome,
      this.pco.projectHome,
    );
    result[`${envVarsPrefix}HTML_DEST_HOME_ABS`] =
      path.isAbsolute(this.pco.projectHome)
        ? this.pco.htmlDestHome
        : path.join(Deno.cwd(), this.pco.htmlDestHome);
    result[`${envVarsPrefix}HTML_DEST_HOME_REL`] = path.relative(
      hookHome,
      this.pco.htmlDestHome,
    );
    result[`${envVarsPrefix}OPTIONS_JSON`] = JSON.stringify(
      this.cli.cliArgs,
    );
    if (this.pco.schedule) {
      result[`${envVarsPrefix}SCHEDULE`] = this.pco.schedule;
    }
    if (this.pco.targets.length > 0) {
      result[`${envVarsPrefix}TARGETS`] = this.pco.targets.join(" ");
    }
    const cmdArgs = pc.arguments || this.pco.arguments;
    if (Object.keys(cmdArgs).length > 0) {
      result[`${envVarsPrefix}ARGS_JSON`] = JSON.stringify(cmdArgs);
    }
    return result;
  }
}

export class PublicationsController
  implements
    p.PublicationsSupplier,
    p.PublicationModulesSupplier,
    ex.PluginExecutive {
  readonly publications: Record<string, p.Publication> = {};
  readonly publModules: p.PublicationModule[] = [];
  readonly pluginsMgr: PublicationsControllerPluginsManager<
    PublicationsControllerOptions,
    PublicationsController
  >;
  constructor(
    readonly cli: CliArgsSupplier,
    readonly pco: PublicationsControllerOptions,
  ) {
    this.pluginsMgr = new PublicationsControllerPluginsManager<
      PublicationsControllerOptions,
      PublicationsController
    >(this, cli, pco);
  }

  async initController(): Promise<void> {
    await this.pluginsMgr.init();
  }

  publication(
    publ: p.PublicationIdentity,
    customModules?: p.PublicationModuleIdentity[],
  ): p.Publication | undefined {
    // customModules are usually handled by their publications but available
    // here in case it's necessary
    return this.publications[publ];
  }

  async hugoInit(
    // deno-lint-ignore no-explicit-any
    publ: hugo.HugoPublication<any>,
    destPath: string,
  ): Promise<boolean> {
    this.hugoClean();
    const hugoModInit = this.reportShellCmd(
      `hugo mod init ${publ.hugoModuleName} --verbose`,
    );
    await shell.runShellCommand(hugoModInit, {
      ...(this.pco.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.pco.isDryRun,
    });
    const confFileName = this.configureHugo(publ, destPath);
    const hugoModGraph = this.reportShellCmd(
      `hugo mod graph --verbose --config ${confFileName} --log`,
    );
    await shell.runShellCommand(hugoModGraph, {
      ...(this.pco.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.pco.isDryRun,
    });
    await this.executeHooks(
      hugoPublProxyableCommand(HookLifecycleStep.HUGO_INIT, publ),
    );
    return true;
  }

  async hugoInspect(): Promise<boolean> {
    await this.executeHooks({ proxyCmd: HookLifecycleStep.HUGO_INSPECT });
    return true;
  }

  async hugoClean(): Promise<boolean> {
    await this.clean();
    await this.executeHooks({ proxyCmd: HookLifecycleStep.HUGO_CLEAN });
    const hugoModClean = this.reportShellCmd(`hugox mod clean --all`);
    await shell.runShellCommand(hugoModClean, {
      ...(this.pco.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.pco.isDryRun,
    });
    return true;
  }

  configureHugo(
    // deno-lint-ignore no-explicit-any
    publ: hugo.HugoPublication<any>,
    destPath: string,
  ): string {
    const supplier = publ.hugoConfigSupplier(this);
    const fileName = hugo.persistConfiguration(
      destPath,
      supplier,
      this.pco.isDryRun,
    );
    return fileName;
  }

  reportShellCmd(cmd: string): string {
    if (this.pco.isVerbose && !this.pco.isDryRun) {
      console.log(colors.brightCyan(cmd));
    }
    return cmd;
  }

  validateHooks(): void {
    for (const glob of this.pco.hooksGlobs) {
      console.log(`Searched for hooks in '${colors.yellow(glob)}'`);
    }

    let firstValid = true;
    for (const hook of this.pluginsMgr.plugins) {
      if (firstValid) {
        console.log("--", colors.brightCyan("Registered hooks"), "--");
        firstValid = false;
      }
      const hookCtx: HookContext<PublicationsController> = {
        isContext: true,
        execEnvs: {
          isExecutionEnvironments: true,
          environmentsName: inflect.guessCaseValue("validateHooks"),
        },
        container: this,
        plugin: hook,
        command: { proxyCmd: HookLifecycleStep.DOCTOR },
        onActivity: (a: ex.PluginActivity): ex.PluginActivity => {
          if (this.pco.isVerbose) {
            console.log(a.message);
          }
          return a;
        },
        pluginPathRelativeToProjectHome:
          ex.fs.isFileSystemPluginSource(hook.source)
            ? path.relative(
              this.pco.projectHome,
              path.dirname(hook.source.absPathAndFileName),
            )
            : "(ex.fs.isFileSystemPluginSource(plugin.source) is false)",
        createMutableTextArtifact: (options) => {
          return new ap.DefaultTextArtifact(options);
        },
        persistExecutableScriptArtifact: () => {
          return undefined;
        },
        persistMarkdownArtifact: () => {
          return undefined;
        },
        persistTextArtifact: () => {
          return undefined;
        },
      };
      if (ex.isShellExePlugin<PublicationsController>(hook)) {
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
      if (ex.isDenoModulePlugin(hook)) {
        if (ex.isDenoFunctionModulePlugin(hook)) {
          console.log(
            colors.yellow(hook.source.friendlyName),
            colors.green(hook.nature.identity),
            hook.isAsync
              ? colors.brightBlue("async function Deno module")
              : colors.brightBlue("sync function Deno module"),
          );
        } else {
          console.log(
            colors.yellow(hook.source.friendlyName),
            colors.green(hook.nature.identity),
            ex.isActionPlugin(hook)
              ? colors.brightBlue("executable Deno module")
              : colors.brightBlue("not executable Deno module"),
          );
        }
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

  async generate() {
    return await this.executeHooks({ proxyCmd: HookLifecycleStep.GENERATE });
  }

  async build() {
    return await this.executeHooks({ proxyCmd: HookLifecycleStep.BUILD });
  }

  async inspect() {
    const {
      "publications": publications,
      "publishable-modules": publishableModules,
    } = this.cli.cliArgs;
    if (publications) {
      this.inspectPublications();
      return true;
    }
    if (publishableModules) {
      this.publModules.forEach((pm) => {
        console.log(colors.green(pm.identity));
      });
      return true;
    }

    await this.executeHooks({ proxyCmd: HookLifecycleStep.INSPECT });
  }

  inspectPublications(): void {
    Object.values(this.publications).forEach((publ) => {
      if (hugo.isHugoPublication(publ)) {
        const hc = publ.hugoConfigSupplier(this);
        console.log(
          `${colors.green(publ.identity)}: ${
            colors.blue(hc.hugoConfigFileName || "<no name>")
          }`,
        );
      }
    });
  }

  async clean() {
    await this.executeHooks({ proxyCmd: HookLifecycleStep.CLEAN });
    ["go.sum", "public", "resources"].forEach((f) => {
      if (fs.existsSync(f)) {
        if (this.pco.isDryRun) {
          console.log("rm -f", colors.red(f));
        } else {
          Deno.removeSync(f, { recursive: true });
          if (this.pco.isVerbose) console.log(colors.red(`deleted ${f}`));
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
      ...(this.pco.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.pco.isDryRun,
    });
    this.executeHooks({ proxyCmd: HookLifecycleStep.UPDATE });
  }
}

export async function hugoInitHandler<C extends PublicationsController>(
  ctx: C,
): Promise<true | void> {
  const {
    "hugo": hugoArg,
    "init": init,
    "--publ": publID,
    "--module": customModules,
    "--dest": destPath,
  } = ctx.cli.cliArgs;
  if (hugoArg && init && publID) {
    const identity = publID.toString();
    const publ = ctx.publication(
      identity,
      Array.isArray(customModules)
        ? (customModules.length > 0 ? customModules : undefined)
        : undefined,
    );
    if (publ) {
      if (hugo.isHugoPublication(publ)) {
        await ctx.hugoInit(
          publ,
          destPath ? destPath.toString() : ctx.pco.projectHome,
        );
      } else {
        console.error(colors.red(
          `publication ID '${
            colors.yellow(identity)
          }' is not a Hugo publication`,
        ));
      }
    } else {
      console.error(colors.red(
        `unable to init publication ID '${
          colors.yellow(identity)
        }': no definition found`,
      ));
    }
    return true;
  }
}

export async function hugoInspectHandler<C extends PublicationsController>(
  ctx: C,
): Promise<true | void> {
  const {
    "hugo": hugo,
    "inspect": inspect,
  } = ctx.cli.cliArgs;
  if (hugo && inspect) {
    await ctx.hugoInspect();
    return true;
  }
}

export async function hugoCleanHandler<C extends PublicationsController>(
  ctx: C,
): Promise<true | void> {
  const {
    "hugo": hugo,
    "clean": clean,
  } = ctx.cli.cliArgs;
  if (hugo && clean) {
    await ctx.hugoClean();
    return true;
  }
}

export async function installHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "install": install } = ctx.cli.cliArgs;
  if (install) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.INSTALL });
    return true;
  }
}

// deno-lint-ignore require-await
export async function validateHooksHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "validate": validate, "hooks": hooks } = ctx.cli.cliArgs;
  if (validate && hooks) {
    ctx.validateHooks();
    return true;
  }
}

export async function inspectHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "inspect": inspect } = ctx.cli.cliArgs;
  if (inspect) {
    await ctx.inspect();
    return true;
  }
}

export async function describeHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "describe": describe } = ctx.cli.cliArgs;
  if (describe) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.DESCRIBE });
    return true;
  }
}

export async function generateHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "generate": generate } = ctx.cli.cliArgs;
  if (generate) {
    await ctx.generate();
    return true;
  }
}

export async function buildHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "build": build } = ctx.cli.cliArgs;
  if (build) {
    await ctx.build();
    return true;
  }
}

export async function cleanHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "clean": clean } = ctx.cli.cliArgs;
  if (clean) {
    await ctx.clean();
    return true;
  }
}

export async function doctorHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "doctor": doctor } = ctx.cli.cliArgs;
  if (doctor) {
    await ctx.executeHooks({ proxyCmd: HookLifecycleStep.DOCTOR });
    return true;
  }
}

export async function updateHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "update": update } = ctx.cli.cliArgs;
  if (update) {
    await ctx.update();
    return true;
  }
}

export async function versionHandler(
  ctx: PublicationsController,
): Promise<true | void> {
  const { "version": version } = ctx.cli.cliArgs;
  if (version) {
    console.log(
      `hugo-aide ${colors.yellow(await determineVersion(import.meta.url))}`,
    );
    return true;
  }
}

export const commonHandlers = [
  hugoInitHandler,
  hugoCleanHandler,
  hugoInspectHandler,
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

export interface CommandHandlerSpecOptions<C extends PublicationsController> {
  readonly docoptSpec?: (caller: CommandHandlerCaller) => string;
  readonly prepareControllerOptions?: (
    caller: CommandHandlerCaller,
    cliArgs: docopt.DocOptions,
  ) => PublicationsControllerOptions;
  readonly prepareController?: (
    caller: CommandHandlerCaller,
    cliArgs: docopt.DocOptions,
    options: PublicationsControllerOptions,
  ) => C;
}

export async function CLI<
  C extends PublicationsController,
>(
  caller: CommandHandlerCaller,
  options: CommandHandlerSpecOptions<C> = {},
): Promise<void> {
  const { prepareController } = options;
  try {
    const docoptSpecFn = options.docoptSpec || defaultDocoptSpec;
    const prepareControllerOptions = options.prepareControllerOptions ||
      publicationsControllerOptions;
    const cliArgs = docopt.default(docoptSpecFn(caller));
    const pchOptions = prepareControllerOptions(caller, cliArgs);
    const context = prepareController
      ? prepareController(caller, cliArgs, pchOptions)
      : new PublicationsController({ cliArgs }, pchOptions);
    await context.initController();
    let handled: true | void;
    for (const handler of commonHandlers) {
      handled = await handler(context);
      if (handled) break;
    }
    if (!handled) {
      console.error("Unable to handle validly parsed docoptSpec:");
      console.dir(cliArgs);
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
