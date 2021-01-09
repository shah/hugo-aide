import { fs, path, safety, shell } from "./deps.ts";

// deno-lint-ignore no-empty-interface
export interface PluginContainer {
}

export type PluginNatureIdentity = string;

export interface PluginNature {
  readonly identity: PluginNatureIdentity;
}

export interface PluginRegistrationIssue {
  readonly source: PluginSource;
  readonly diagnostics: (Error | string)[];
}

export interface PluginRegistration {
  readonly source: PluginSource;
}

export interface ValidPluginRegistration extends PluginRegistration {
  readonly plugin: Plugin;
}

export const isValidPluginRegistration = safety.typeGuard<
  ValidPluginRegistration
>(
  "plugin",
);

export interface InvalidPluginRegistration extends PluginRegistration {
  readonly issues: PluginRegistrationIssue[];
}

export const isInvalidPluginRegistration = safety.typeGuard<
  InvalidPluginRegistration
>(
  "source",
  "issues",
);

export interface PluginRegistrar {
  (src: PluginSource): Promise<PluginRegistration>;
}

export interface PluginRegistrarSync {
  (src: PluginSource): PluginRegistration;
}

export interface PluginsSupplier {
  readonly plugins: Plugin[];
}

export type FileSystemPathAndFName = string;
export type FileSystemPathOnly = string;
export type FileSystemGlob = string;
export type FileSystemGlobs = FileSystemGlob[];

export interface FileSystemPluginsSupplier extends PluginsSupplier {
  readonly localFsSources: FileSystemGlobs;
}

export const isLocalFsPluginManager = safety.typeGuard<
  FileSystemPluginsSupplier
>(
  "localFsSources",
);

export interface PluginContext<T extends PluginContainer> {
  readonly container: T;
  readonly plugin: Plugin;
}

export function isPluginContext<T extends PluginContainer>(
  o: unknown,
): o is PluginContext<T> {
  const isPC = safety.typeGuard<PluginContext<T>>("container", "plugin");
  return isPC(o);
}

export type PluginIdentity = string;

export interface PluginSource {
  readonly systemID: PluginIdentity;
  readonly friendlyName: PluginIdentity;
}

export const isPluginSource = safety.typeGuard<PluginSource>(
  "systemID",
  "friendlyName",
);

export interface FileSystemPluginSource extends PluginSource {
  readonly absPathAndFileName: string;
}

export const isFileSystemPluginSource = safety.typeGuard<
  FileSystemPluginSource
>(
  "absPathAndFileName",
);

export interface Plugin {
  readonly nature: PluginNature;
  readonly source: PluginSource;
}

export const isPlugin = safety.typeGuard<Plugin>("nature", "source");

export interface ActionResult<T extends PluginContainer> {
  readonly pc: PluginContext<T>;
}

export interface Action<T extends PluginContainer> {
  readonly execute: (pc: PluginContext<T>) => Promise<ActionResult<T>>;
}

export function isActionPlugin<T extends PluginContainer>(
  o: unknown,
): o is Plugin & Action<T> {
  if (isPlugin(o)) {
    return "execute" in o;
  }
  return false;
}

export interface FilterResult<T extends PluginContainer> {
  readonly pc: PluginContext<T>;
}

export interface Filter<T extends PluginContainer> {
  readonly filter: (pc: PluginContext<T>) => Promise<FilterResult<T>>;
}

export function isFilterPlugin<T extends PluginContainer>(
  o: unknown,
): o is Plugin & Filter<T> {
  if (isPlugin(o)) {
    return "filter" in o;
  }
  return false;
}

export interface ShellExePlugin<T extends PluginContainer>
  extends Plugin, Action<T> {
  readonly shellCmd: (pc: PluginContext<T>) => string[];
  readonly envVars?: (pc: PluginContext<T>) => Record<string, string>;
}

export function isShellExePlugin<T extends PluginContainer>(
  o: unknown,
): o is ShellExePlugin<T> {
  if (isPlugin(o)) {
    const isShellExPlugin = safety.typeGuard<ShellExePlugin<T>>(
      "shellCmd",
      "envVars",
    );
    return isShellExPlugin(o);
  }
  return false;
}

export interface DenoModulePlugin extends Plugin {
  readonly module: unknown;
}

export const isDenoModulePlugin = safety.typeGuard<DenoModulePlugin>(
  "nature",
  "source",
  "module",
);

export interface DiscoverPluginOptions {
  readonly nature: PluginNature;
}

export interface ShellFileRegistrarOptions<T extends PluginContainer> {
  readonly envVarsSupplier?: (pc: PluginContext<T>) => Record<string, string>;
  readonly shellCmdEnhancer?: (
    pc: PluginContext<T>,
    suggestedCmd: string[],
  ) => string[];
  readonly runShellCmdOpts?: (
    pc: PluginContext<T>,
  ) => shell.RunShellCommandOptions;
}

export interface ShellFileActionResult<T extends PluginContainer>
  extends ActionResult<T> {
  readonly rscResult: shell.RunShellCommandResult;
}

export function isShellFileActionResult<T extends PluginContainer>(
  o: unknown,
): o is ShellFileActionResult<T> {
  const isActionResult = safety.typeGuard<ShellFileActionResult<T>>(
    "rscResult",
  );
  return isActionResult(o);
}

export function shellFileRegistrar<T extends PluginContainer>(
  options: ShellFileRegistrarOptions<T>,
): PluginRegistrar {
  const isExecutable = (path: string): false | string[] => {
    const fi = Deno.statSync(path);
    const isExe = fi.mode != null ? (fi.mode & 0o0001 ? true : false) : true;
    if (isExe) {
      const cmd = ["/bin/sh", "-c", path];
      // if (step) cmd.push(step);
      // if (this.targets.length > 0) cmd.push(...this.targets);
      // if (this.isVerbose) cmd.push("--verbose");
      // if (this.isDryRun) cmd.push("--dry-run");
      // for (const arg of Object.entries(this.arguments)) {
      //   const [name, value] = arg;
      //   cmd.push(name, value);
      // }
      return cmd;
    }
    return false;
  };

  // deno-lint-ignore require-await
  return async (source: PluginSource): Promise<PluginRegistration> => {
    if (isFileSystemPluginSource(source)) {
      const isExecutableCmd = isExecutable(source.absPathAndFileName);
      if (!isExecutableCmd) {
        const result: InvalidPluginRegistration = {
          source,
          issues: [
            { source, diagnostics: ["executable bit not set on source"] },
          ],
        };
        return result;
      }
      const plugin: ShellExePlugin<T> = {
        source,
        nature: { identity: "shell-file-executable" },
        envVars: options.envVarsSupplier,
        shellCmd: (pc: PluginContext<T>): string[] => {
          return options.shellCmdEnhancer
            ? options.shellCmdEnhancer(pc, isExecutableCmd)
            : isExecutableCmd;
        },
        execute: async (pc: PluginContext<T>): Promise<ActionResult<T>> => {
          const cmd = options.shellCmdEnhancer
            ? options.shellCmdEnhancer(pc, isExecutableCmd)
            : isExecutableCmd;
          const rscResult = await shell.runShellCommand(
            {
              cmd: cmd,
              cwd: path.dirname(source.absPathAndFileName),
              env: options.envVarsSupplier
                ? options.envVarsSupplier(pc)
                : undefined,
            },
            options.runShellCmdOpts ? options.runShellCmdOpts(pc) : undefined,
          );
          const actionResult: ShellFileActionResult<T> = {
            pc,
            rscResult,
          };
          return actionResult;
        },
      };
      const result: ValidPluginRegistration = { source, plugin };
      return result;
    }
    const result: InvalidPluginRegistration = {
      source,
      issues: [{
        source,
        diagnostics: [
          "shellFileRegistrar() only knows how to register file system sources",
        ],
      }],
    };
    return result;
  };
}

export interface TypeScriptRegistrarOptions {
  readonly isValidModule: (
    potential: DenoModulePlugin,
  ) => ValidPluginRegistration | InvalidPluginRegistration;
}

export function typeScriptFileRegistrar(
  tsro: TypeScriptRegistrarOptions,
): PluginRegistrar {
  return async (source: PluginSource): Promise<PluginRegistration> => {
    if (isFileSystemPluginSource(source)) {
      try {
        // the hugo-aide package is going to be URL-imported but the files
        // we're importing are local to the calling pubctl.ts in the project
        // so we need to use absolute paths
        const module = await import(
          path.toFileUrl(source.absPathAndFileName).toString()
        );
        if (module) {
          const potential: DenoModulePlugin = {
            module,
            source,
            nature: { identity: "deno-module" },
          };
          return tsro.isValidModule(potential);
        } else {
          const result: InvalidPluginRegistration = {
            source,
            issues: [{
              source,
              diagnostics: [
                "invalid typeScriptFileRegistrar plugin: unable to import module (unknown error)",
              ],
            }],
          };
          return result;
        }
      } catch (err) {
        const result: InvalidPluginRegistration = {
          source,
          issues: [{ source, diagnostics: [err] }],
        };
        return result;
      }
    }
    const result: InvalidPluginRegistration = {
      source,
      issues: [{
        source,
        diagnostics: [
          "typeScriptFileRegistrar() only knows how to register file system sources",
        ],
      }],
    };
    return result;
  };
}

export function fileSystemPluginRegistrar<T extends PluginContainer>(
  src: FileSystemPluginSource,
  sfro: ShellFileRegistrarOptions<T>,
  tsro: TypeScriptRegistrarOptions,
): PluginRegistrar | undefined {
  switch (path.extname(src.absPathAndFileName)) {
    case ".ts":
      return typeScriptFileRegistrar(tsro);

    default:
      return shellFileRegistrar<T>(sfro);
  }
}

export interface DiscoverFileSystemPluginSource extends FileSystemPluginSource {
  readonly discoveryPath: FileSystemPathOnly;
  readonly glob: FileSystemGlob;
}

export const isDiscoverFileSystemPluginSource = safety.typeGuard<
  DiscoverFileSystemPluginSource
>("discoveryPath", "glob");

export interface DiscoverFileSystemPluginsOptions<T extends PluginContainer> {
  readonly discoveryPath: FileSystemPathOnly;
  readonly globs: FileSystemGlobs;
  readonly onValidPlugin: (vpr: ValidPluginRegistration) => void;
  readonly onInvalidPlugin?: (ipr: InvalidPluginRegistration) => void;
  readonly shellFileRegistryOptions: ShellFileRegistrarOptions<T>;
  readonly typeScriptFileRegistryOptions: TypeScriptRegistrarOptions;
}

export async function discoverFileSystemPlugins<T extends PluginContainer>(
  options: DiscoverFileSystemPluginsOptions<T>,
): Promise<void> {
  const { discoveryPath: homePath, globs, onValidPlugin, onInvalidPlugin } =
    options;
  for (const glob of globs) {
    for (const we of fs.expandGlobSync(glob, { root: options.discoveryPath })) {
      if (we.isFile) {
        const dfspSrc: DiscoverFileSystemPluginSource = {
          discoveryPath: homePath,
          glob,
          systemID: we.path,
          friendlyName: path.relative(homePath, we.path),
          absPathAndFileName: we.path,
        };

        const register = fileSystemPluginRegistrar(
          dfspSrc,
          options.shellFileRegistryOptions,
          options.typeScriptFileRegistryOptions,
        );
        if (register) {
          const registration = await register(dfspSrc);
          if (isValidPluginRegistration(registration)) {
            onValidPlugin(registration);
          }
          if (isInvalidPluginRegistration(registration) && onInvalidPlugin) {
            onInvalidPlugin(registration);
          }
        }
      }
    }
  }
}
