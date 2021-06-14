import {
  artfPersist as ap,
  colors,
  extend as ex,
  fs,
  path,
  valueMgr as vm,
} from "../deps.ts";
import * as publ from "../mod.ts";

const pluginSrc: ex.PluginSource = {
  systemID:
    "github.com/shah/hugo-aide/plugins/hugo-init-convenience-scripts.ts",
  abbreviatedName: "hugo-init",
  friendlyName: "hugo-aide/plugins/hugo-init-convenience-scripts.ts",
};

export const shfileArtifactNature =
  new (class implements ap.TextArtifactNature {
    readonly isTextArtifactNature = true;
    readonly name = "SH";
    readonly defaultFileExtn: string = ".sh";
    readonly fileExtensions: string[] = [this.defaultFileExtn];
    readonly defaultPreamble: vm.TextValue =
      `#!/usr/bin/env bash\n# Code generated by ${
        import.meta.url
      }. DO NOT EDIT.\n\nset -o errexit -o nounset -o pipefail\n\n`;

    constructor() {}
  })();

export interface HugoPublAutomationFacts {
  // deno-lint-ignore no-explicit-any
  readonly hugoConfig: publ.HugoConfigurationSupplier<any>;
  readonly htmlDestHomeRel: string;
  readonly buildResultsFile: string;
  readonly observabilitySrcHomeRel: string;
  readonly observabilityHtmlDestHomeRel: string;
}

export function automationFacts(
  hc: publ.HookContext<publ.PublicationsController>,
): HugoPublAutomationFacts {
  // deno-lint-ignore no-explicit-any
  if (publ.isHugoPublProxyableCommand<any>(hc.command)) {
    const { projectHome } = hc.container.pco;
    return {
      hugoConfig: hc.command.publ.hugoConfigSupplier(hc.container),
      buildResultsFile: "hugo-build-results.auto.txt",
      htmlDestHomeRel: path.relative(
        projectHome,
        hc.container.pco.htmlDestHome,
      ),
      observabilitySrcHomeRel: path.relative(
        projectHome,
        hc.container.pco.observabilitySrcHome,
      ),
      observabilityHtmlDestHomeRel: path.relative(
        projectHome,
        hc.container.pco.observabilityHtmlDestHome,
      ),
    };
  }
  throw Error("publ.isHugoPublProxyableCommand<any>(hc.command) must be true");
}

export function publishScriptArtifact(
  hc: publ.HookContext<publ.PublicationsController>,
): ap.TextArtifact {
  const mta = hc.createMutableTextArtifact({ nature: shfileArtifactNature });
  // deno-lint-ignore no-explicit-any
  if (!(publ.isHugoPublProxyableCommand<any>(hc.command))) {
    mta.appendText(
      hc,
      `${
        import.meta.url
      } expects publishScript() hc.command to be HugoPublProxyableCommand`,
    );
    return mta;
  }

  const {
    hugoConfig,
    buildResultsFile,
    observabilitySrcHomeRel,
    observabilityHtmlDestHomeRel,
  } = automationFacts(hc);
  mta.appendText(
    hc,
    `PUBCTL_TXID=$(curl --silent https://www.uuidgenerator.net/api/version4)
HUGO_BUILD_RESULTS_FILE="${observabilitySrcHomeRel}/${buildResultsFile}"
deno run -A --unstable pubctl.ts hugo clean --tx-id="$PUBCTL_TXID"
deno run -A --unstable pubctl.ts generate --schedule="@publish" --tx-id="$PUBCTL_TXID" --verbose
deno run -A --unstable pubctl.ts hugo init --publ=${hc.command.publ.identity} --tx-id="$PUBCTL_TXID" --verbose
deno run -A --unstable pubctl.ts build prepare --publ=${hc.command.publ.identity} --schedule="@publish" --tx-id="$PUBCTL_TXID" --verbose
mkdir -p ${observabilitySrcHomeRel}
hugo --config ${hugoConfig.hugoConfigFileName} --templateMetrics --templateMetricsHints > "$HUGO_BUILD_RESULTS_FILE"
deno run -A --unstable pubctl.ts build finalize --publ=${hc.command.publ.identity} --schedule="@publish" --tx-id="$PUBCTL_TXID" --observability-hugo-results-file="$HUGO_BUILD_RESULTS_FILE" --verbose
mkdir -p ${observabilityHtmlDestHomeRel}
cp "$HUGO_BUILD_RESULTS_FILE" ${observabilityHtmlDestHomeRel}
echo "Hugo build results in ${observabilityHtmlDestHomeRel}/${buildResultsFile}"
`,
  );
  return mta;
}

export function experimentScriptArtifact(
  hc: publ.HookContext<publ.PublicationsController>,
): ap.TextArtifact {
  const mta = hc.createMutableTextArtifact({ nature: shfileArtifactNature });
  // deno-lint-ignore no-explicit-any
  if (!(publ.isHugoPublProxyableCommand<any>(hc.command))) {
    mta.appendText(
      hc,
      `${
        import.meta.url
      } expects experimentScriptArtifact() hc.command to be HugoPublProxyableCommand`,
    );
    return mta;
  }

  const {
    hugoConfig,
    buildResultsFile,
    observabilitySrcHomeRel,
    observabilityHtmlDestHomeRel,
    htmlDestHomeRel,
  } = automationFacts(hc);
  mta.appendText(
    hc,
    `PUBCTL_TXID=$(curl --silent https://www.uuidgenerator.net/api/version4)
HUGO_BUILD_RESULTS_FILE="${observabilitySrcHomeRel}/${buildResultsFile}"
SERVER=\${1:-}
if [ -z "$SERVER" ]; then
    echo "Expecting 'hugo', 'hugo-regen', 'file', or 'file-regen' as first parameter."
    echo "  * 'hugo' server will watch files for changes and reload them during experimentation."
    echo "    DO NOT USE 'hugo' server for large sites like full Medigy Prime builds, it's slower."
    echo "  * 'hugo-regen' is same as 'hugo' except will cleanup generated files and regenerate"
    echo "    content and re-initialize Hugo configuration."
    echo "  * 'file' server will not watch files for changes but serves them as close to production"
    echo "    as possible. It's best for local testing of large sites like full Medigy Prime builds."
    echo "  * 'file-regen' is same as 'file' except will cleanup generated files and regenerate"
    echo "    content and re-initialize Hugo configuration."
    echo ""
    echo "Examples:"
    echo "  ./experiment.sh hugo"
    echo "  ./experiment.sh file-regen"
    exit -1
fi
REGENERATE=0
PORT=\${PUBCTL_PORT:-${hc.container.pco.hugoServerPort ||
      "hugoServerPort not in hc.container.pco"}}
HOST=\${PUBCTL_HOST:-localhost}

function regenerate {
  if [[ "$REGENERATE" -eq 1 ]]; then
    echo "Regenerating content and re-initializing Hugo config"
    deno run -A --unstable pubctl.ts hugo clean --tx-id="$PUBCTL_TXID"
    deno run -A --unstable pubctl.ts generate --schedule="@publish" --tx-id="$PUBCTL_TXID" --verbose
    deno run -A --unstable pubctl.ts hugo init --publ=${hc.command.publ.identity}${
      hc.container.pco.customModules.map((cm) => `--module=${cm}`).join(" ")
    } --tx-id="$PUBCTL_TXID" --verbose
  else
    echo "Not regenerating content or re-initializing Hugo config"
  fi
}

# If we're asking for *-regen, rewrite the variables to setup content regeneration
case $SERVER in
    hugo-regen)
      SERVER=hugo
      REGENERATE=1
    ;;

    file-regen)
      SERVER=file
      REGENERATE=1
    ;;
esac

case $SERVER in
    hugo)
      regenerate
      deno run -A --unstable pubctl.ts build prepare --publ=${hc.command.publ.identity} --schedule="@publish" --tx-id="$PUBCTL_TXID" --verbose
      hugo server --config hugo-config.auto.toml --renderToDisk public --port $PORT --templateMetrics --templateMetricsHints
    ;;

    file)
      regenerate
      deno run -A --unstable pubctl.ts build prepare --publ=${hc.command.publ.identity} --schedule="@publish" --tx-id="$PUBCTL_TXID" --verbose
      mkdir -p ${observabilitySrcHomeRel}
      hugo --config ${hugoConfig.hugoConfigFileName} --templateMetrics --templateMetricsHints > "$HUGO_BUILD_RESULTS_FILE"
      deno run -A --unstable pubctl.ts build finalize --publ=${hc.command.publ.identity} --schedule="@publish" --tx-id="$PUBCTL_TXID" --observability-hugo-results-file="$HUGO_BUILD_RESULTS_FILE" --verbose
      mkdir -p ${observabilityHtmlDestHomeRel}
      cp "$HUGO_BUILD_RESULTS_FILE" ${observabilityHtmlDestHomeRel}
      echo "Hugo build results in ${observabilityHtmlDestHomeRel}/${buildResultsFile}"
      echo "Serving files in '${htmlDestHomeRel}'"
      denoStdLibVersion=\`curl -s https://api.github.com/repos/denoland/deno_std/releases | jq '.[0].name' -r\`
      deno run -A --unstable https://deno.land/std@\${denoStdLibVersion}/http/file_server.ts ${htmlDestHomeRel} --port $PORT --host $HOST
    ;;

    *)
      echo "unknown server type '$SERVER'"
      echo "Expecting either 'hugo' or 'file' as first parameter to indicate which server to use for experimenting."
    ;;    
esac`,
  );
  return mta;
}

export function execute(
  hc: publ.HookContext<publ.PublicationsController>,
) {
  const publishSh = "publish.sh";
  const experimentSh = "experiment.sh";
  const files = [publishSh, experimentSh];
  switch (hc.command.proxyCmd) {
    case publ.HookLifecycleStep.HUGO_INIT:
      hc.persistExecutableScriptArtifact(
        publishSh,
        publishScriptArtifact(hc),
      );
      hc.persistExecutableScriptArtifact(
        experimentSh,
        experimentScriptArtifact(hc),
      );
      return publ.defaultPubCtlHookResultEnhancer(hc);

    case publ.HookLifecycleStep.DESCRIBE:
      console.log(
        colors.dim(`[${pluginSrc.abbreviatedName}]`),
        `Will generate ${files.map((f) => colors.yellow(f)).join(", ")}`,
      );
      return publ.defaultPubCtlHookResultEnhancer(hc);

    case publ.HookLifecycleStep.HUGO_CLEAN:
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
