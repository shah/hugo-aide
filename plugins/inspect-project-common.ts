import {
  colors,
  extend as ex,
  fs,
  inspectAsset as ipa,
  path,
} from "../deps.ts";
import * as publ from "../mod.ts";

export const inspectionDiagsCategory = "project.assets.filenames";

export async function inspectProjectAssetFileNames(
  srcPath: string,
): Promise<ipa.TypicalAssetInspectionDiags> {
  const pipe = ipa.assetInspectionPipe(
    ipa.inspectFileNameSpaces,
    ipa.inspectFileNameCaseSensitivity,
  );
  const diags = new ipa.TypicalAssetInspectionDiags(
    ipa.assetInspectionPipeContext(),
  );
  for (const we of fs.walkSync(srcPath, { skip: [/\.git/, /README.md/] })) {
    await pipe({ absPathAndFileName: we.path }, diags);
  }
  return diags;
}

export async function pubCtlHook(
  hc: publ.HookContext<publ.PublicationsController>,
): Promise<ex.DenoFunctionModuleHandlerResult> {
  const srcPath = hc.container.pco.projectHome;
  switch (hc.command.proxyCmd) {
    case publ.HookLifecycleStep.INSPECT:
      if (hc.onInspectionDiags) {
        hc.onInspectionDiags(
          await inspectProjectAssetFileNames(srcPath),
          inspectionDiagsCategory,
        );
      } else {
        console.warn(
          colors.red("hc.onInspectionDiags() not supplied"),
          colors.dim(
            `in [${
              path.basename(import.meta.url)
            }].inspect(${inspectionDiagsCategory})`,
          ),
        );
      }
      return publ.defaultPubCtlHookResultEnhancer(hc);

    case publ.HookLifecycleStep.DESCRIBE:
      console.log(
        `Will inspect ${
          colors.yellow(
            path.relative(hc.container.pco.projectHome, srcPath) ||
              "current directory",
          )
        } project assets for common issues`,
      );
      return publ.defaultPubCtlHookResultEnhancer(hc);
  }

  return publ.defaultPubCtlHookSync(hc);
}

export default pubCtlHook;
