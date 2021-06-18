import { colors, fs, path, safety } from "./deps.ts";
import "https://deno.land/x/dotenv@v2.0.0/load.ts"; // automatically load .env into environment

import * as ctl from "./controller.ts";
import * as publ from "./publication.ts";
import * as hc from "./hugo-config.ts";
import * as hicsp from "./plugins/hugo-init-convenience-scripts.ts";

/**
 * SiteModuleConfigOptions provides Hugo configuration properties whose values
 * might differ between sandbox, devl, test, staging, and production environments.
 * If a Hugo configuration property value does not change between envs, then it's
 * provided in the function siteHugoConfig but if it differs between envs then
 * it's supplied through SiteHugoConfigOptions.
 */
// deno-lint-ignore no-empty-interface
export interface SiteModuleConfigOptions {
}

// deno-lint-ignore no-empty-interface
export interface SitePublicationModule
  extends hc.HugoPublicationModule<SiteModuleConfigOptions> {
}

// deno-lint-ignore no-empty-interface
export interface SitePublicationHugoConfigurationSupplier
  extends hc.HugoConfigurationSupplier<SiteModuleConfigOptions> {
}

// deno-lint-ignore no-empty-interface
export interface SitePresentationContentGenerator
  extends publ.PublicationModuleContentProducer<SitePublController> {
}

// deno-lint-ignore no-empty-interface
export interface SiteStaticContentModule extends SitePublicationModule {
}

const netspectiveSalesforceLightningThemeSourceRepoPath =
  "github.com/netspective-studios/hugo-theme-sf-lightning";

export function netspectiveSalesforceLightningThemeModule(): SiteStaticContentModule {
  return {
    identity: "theme-netspective-slds",
    // the theme includes sample content and other data but we're only
    // using assets, layouts, and static
    mergeHugoModuleImports: () => {
      return [{
        path: netspectiveSalesforceLightningThemeSourceRepoPath,
        mounts: [{
          source: "assets",
          target: `assets`,
        }, {
          source: "layouts",
          target: `layouts`,
        }, {
          source: "static",
          target: `static`,
        }],
      }];
    },
  };
}

export function shortcodeNsModule(
  identity: string,
  repoPath = `github.com/netspective-studios/${identity}`,
): SiteStaticContentModule {
  return {
    identity: `site-${identity}`,
    mergeHugoModuleImports: () => {
      return [{
        path: repoPath,
        mounts: [{
          source: "shortcodes",
          target: `layouts/shortcodes`,
        }],
      }];
    },
  };
}

export interface SitePublishableModules {
  readonly requiredModules: SitePublicationModule[];
  readonly optionalModules: SitePublicationModule[];
  readonly allModules: SitePublicationModule[];
}

export interface SiteProductionPublOptions {
  readonly baseURL: string;
  readonly title: string;
  readonly siteHugoConfigParams?: Record<string, unknown>;
}

export interface SitePublControllerOptions
  extends ctl.PublicationsControllerOptions {
  readonly productionPubl: SiteProductionPublOptions;
  readonly experimentalPubl: {
    readonly serverPortEnvVarName: string;
    readonly hostEnvVarName: string;
    readonly baseUrlEnvVarName: string;
  };
  readonly hugoConfigFileName: string;
  readonly hugoModulePrimeName: string;
  readonly publishableModules: SitePublishableModules;
  readonly observabilityHookShellScript: string;
  readonly projectHomeRelativeToObservabilityDir: string;
  readonly siteHugoConfig: (
    modules: SitePublicationModule[],
    mmco: SiteModuleConfigOptions,
  ) => Omit<hc.HugoConfiguration, "baseURL" | "title">;
}

export function sitePublControllerOptions(
  _cli: ctl.CliArgsSupplier,
  productionPubl: SiteProductionPublOptions,
  inherit: ctl.PublicationsControllerOptions,
): SitePublControllerOptions {
  // TODO update to get this from CLI or environment variable
  const requiredModules = [
    netspectiveSalesforceLightningThemeModule(),
    shortcodeNsModule("hugo-shortcode-diagram"),
    shortcodeNsModule("hugo-shortcode-badge"),
  ];
  return {
    ...inherit,
    productionPubl,
    experimentalPubl: {
      serverPortEnvVarName: "PUBCTL_PORT",
      hostEnvVarName: "PUBCTL_HOST",
      baseUrlEnvVarName: "PUBCTL_BASE_URL",
    },
    hugoConfigFileName: "hugo-config.auto.toml",
    hugoModulePrimeName: "site",
    observabilityHookShellScript: path.resolve(
      inherit.observabilitySrcHome,
      "publication-observability.hook-pubctl.sh",
    ),
    projectHomeRelativeToObservabilityDir: path.relative(
      inherit.observabilitySrcHome,
      inherit.projectHome,
    ),
    publishableModules: {
      requiredModules,
      optionalModules: [],
      allModules: requiredModules,
    },
    siteHugoConfig: (modules, mmco) => {
      const merged = hc.mergeHugoPublicationModulesConfig(modules, mmco);
      return {
        defaultContentLanguage: "en",
        languageCode: "en-us",
        theme: netspectiveSalesforceLightningThemeSourceRepoPath,
        markup: {
          defaultMarkdownHandler: "goldmark",
          goldmark: { renderer: { unsafe: true } },
        },
        module: { imports: merged.imports },
        outputFormats: { Calendar: { protocol: "https://" } },
        outputs: {
          home: ["HTML", "JSON"],
        },
        params: {
          ...merged.params,
          ...productionPubl.siteHugoConfigParams,
          ignoreFiles: [".hook-pubctl.*", ".hook-pubctl-draft.*"],
          brand: "Netspective",
          fuseSearch: true,
        },
        permalinks: { ...merged.permalinks },
        sitemap: { changeFreq: "daily", filename: "sitemap.xml", priority: 1 },
        taxonomies: { ...merged.taxonomies },
      };
    },
  };
}

export interface SiteSandboxPublicationOptions {
  readonly modules: SitePublicationModule[];
  readonly baseURL: string;
  readonly title: string;
}

export class SitePublController extends ctl.PublicationsController {
  constructor(
    readonly cli: ctl.CliArgsSupplier,
    readonly mpco: SitePublControllerOptions,
  ) {
    super(cli, mpco);
    this.pluginsMgr.registerValidPlugin({
      plugin: hicsp.pubCtlHook,
      source: hicsp.pubCtlHook.source,
    });
    const baseUrlFromEnv = Deno.env.get(
      mpco.experimentalPubl.baseUrlEnvVarName,
    );
    const hostfromEnv = Deno.env.get(mpco.experimentalPubl.hostEnvVarName);
    const sites: hc.HugoPublication<SiteModuleConfigOptions>[] = [
      {
        identity: "sandbox",
        hugoModuleName: this.mpco.hugoModulePrimeName,
        hugoConfigSupplier: () =>
          this.sandboxPublisherConfig({
            modules: this.mpco.publishableModules.allModules,
            baseURL: baseUrlFromEnv ? baseUrlFromEnv : (`http://${hostfromEnv ||
              "localhost"}:${Deno.env.get(
                mpco.experimentalPubl.serverPortEnvVarName,
              ) ?? 3100}`),
            title: `${this.mpco.productionPubl.title} (Sandbox)`,
          }),
      },
      {
        identity: "production",
        hugoModuleName: this.mpco.hugoModulePrimeName,
        hugoConfigSupplier: () => this.productionPublisherConfig(),
      },
    ];
    sites.forEach((pdo) => this.publications[pdo.identity] = pdo);
    this.publModules.push(...this.mpco.publishableModules.allModules);
  }

  productionPublisherConfig(): SitePublicationHugoConfigurationSupplier {
    return {
      hugoConfigFileName: this.mpco.hugoConfigFileName,
      hugoConfig: {
        ...hc.typicalHugoConfig,
        baseURL: this.mpco.productionPubl.baseURL,
        title: this.mpco.productionPubl.title,
        ...this.mpco.siteHugoConfig(
          this.mpco.publishableModules.allModules,
          {},
        ),
      },
      hugoConfigModules: () => {
        return this.mpco.publishableModules.allModules;
      },
    };
  }

  sandboxPublisherConfig(
    sbo: SiteSandboxPublicationOptions,
  ): SitePublicationHugoConfigurationSupplier {
    const { modules, baseURL, title } = sbo;
    return {
      hugoConfigFileName: this.mpco.hugoConfigFileName,
      hugoConfig: {
        ...hc.typicalHugoConfig,
        baseURL: baseURL,
        title: title,
        ...this.mpco.siteHugoConfig(modules, {}),
      },
      hugoConfigModules: () => {
        return modules;
      },
    };
  }

  // deno-lint-ignore require-await
  async clean() {
    super.clean();
    ["go.mod"].forEach((f) => {
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

  async hugoInit(
    publ: hc.HugoPublication<SiteModuleConfigOptions>,
    destPath: string,
  ): Promise<boolean> {
    // The publication-observability.hook-pubctl.sh extension runs during:
    //   pubctl.ts build prepare
    //   pubctl.ts build finalize
    // Before it runs, we need to update the script with all the paths that
    // make up the Hugo build so that observability metrics are run only for
    // the imported modules.
    const { observabilityHookShellScript } = this.mpco;
    if (fs.existsSync(observabilityHookShellScript)) {
      const importPaths: string[] = [];
      const hcs = publ.hugoConfigSupplier(this);
      hcs.hugoConfigModules().forEach((mm) => {
        mm.mergeHugoModuleImports({}).map((i) => {
          // 'hugo-import' is the nature of the path (used for observability analytics)
          if (i.path) importPaths.push(`hugo-import ${i.path}`);
        });
      });
      // this will only be available after the build but publication-observability.hook-pubctl.sh
      // is smart enough to skip destintations when necessary
      importPaths.push(
        // 'hugo-dest-html' is the nature of the path (used for observability analytics)
        `hugo-dest-html ${
          path.join(
            this.mpco.projectHomeRelativeToObservabilityDir,
            "public",
          )
        }`,
      );
      const scriptSrc = Deno.readTextFileSync(observabilityHookShellScript);
      // replace everything between analyzePaths=(...)
      const updateScriptSrc = scriptSrc.replace(
        /analyzePaths=\($(.|[\r\n])*?[\r\n]\)$/m,
        `analyzePaths=(\n${importPaths.join("\n")}\n)`,
      );
      Deno.writeTextFileSync(observabilityHookShellScript, updateScriptSrc);
      Deno.chmodSync(observabilityHookShellScript, 0o755);
      if (this.pco.isVerbose) {
        console.log(
          "Updated",
          colors.yellow(
            path.relative(this.mpco.projectHome, observabilityHookShellScript),
          ),
          "with",
          colors.blue(importPaths.length.toString()),
          "paths",
        );
      }
    }

    // Now that we've updated publication-observability.hook-pubctl.sh, do the init
    // which will also run all extensions with 'hugo-init' command.
    return await super.hugoInit(publ, destPath);
  }

  async hugoInspect(): Promise<boolean> {
    console.log(colors.dim("Imported Hugo modules:"));
    this.mpco.publishableModules.allModules.forEach((mm) => {
      const required = this.mpco.publishableModules.requiredModules.find((rm) =>
        rm.identity == mm.identity
      );
      mm.mergeHugoModuleImports({}).map((i) => i.path).forEach((path) => {
        console.log(
          required
            ? `${colors.green(path || "??")} (always included)`
            : colors.yellow(path || "??"),
          colors.dim(`[${mm.identity}]`),
        );
      });
    });

    return await super.hugoInspect();
  }
}

export interface SiteControllerCommandHandlerCaller
  extends ctl.CommandHandlerCaller {
  readonly productionPublOptions: SiteProductionPublOptions;
}

export const isSiteControllerCommandHandlerCaller = safety.typeGuard<
  SiteControllerCommandHandlerCaller
>("productionPublOptions");

export async function CLI(
  caller: ctl.CommandHandlerCaller,
): Promise<void> {
  if (!isSiteControllerCommandHandlerCaller(caller)) {
    console.log(
      "pubctl.ts CLI() requires `caller` of type SiteControllerCommandHandlerCaller",
    );
    return;
  }
  await ctl.CLI(caller, {
    prepareControllerOptions: (
      caller,
      cliArgs,
    ): SitePublControllerOptions => {
      const productionPublOptions: SiteProductionPublOptions =
        isSiteControllerCommandHandlerCaller(caller)
          ? caller.productionPublOptions
          : {
            baseURL: "https://uknown.com",
            title:
              "pubctl.ts CLI() requires `caller` of type SiteControllerCommandHandlerCaller",
          };
      return sitePublControllerOptions(
        { cliArgs },
        productionPublOptions,
        ctl.publicationsControllerOptions(caller, cliArgs),
      );
    },
    prepareController: (_caller, cliArgs, options) => {
      return new SitePublController(
        { cliArgs },
        options as SitePublControllerOptions,
      );
    },
  });
}

// if (import.meta.main) {
//   const productionPublOptions: SiteProductionPublOptions = {
//     baseURL: "https://gpm.medigy.com",
//     title: "Medigy GPM",
//     siteHugoConfigParams: {
//       github_repo:
//         "https://gl.infra.medigy.com/medigy-digital-properties/gpm.medigy.com",
//       github_subdir: ".",
//     },
//   };
//   if (orch.isOrchestrationCliRequest()) {
//     orch.orchestrationCLI(CLI, (inherit) => {
//       const caller: SiteControllerCommandHandlerCaller = {
//         ...inherit,
//         productionPublOptions,
//       };
//       return caller;
//     });
//   } else {
//     const caller: SiteControllerCommandHandlerCaller = {
//       calledFromMain: import.meta.main,
//       calledFromMetaURL: import.meta.url,
//       version: "v0.8.0",
//       productionPublOptions,
//     };
//     CLI(caller);
//   }
// }
