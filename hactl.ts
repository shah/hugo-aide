import {
  colors,
  docopt,
  govnSvcImport as gsi,
  govnSvcVersion as gsv,
} from "./deps.ts";
import * as hc from "./hugo-config.ts";

export async function determineVersion(importMetaURL: string): Promise<string> {
  return gsv.determineVersionFromRepoTag(
    importMetaURL,
    { repoIdentity: "shah/hugo-aide" },
  );
}

const hactlVersion = await determineVersion(import.meta.url);
const docoptSpec = `
Hugo Aide Controller ${hactlVersion}.

Usage:
  hactl configure <hc-supplier-name> --module=<module.ts>... [--verbose]
  hactl inspect hc-supplier-names --module=<module.ts>...
  hactl -h | --help
  hactl --version

Options:
  -h --help             Show this screen
  <module.ts>           A Hugo Configurator TypeScript module
  <hc-supplier-name>    A Hugo Configuration supplier name
  --version             Show version
  --verbose             Be explicit about what's going on
`;

const configurators = new Set<hc.HugoConfigurator>();

export function registerConfigurator(hcp: hc.HugoConfigurator): void {
  configurators.add(hcp);
}

export interface CommandHandler<T extends CommandHandlerContext> {
  (ctx: T): Promise<true | void>;
}

export class CommandHandlerContext implements CommandHandlerContext {
  readonly isVerbose: boolean;

  constructor(
    readonly calledFromMetaURL: string,
    readonly calledFromMain: boolean,
    readonly cliOptions: docopt.DocOptions,
  ) {
    const { "--verbose": verbose } = this.cliOptions;
    this.isVerbose = verbose ? true : false;
  }

  async registerModules(): Promise<void> {
    const { "--module": moduleUrls } = this.cliOptions;
    if (Array.isArray(moduleUrls)) {
      for (const url of moduleUrls) {
        const c = await gsi.importModuleDefault<hc.HugoConfigurator>(url, {
          typeGuard: hc.isHugoConfigurator,
          onSuccessfulImport: (
            configurator: hc.HugoConfigurator,
          ): hc.HugoConfigurator => {
            registerConfigurator(configurator);
            return configurator;
          },
        });
      }
    } else {
      console.error("--module is expected to be a string[]");
    }
  }
}

export async function configureHandler(
  ctx: CommandHandlerContext,
): Promise<true | void> {
  const { "configure": configure, "<hc-supplier-name>": hcSupplierName } =
    ctx.cliOptions;
  if (configure && typeof hcSupplierName === "string") {
    await ctx.registerModules();
    configurators.forEach((c) => {
      const supplier = c.configure(hcSupplierName);
      if (supplier) {
        const fileName = hc.persistConfiguration(".", supplier);
        if (ctx.isVerbose) {
          console.log(fileName);
        }
      }
    });
    return true;
  }
}

export async function inspectHandler(
  ctx: CommandHandlerContext,
): Promise<true | void> {
  const { "inspect": inspect, "hc-supplier-names": hcSupplierNames } =
    ctx.cliOptions;
  if (inspect && hcSupplierNames) {
    await ctx.registerModules();
    configurators.forEach((hc) => {
      hc.identities().forEach((i) => {
        const c = hc.configure(i);
        console.log(
          `${colors.green(hc.name)}: ${colors.yellow(i)}, ${
            colors.blue(c?.hugConfigFileName || "<no name>")
          }`,
        );
      });
    });
    return true;
  }
}

export async function versionHandler(
  ctx: CommandHandlerContext,
): Promise<true | void> {
  const { "--version": version } = ctx.cliOptions;
  if (version) {
    console.log(hactlVersion);
    return true;
  }
}

export const commonHandlers = [versionHandler];

export async function CLI<
  T extends CommandHandlerContext = CommandHandlerContext,
>(
  docoptSpec: string,
  handlers: CommandHandler<T>[],
  prepareContext: (options: docopt.DocOptions) => T,
): Promise<void> {
  try {
    const options = docopt.default(docoptSpec);
    const context = prepareContext(options);
    let handled: true | void;
    for (const handler of handlers) {
      handled = await handler(context);
      if (handled) break;
    }
    if (!handled) {
      console.error("Unable to handle validly parsed docoptSpec:");
      console.dir(options);
    }
  } catch (e) {
    console.error(e.message);
  }
}

if (import.meta.main) {
  CLI(
    docoptSpec,
    [
      configureHandler,
      inspectHandler,
      ...commonHandlers,
    ],
    (options: docopt.DocOptions): CommandHandlerContext => {
      return new CommandHandlerContext(
        import.meta.url,
        import.meta.main,
        options,
      );
    },
  );
}
