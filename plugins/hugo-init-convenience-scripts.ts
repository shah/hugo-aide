import { colors, extend as ex, fs, path } from "../deps.ts";
import * as publ from "../mod.ts";

const pluginSrc: ex.PluginSource = {
  systemID:
    "github.com/shah/hugo-aide/plugins/hugo-init-convenience-scripts.ts",
  abbreviatedName: "hugo-init",
  friendlyName: "hugo-aide/plugins/hugo-init-convenience-scripts.ts",
};

export function execute(
  hc: publ.HookContext<publ.PublicationsController>,
) {
  const files = ["publish.sh", "experiment.sh"];
  switch (hc.command.proxyCmd) {
    case publ.HookLifecycleStep.DESCRIBE:
      console.log(
        colors.dim(`[${pluginSrc.abbreviatedName}]`),
        `Will generate ${files.map((f) => colors.yellow(f)).join(", ")}`,
      );
      return publ.defaultPubCtlHookResultEnhancer(hc);

    case publ.HookLifecycleStep.CLEAN:
      files.forEach((f) => {
        const absPath = path.resolve(hc.container.pco.projectHome, f);
        if (fs.existsSync(absPath)) {
          if (hc.container.pco.isDryRun) {
            if (hc.onActivity) {
              hc.onActivity(
                ex.fs.proposeRemoveLocalFile(absPath, f),
                { dryRun: true },
              );
            }
          } else {
            Deno.removeSync(absPath);
            if (hc.onActivity) {
              hc.onActivity(ex.fs.removedLocalFile(absPath, f));
            }
          }
        }
      });
      return publ.defaultPubCtlHookResultEnhancer(hc);
  }

  return publ.defaultPubCtlHookSync(hc);
}

export const pubCtlHook:
  & ex.DenoModulePlugin
  & ex.Action<publ.PublicationsController> = {
    module: this,
    // deno-lint-ignore require-await
    execute: async (
      pc: ex.PluginContext<publ.PublicationsController>,
    ): Promise<ex.ActionResult<publ.PublicationsController>> => {
      const result: ex.DenoFunctionModuleActionResult<
        publ.PublicationsController
      > = {
        pc,
        dfmhResult: execute(
          pc as publ.HookContext<publ.PublicationsController>,
        ),
      };
      return result;
    },
    nature: { identity: "deno-pubctl-hook" },
    source: pluginSrc,
  };

export default pubCtlHook;
