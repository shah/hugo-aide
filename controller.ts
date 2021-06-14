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
  govnSvcHealth as health,
  govnSvcMetrics as gsm,
  govnSvcVersion as gsv,
  inflect,
  inspect as insp,
  path,
  safety,
  shell,
  uuid,
  valueMgr as vm,
} from "./deps.ts";
import * as hbr from "./hugo-build-results.ts";
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
  readonly docOptInitArgV?: string[];
}

export function defaultDocoptSpec(caller: CommandHandlerCaller): string {
  const publ = `--publ=<publ-id> [--module=<module-id>]...`;
  const targetable = "[<target>]...";
  const schedulable = "--schedule=<cronSpec>";
  const paths =
    `[--project=<path>] [--union-home=<path>] [--observability-src-home=<path>] [--observability-dest-home=<path>] [--observability-prom-metrics-file=<file>]`;
  const hugoResults = `[--observability-hugo-results-file=<file>]`;
  const healthResults = `[--observability-health-file=<file>]`;
  const hookable = `[--hooks=<glob>]...`;
  const observable = "[--verbose] [--dry-run]";
  const customizable = `[--arg=<name>]... [--argv=<value>]...`;
  const transactionID = "[--tx-id=<uuid>]";
  const stdArgs =
    `${targetable} ${transactionID} ${paths} ${hookable} ${observable} ${customizable}`;
  return `
Publication Orchestrator ${caller.version}.

Usage:
  pubctl init workspace ${stdArgs}
  pubctl hugo init ${targetable} ${publ} [--dest=<dest>] ${transactionID} ${paths} ${hookable} ${observable} ${customizable}
  pubctl hugo inspect ${targetable} ${transactionID} ${paths} ${hookable} ${customizable}
  pubctl hugo clean ${targetable} ${transactionID} ${paths} ${hookable} ${customizable}
  pubctl observability clean ${targetable} ${transactionID} ${paths} ${hookable} ${observable} ${customizable}
  pubctl install ${stdArgs}
  pubctl validate hooks ${stdArgs}
  pubctl describe ${targetable} ${transactionID} ${paths} ${hookable} ${customizable}
  pubctl inspect (publications | publishable-modules | ${targetable}) ${transactionID} ${paths} ${hookable} ${customizable}
  pubctl build prepare ${targetable} ${publ} ${schedulable} ${transactionID} ${healthResults} ${paths} ${hookable} ${observable} ${customizable}
  pubctl build finalize ${targetable} ${publ} ${schedulable} ${transactionID} ${healthResults} ${hugoResults} ${paths} ${hookable} ${observable} ${customizable}
  pubctl generate ${targetable} ${schedulable} ${transactionID} ${paths} ${hookable} ${observable} ${customizable}
  pubctl clean ${stdArgs}
  pubctl doctor ${stdArgs}
  pubctl update ${stdArgs}
  pubctl version
  pubctl -h | --help

Options:
  <target>                                One or more identifiers that the hook will understand
  --project=PATH                          The project's home directory, defaults to current directory [default: .]
  --union-home=PATH                       The path where workspace dependencies will be stored and 'union'ed into the publication [default: union]
  --observability-src-home=PATH           The path where observability files are prepared during build [default: static/.observability]
  --observability-dest-home=PATH          The path where observability files are copied for publication [default: public/.observability]
  --observability-prom-metrics-file=FILE  The file in the observability src path where the prometheus metrics are stored [default: static/.observability/publication-observability-prometheus-metrics.auto.txt]
  --observability-hugo-results-file=FILE  The file in the observability src path where the Hugo build output is stored [default: static/.observability/hugo-build-results.auto.txt]
  --observability-health-file=FILE        The file in the observability src path where the health.json status is stored [default: static/.observability/health.json]
  --publ-id=PUBLICATION                   A publication configuration supplier name [default: sandbox]
  --module=MODULE                         One or more Hugo module identifiers that should be included in the init or configure process
  --schedule=CRONSPEC                     Cron spec for schedule [default: * * * * *]
  --tx-id=TRANSACTION_ID                  Unique ID that can be used to identify a build or generator sequence (defaults to UUIDv4.generate())
  --hooks=GLOB                            Glob of hooks which will be found and executed [default: {content,data,static}/**/*.hook-pubctl.*]
  --dry-run                               Show what will be done (but don't actually do it) [default: false]
  --verbose                               Be explicit about what's going on [default: false]
  --arg=NAME                              Name of an arbitrary argument to pass to handler
  --argv=VALUE                            Value of an arbitrary argument to pass to handler, must match same order as --arg
  -h --help                               Show this screen
`;
}

export interface PublicationsControllerCommandHandler<
  PC extends PublicationsController,
> {
  (ctx: PC): Promise<true | void>;
}

export enum HookLifecycleStep {
  OBSERVABILITY_CLEAN = "observability-clean",
  HUGO_INIT = "hugo-init",
  HUGO_INSPECT = "hugo-inspect",
  HUGO_CLEAN = "hugo-clean",
  INSTALL = "install",
  UNINSTALL = "uninstall",
  DOCTOR = "doctor",
  DESCRIBE = "describe",
  INSPECT = "inspect",
  GENERATE = "generate",
  BUILD_PREPARE = "build-prepare",
  BUILD_FINALIZE = "build-finalize",
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

    case HookLifecycleStep.OBSERVABILITY_CLEAN:
    case HookLifecycleStep.HUGO_INIT:
    case HookLifecycleStep.HUGO_INSPECT:
    case HookLifecycleStep.HUGO_CLEAN:
    case HookLifecycleStep.DESCRIBE:
    case HookLifecycleStep.GENERATE:
    case HookLifecycleStep.BUILD_PREPARE:
    case HookLifecycleStep.BUILD_FINALIZE:
    case HookLifecycleStep.INSPECT:
    case HookLifecycleStep.CLEAN:
    case HookLifecycleStep.UPDATE:
      if (hc.container.pco.isVerbose) {
        console.log(
          colors.dim(`[${hc.plugin.source.abbreviatedName}]{INFO}`),
          `command '${colors.yellow(hc.command.proxyCmd)}' not implemented in`,
          colors.cyan(hc.plugin.source.friendlyName),
        );
      }
      return defaultPubCtlHookResultEnhancer(hc);
  }

  if (hc.container.pco.isVerbose) {
    console.log(
      colors.dim(`[${hc.plugin.source.abbreviatedName}]{INFO}`),
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
  _hc: HookContext<PC>,
  dfmhResult?: ex.DenoFunctionModuleHandlerResult,
): ex.DenoFunctionModuleHandlerResult {
  if (!dfmhResult) return {};
  return dfmhResult;
}

export interface CliArgsSupplier {
  readonly cliArgs: docopt.DocOptions;
}

export interface ControllerExecInfoMetricLabels {
  // These are known at controller init time
  readonly initOn: Date;
  readonly host: string;
  readonly txId: string;
  readonly schedule?: p.CronSpec;
  readonly targets?: string;

  // These are updated at the end, after finalization
  finalizeOn?: Date;
  command?: string;
}

export class PublicationMetrics extends gsm.TypicalMetrics {
  readonly controllerExec = this.infoMetric<ControllerExecInfoMetricLabels>(
    "controller_exec",
    "Controller execution tracker",
  );
}

export interface PublicationsControllerOptions {
  readonly metrics: PublicationMetrics;
  readonly projectHome: string;
  readonly unionHome: string;
  readonly htmlDestHome: string;
  readonly hooksGlobs: string[];
  readonly targets: string[];
  readonly arguments: Record<string, string>;
  readonly schedule?: p.CronSpec;
  readonly transactionID: string;
  readonly isVerbose: boolean;
  readonly isDryRun: boolean;
  readonly buildHostID: string;
  readonly customModules: p.PublicationModuleIdentity[];
  readonly observabilitySrcHome: string;
  readonly observabilityPromMetricsFile: string;
  readonly observabilityMetricNamePrefix: string;
  readonly observabilityHtmlDestHome: string;
  readonly observabilityHugoBuildResultsFile: string;
  readonly observabilityHugoTemplateMetricsCsvFile: string;
  readonly observabilityHealthFile: string;
  readonly hugoServerPort?: number;
}

export function publicationsControllerOptions(
  caller: CommandHandlerCaller,
  cliArgs: docopt.DocOptions,
): PublicationsControllerOptions {
  const {
    "--project": projectArg,
    "--module": customModules,
    "--union-home": unionPathArg,
    "--observability-src-home": observabilitySrcPathArg,
    "--observability-dest-home": observabilityDestPathArg,
    "--observability-prom-metrics-file": observabilityPromMetricsFileArg,
    "--observability-hugo-metrics-file": observabilityHugoBuildResultsFileArg,
    "--observability-health-file": observabilityHealthFileArg,
    "--hooks": hooksArg,
    "--verbose": verboseArg,
    "--dry-run": dryRunArg,
    "--schedule": scheduleArg,
    "--tx-id": transactionIdArg,
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
  const observabilitySrcHome = observabilitySrcPathArg
    ? observabilitySrcPathArg as string
    : (path.join(projectHome, "static", ".observability"));
  const observabilityDestHome = observabilityDestPathArg
    ? observabilityDestPathArg as string
    : (path.join(projectHome, "public", ".observability"));
  const observabilityPromMetricsFile = observabilityPromMetricsFileArg
    ? observabilityPromMetricsFileArg as string
    : (path.join(
      observabilitySrcHome,
      "publication-observability-prometheus-metrics.auto.txt",
    ));
  const observabilityHugoBuildResultsFile = observabilityHugoBuildResultsFileArg
    ? observabilityHugoBuildResultsFileArg as string
    : (path.join(
      observabilitySrcHome,
      "hugo-build-results.auto.txt",
    ));
  const observabilityHealthFile = observabilityHealthFileArg
    ? observabilityHealthFileArg as string
    : (path.join(
      observabilitySrcHome,
      "health.json",
    ));
  const hooksGlobs = hooksArg as string[];
  const targets = targetsArg as string[];
  const schedule = scheduleArg ? scheduleArg.toString() : undefined;
  const isDryRun = dryRunArg ? true : false;
  const isVerbose = isDryRun || (verboseArg ? true : false);
  const transactionID = transactionIdArg
    ? transactionIdArg.toString()
    : uuid.v4.generate();

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

  const metricNamePrefix = "nets_pubctl_"; // TODO: make this CLI configurable
  const projectHomeAbs = path.isAbsolute(projectHome)
    ? projectHome
    : path.resolve(Deno.cwd(), projectHome);
  return {
    metrics: new PublicationMetrics(metricNamePrefix),
    projectHome: projectHomeAbs,
    customModules: Array.isArray(customModules) ? customModules : [],
    unionHome: path.isAbsolute(unionHome)
      ? unionHome
      : path.resolve(Deno.cwd(), unionHome),
    htmlDestHome: path.join(projectHomeAbs, "public"), // TODO: make "public" CLI configurable
    observabilitySrcHome: path.isAbsolute(observabilitySrcHome)
      ? observabilitySrcHome
      : path.resolve(Deno.cwd(), observabilitySrcHome),
    observabilityHtmlDestHome: path.isAbsolute(observabilityDestHome)
      ? observabilityDestHome
      : path.resolve(Deno.cwd(), observabilityDestHome),
    observabilityPromMetricsFile: path.isAbsolute(observabilityPromMetricsFile)
      ? observabilityPromMetricsFile
      : path.resolve(Deno.cwd(), observabilityPromMetricsFile),
    observabilityMetricNamePrefix: metricNamePrefix,
    observabilityHugoBuildResultsFile,
    observabilityHealthFile,
    observabilityHugoTemplateMetricsCsvFile: path.join(
      observabilitySrcHome,
      "publication-observability-hugo-template-metrics.auto.csv",
    ),
    hooksGlobs,
    targets,
    schedule,
    transactionID,
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
      report: (_ctx, _ph, result) => {
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
    result[`${envVarsPrefix}TRANSACTION_ID`] = this.pco.transactionID;
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
    result[`${envVarsPrefix}OBSERVABILITY_HTML_DEST_HOME_ABS`] =
      this.pco.observabilityHtmlDestHome;
    result[`${envVarsPrefix}OBSERVABILITY_HTML_DEST_HOME_REL`] = path.relative(
      hookHome,
      this.pco.observabilityHtmlDestHome,
    );
    result[`${envVarsPrefix}OBSERVABILITY_PROMETHEUS_METRICS_FILE_ABS`] =
      this.pco.observabilityPromMetricsFile;
    result[`${envVarsPrefix}OBSERVABILITY_METRIC_NAME_PREFIX`] =
      this.pco.observabilityMetricNamePrefix;
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

// deno-lint-ignore no-empty-interface
export interface PublicationModuleContentAssembler
  extends p.PublicationModuleContentOrchestrator {
}

// deno-lint-ignore no-empty-interface
export interface PublicationModuleContentGenerator
  extends p.PublicationModuleContentOrchestrator {
}

export interface PublicationModuleImportOptions {
  readonly publModuleImportRepoPath: (
    path: string,
    relTo?: "project" | string,
  ) => string;
}

export const isPublicationModuleImportOptions = safety.typeGuard<
  PublicationModuleImportOptions
>("publModuleImportRepoPath");

export interface PublicationModuleContentOrchestratorsSupplier<
  PC extends PublicationsController,
  PM extends p.PublicationModule,
> extends p.Identifiable {
  readonly contentOrchestrators: (
    pc: PC,
    pm: PM,
  ) => p.PublicationModuleContentOrchestrator[];
}

export function isPublicationModuleContentSupplier<
  PC extends PublicationsController,
  PM extends p.PublicationModule,
>(
  o: unknown,
): o is PublicationModuleContentOrchestratorsSupplier<PC, PM> {
  const isPMCS = safety.typeGuard<
    PublicationModuleContentOrchestratorsSupplier<PC, PM>
  >("contentOrchestrators");
  return isPMCS(o);
}

export class PublicationsController
  implements
    p.PublicationsSupplier,
    p.PublicationModulesSupplier,
    ex.PluginExecutive {
  readonly execInfoInstance: gsm.LabeledMetricInstance<
    gsm.InfoMetric<ControllerExecInfoMetricLabels>,
    ControllerExecInfoMetricLabels
  >;
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
    this.execInfoInstance = this.pco.metrics.controllerExec.instance({
      initOn: new Date(),
      txId: this.pco.transactionID,
      host: this.pco.buildHostID,
      schedule: this.pco.schedule,
      targets: this.pco.targets.length > 0
        ? this.pco.targets.join(",")
        : undefined,
    });
    this.pluginsMgr = new PublicationsControllerPluginsManager<
      PublicationsControllerOptions,
      PublicationsController
    >(this, cli, pco);
  }

  async initController(): Promise<void> {
    await this.pluginsMgr.init();
  }

  async finalizeController<C extends PublicationsController>(
    _handledBy?: PublicationsControllerCommandHandler<C>,
  ): Promise<void> {
    // if we had a command working tracking, then record the metrics
    if (this.execInfoInstance.labels.object.command) {
      this.execInfoInstance.labels.object.finalizeOn = new Date();
      this.pco.metrics.record(this.execInfoInstance);
    }
    await this.persistMetrics();
  }

  execInfoMetricInstanceCommand(command: string): void {
    if (this.execInfoInstance.labels.object.command) {
      this.execInfoInstance.labels.object.command += " " + command;
    } else {
      this.execInfoInstance.labels.object.command = command;
    }
  }

  async persistMetrics(): Promise<void> {
    const dialect = gsm.prometheusDialect();
    const exported = dialect.export(this.pco.metrics.instances);
    if (exported.length > 0) {
      Deno.mkdirSync(path.dirname(this.pco.observabilityPromMetricsFile), {
        recursive: true,
      });
      await Deno.writeTextFile(
        this.pco.observabilityPromMetricsFile,
        exported.join("\n") + "\n",
        {
          append: true,
        },
      );
    }
    if (this.pco.isVerbose) {
      console.log(
        `Metrics appended to ${
          colors.yellow(
            path.relative(
              this.pco.projectHome,
              this.pco.observabilityPromMetricsFile,
            ),
          )
        }: ${this.pco.metrics.instances.length} instances, ${exported.length} lines`,
      );
    }
    if (
      fs.existsSync(this.pco.observabilityPromMetricsFile) &&
      fs.existsSync(this.pco.observabilityHtmlDestHome)
    ) {
      await Deno.copyFile(
        this.pco.observabilityPromMetricsFile,
        path.join(
          this.pco.observabilityHtmlDestHome,
          path.basename(this.pco.observabilityPromMetricsFile),
        ),
      );
      if (this.pco.isVerbose) {
        console.log(
          `Copied ${
            colors.blue(
              path.relative(
                this.pco.projectHome,
                this.pco.observabilityPromMetricsFile,
              ),
            )
          } to ${
            colors.yellow(
              path.relative(
                this.pco.projectHome,
                this.pco.observabilityHtmlDestHome,
              ),
            )
          }`,
        );
      }
    }
  }

  publication(
    publ: p.Identity,
    _customModules?: p.PublicationModuleIdentity[],
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
    this.execInfoMetricInstanceCommand(HookLifecycleStep.HUGO_INIT);
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
    this.execInfoMetricInstanceCommand(HookLifecycleStep.HUGO_INSPECT);
    await this.executeHooks({ proxyCmd: HookLifecycleStep.HUGO_INSPECT });
    return true;
  }

  async hugoClean(): Promise<boolean> {
    this.execInfoMetricInstanceCommand(HookLifecycleStep.HUGO_CLEAN);
    await this.clean();
    await this.executeHooks({ proxyCmd: HookLifecycleStep.HUGO_CLEAN });
    const hugoModClean = this.reportShellCmd(`hugo mod clean --all`);
    await shell.runShellCommand(hugoModClean, {
      ...(this.pco.isVerbose
        ? shell.cliVerboseShellOutputOptions
        : shell.quietShellOutputOptions),
      dryRun: this.pco.isDryRun,
    });
    return true;
  }

  async observabilityClean(): Promise<boolean> {
    // Don't run this.execInfoMetricInstanceCommand(HookLifecycleStep.OBSERVABILITY_CLEAN)
    // because it will generate this.pco.observabilityPromMetricsFile, which needs to be cleaned
    await this.executeHooks({
      proxyCmd: HookLifecycleStep.OBSERVABILITY_CLEAN,
    });
    [
      this.pco.observabilityHugoBuildResultsFile,
      this.pco.observabilityHealthFile,
      this.pco.observabilityPromMetricsFile,
      this.pco.observabilityHugoTemplateMetricsCsvFile,
    ].forEach((f) => {
      if (fs.existsSync(f)) {
        if (this.pco.isDryRun) {
          console.log("rm -f", colors.red(f));
        } else {
          Deno.removeSync(f, { recursive: true });
          if (this.pco.isVerbose) console.log(colors.red(`deleted ${f}`));
        }
      }
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
    this.execInfoMetricInstanceCommand(HookLifecycleStep.GENERATE);
    return await this.executeHooks({ proxyCmd: HookLifecycleStep.GENERATE });
  }

  serviceHealthComponents(
    publ: p.Publication,
    buildResults?: hbr.HugoBuildResults | string,
  ): health.ServiceHealthComponents {
    const publComponents: health.ServiceHealthComponentStatus[] = [];
    const hooks: health.ServiceHealthComponentStatus[] = [];
    const details: Record<string, health.ServiceHealthComponentDetails> = {
      [`publ:${publ.identity}`]: publComponents,
      [`hooks`]: hooks,
    };
    if (buildResults) {
      if (hbr.isValidHugoBuildResults(buildResults)) {
        const buildStatus = health.healthyComponent({
          componentType: "component",
          componentId: `hugo-build-time:${publ.identity}`,
          metricName: "build time",
          metricUnit: "ms",
          metricValue: buildResults.buildTimeMS,
          links: { "src": this.pco.observabilityHugoBuildResultsFile },
          time: buildResults.resultFileInfo.mtime || new Date(),
        });
        publComponents.push(buildStatus);
        publComponents.push({
          ...buildStatus,
          metricUnit: "minutes",
          metricValue: buildResults.buildTimeMS / 1000 / 60,
        });
      } else {
        publComponents.push(health.unhealthyComponent("warn", {
          componentType: "component",
          componentId: `hugo-build-results:${publ.identity}`,
          links: { "src": this.pco.observabilityHugoBuildResultsFile },
          time: new Date(),
          output: buildResults,
        }));
      }
    }
    if (hugo.isHugoPublication(publ)) {
      const hcs = publ.hugoConfigSupplier(this);
      const modules = hcs.hugoConfigModules();
      for (const hm of modules) {
        publComponents.push(health.healthyComponent({
          componentType: "component",
          componentId: `module:${hm.identity}`,
          links: {}, // TODO show source locations of module imports
          time: new Date(),
        }));
      }
    }
    for (const hook of this.pluginsMgr.plugins) {
      hooks.push(health.healthyComponent({
        componentType: "component",
        componentId: `hook:${hook.nature.identity}`,
        links: {
          "src": hook.source.systemID,
        },
        time: new Date(),
      }));
    }
    return {
      details: details,
    };
  }

  async buildPrepare(publ: p.Publication) {
    this.execInfoMetricInstanceCommand(HookLifecycleStep.BUILD_PREPARE);
    const unhealthy = health.unhealthyService("fail", {
      serviceID: import.meta.url,
      releaseID: this.pco.transactionID,
      description: "build prepare",
      output:
        "`build prepare` must be followed by `build finalize` which checks results",
      details: this.serviceHealthComponents(publ).details,
      version: await determineVersion(import.meta.url),
    });
    Deno.mkdirSync(path.dirname(this.pco.observabilityHealthFile), {
      recursive: true,
    });
    Deno.writeTextFileSync(
      this.pco.observabilityHealthFile,
      JSON.stringify(unhealthy, undefined, "  "),
      {},
    );
    if (this.pco.isVerbose) {
      console.log(
        `Stored initial unhealthy service status in ${
          colors.yellow(this.pco.observabilityHealthFile)
        }`,
      );
    }
    return await this.executeHooks({
      proxyCmd: HookLifecycleStep.BUILD_PREPARE,
    });
  }

  async buildFinalize(publ: p.Publication) {
    this.execInfoMetricInstanceCommand(HookLifecycleStep.BUILD_FINALIZE);
    const hugoBuildResults = hbr.parseHugoBuildResults(
      this.pco.observabilityHugoBuildResultsFile,
      this.pco.observabilityMetricNamePrefix,
    );
    if (hbr.isValidHugoBuildResults(hugoBuildResults)) {
      const hbrMetrics = hugoBuildResults.buildMetrics;
      const publLabels = {
        host: this.pco.buildHostID,
        txId: this.pco.transactionID,
        publ: publ.identity,
        src: path.relative(
          this.pco.projectHome,
          this.pco.observabilityHugoBuildResultsFile,
        ),
        srcMTime: hugoBuildResults.resultFileInfo.mtime || new Date(),
      };
      hbrMetrics.record(
        hbrMetrics.hugoBuildTotalTime.instance(
          hugoBuildResults.buildTimeMS,
          publLabels,
        ),
      );
      for (const tm of hugoBuildResults.parsedTemplateMetrics) {
        const labels: hbr.HugoBuildResultTemplateMetricLabels = {
          template: tm.templateName,
          ...publLabels,
        };
        hbrMetrics.record(
          hbrMetrics.hugoTemplateMetricCount.instance(tm.count, labels),
        );
        hbrMetrics.record(
          hbrMetrics.hugoTemplateMetricCachePotential.instance(
            tm.cachePotential,
            labels,
          ),
        );
        hbrMetrics.record(
          hbrMetrics.hugoTemplateMetricAverageDuration.instance(
            tm.averageDuration,
            { ...labels, durationText: tm.averageDurationText },
          ),
        );
        hbrMetrics.record(
          hbrMetrics.hugoTemplateMetricCumulativeDuration.instance(
            tm.cumulativeDuration,
            { ...labels, durationText: tm.cumulativeDurationText },
          ),
        );
        hbrMetrics.record(
          hbrMetrics.hugoTemplateMetricMaximumDuration.instance(
            tm.maximumDuration,
            { ...labels, durationText: tm.maximumDurationText },
          ),
        );
      }
      this.pco.metrics.merge(hbrMetrics);
      const csvRows = hugoBuildResults.parsedTemplateMetricsCSV({
        names: [
          "TxID",
          "Host",
          "Publication",
          "Source File",
          "Source Date",
          "Build Time Milliseconds",
        ],
        values: [
          this.pco.transactionID,
          this.pco.buildHostID,
          publ.identity,
          publLabels.src,
          JSON.stringify(publLabels.srcMTime),
          JSON.stringify(hugoBuildResults.buildTimeMS),
        ],
      });
      Deno.mkdirSync(
        path.dirname(this.pco.observabilityHugoTemplateMetricsCsvFile),
        {
          recursive: true,
        },
      );
      await Deno.writeTextFile(
        this.pco.observabilityHugoTemplateMetricsCsvFile,
        csvRows.join("\n"),
      );
      if (this.pco.isVerbose) {
        console.log(
          `Stored Hugo build template metrics in ${
            colors.yellow(this.pco.observabilityHugoTemplateMetricsCsvFile)
          }: ${csvRows.length} rows`,
        );
      }
    }
    const healthy = health.healthyService({
      serviceID: import.meta.url,
      releaseID: this.pco.transactionID,
      description: "build finalize",
      details: this.serviceHealthComponents(
        publ,
        hugoBuildResults,
      ).details,
      version: await determineVersion(import.meta.url),
    });
    Deno.mkdirSync(path.dirname(this.pco.observabilityHealthFile), {
      recursive: true,
    });
    Deno.writeTextFileSync(
      this.pco.observabilityHealthFile,
      JSON.stringify(healthy, undefined, "  "),
    );
    if (this.pco.isVerbose) {
      console.log(
        `Stored final healthy service status in ${
          colors.yellow(this.pco.observabilityHealthFile)
        }`,
      );
    }
    const hooksResult = await this.executeHooks({
      proxyCmd: HookLifecycleStep.BUILD_FINALIZE,
    });
    for (
      const copy of [{
        src: this.pco.observabilityHealthFile,
        dest: path.join(
          this.pco.htmlDestHome,
          path.basename(this.pco.observabilityHealthFile),
        ),
      }, {
        src: this.pco.observabilityHugoTemplateMetricsCsvFile,
        dest: path.join(
          this.pco.observabilityHtmlDestHome,
          path.basename(this.pco.observabilityHugoTemplateMetricsCsvFile),
        ),
      }]
    ) {
      if (fs.existsSync(copy.src) && fs.existsSync(path.dirname(copy.dest))) {
        await Deno.copyFile(copy.src, copy.dest);
        if (this.pco.isVerbose) {
          console.log(
            `Copied ${
              colors.blue(path.relative(this.pco.projectHome, copy.src))
            } to ${
              colors.yellow(
                path.relative(this.pco.projectHome, path.dirname(copy.dest)),
              )
            }`,
          );
        }
      }
    }
    return hooksResult;
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
        if (isPublicationModuleContentSupplier(pm)) {
          pm.contentOrchestrators(this, pm).forEach((co) => {
            const messages = co.inspect({ pc: this });
            messages.forEach((m) => console.log("   ", m));
          });
        }
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
    this.execInfoMetricInstanceCommand(HookLifecycleStep.CLEAN);
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
    this.execInfoMetricInstanceCommand(HookLifecycleStep.UPDATE);
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

export async function observabilityHandler<
  C extends PublicationsController,
>(
  ctx: C,
): Promise<true | void> {
  const {
    "observability": observability,
    "clean": clean,
  } = ctx.cli.cliArgs;
  if (observability && clean) {
    await ctx.observabilityClean();
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
  const {
    "build": build,
    "prepare": prepare,
    "finalize": finalize,
    "--publ": publID,
    "--module": customModules,
  } = ctx.cli.cliArgs;
  if (build && publID) {
    const identity = publID.toString();
    const publ = ctx.publication(
      identity,
      Array.isArray(customModules)
        ? (customModules.length > 0 ? customModules : undefined)
        : undefined,
    );
    if (publ) {
      if (prepare) {
        await ctx.buildPrepare(publ);
        return true;
      } else if (finalize) {
        await ctx.buildFinalize(publ);
        return true;
      }
    } else {
      console.error(colors.red(
        `unable to build publication ID '${
          colors.yellow(identity)
        }': no definition found`,
      ));
    }
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
  observabilityHandler,
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

export interface ControllerCommandLineInterface {
  (caller: CommandHandlerCaller): Promise<void>;
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
    const cliArgs = docopt.default(
      docoptSpecFn(caller),
      caller.docOptInitArgV
        ? {
          argv: caller.docOptInitArgV,
        }
        : undefined,
    );
    const pchOptions = prepareControllerOptions(caller, cliArgs);
    const context = prepareController
      ? prepareController(caller, cliArgs, pchOptions)
      : new PublicationsController({ cliArgs }, pchOptions);
    await context.initController();
    let handledBy: PublicationsControllerCommandHandler<C> | undefined;
    for (const handler of commonHandlers) {
      if (await handler(context)) {
        handledBy = handler;
        break;
      }
    }
    if (!handledBy) {
      console.error("Unable to handle validly parsed docoptSpec:");
      console.dir(cliArgs);
    }
    await context.finalizeController(handledBy);
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
