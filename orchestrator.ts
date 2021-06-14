import * as colors from "https://deno.land/std@0.98.0/fmt/colors.ts";
import * as docopt from "https://denopkg.com/Eyal-Shalev/docopt.js@v1.0.7/src/docopt.ts";
import * as path from "https://deno.land/std@0.98.0/path/mod.ts";
import * as uuid from "https://deno.land/std@0.93.0/uuid/mod.ts";
import * as ha from "./mod.ts";
import "https://deno.land/x/dotenv@v2.0.0/load.ts"; // automatically load .env into environment

const orchestrationCmd = path.basename(import.meta.url);
const orchestrationVersion = "0.2.0";
enum OrchestrationNature {
  experiment = "experiment",
  publish = "publish",
}
enum OrchestrationServerNature {
  file,
  hugo,
}
interface OrchestrationCliArguments {
  orchestration: OrchestrationNature;
  server: OrchestrationServerNature;
  regenerate: boolean;
  verbose: boolean;
  publID: string;
  hugoBuildResultsFileName: string;
}

function prepareOrchestrationArgs(): OrchestrationCliArguments {
  try {
    const cliArgs = docopt.default(`
Publication Controller Orchestrator ${orchestrationVersion}.

Usage:
  ${orchestrationCmd} experiment (hugo|file) [--publ=<publ-id>] [--regenerate] [--verbose] [--hugo-build-results=<file>]
  ${orchestrationCmd} publish [--publ=<publ-id>] [--verbose] [--hugo-build-results=<file>]
  ${orchestrationCmd} -h | --help

Options:
  --publ=<publ-id>             A publication configuration supplier name [default: sandbox]
  --hugo-build-results=<file>  Destination for Hugo build output [default: hugo-build-results.auto.txt]
  --regenerate                 Cleanup generated files, regenerate content, and re-initialize Hugo configuration
  -h --help                    Show this screen
    `);
    const orchestration = cliArgs.experiment
      ? OrchestrationNature.experiment
      : OrchestrationNature.publish;
    return {
      orchestration,
      server: orchestration == OrchestrationNature.experiment
        ? (cliArgs.hugo
          ? OrchestrationServerNature.hugo
          : OrchestrationServerNature.file)
        : OrchestrationServerNature.file,
      regenerate: orchestration == OrchestrationNature.experiment
        ? (cliArgs["--regenerate"] ? true : false)
        : true,
      verbose: cliArgs["--verbose"] ? true : false,
      publID: cliArgs["--publ"]!.toString(), // default is set by docopt
      hugoBuildResultsFileName: cliArgs["--hugo-build-results"]!.toString(), // default is set by docopt
    };
  } catch (e) {
    console.error(e.message);
    Deno.exit();
  }
}

export function isOrchestrationCliRequest(): boolean {
  const firstArg = Deno.args[0];
  if (
    firstArg == OrchestrationNature.experiment ||
    firstArg == OrchestrationNature.publish
  ) {
    return true;
  }
  return false;
}

export async function orchestrationCLI(
  wrapCLI: ha.ControllerCommandLineInterface,
): Promise<void> {
  const pubCtlCLI: (argV: string[]) => Promise<void> = async (
    argV: string[],
  ) => {
    const caller = {
      calledFromMain: import.meta.main,
      calledFromMetaURL: import.meta.url,
      version: orchestrationVersion,
      docOptInitArgV: argV,
    };
    if (cliArgs.verbose) {
      console.log(
        colors.green(orchestrationCmd),
        colors.green(caller.docOptInitArgV!.join(" ")),
      );
    }
    await wrapCLI(caller);
  };

  const port = Deno.env.get("PUBCTL_PORT") ?? 3100;
  const host = Deno.env.get("PUBCTL_HOST");
  const txID = uuid.v4.generate();

  const cliArgs = prepareOrchestrationArgs();
  const verboseArg = cliArgs.verbose ? ["--verbose"] : [];
  const txArg = ["--tx-id", txID];
  const scheduleTxArgs = ["--schedule", `@${cliArgs.orchestration}`, ...txArg];
  const publArgs = ["--publ", cliArgs.publID];

  if (cliArgs.regenerate) {
    // deno run -A --unstable pubctl.ts hugo clean --tx-id="$PUBCTL_TXID"
    await pubCtlCLI(["hugo", "clean", ...txArg]);

    // deno run -A --unstable pubctl.ts generate --schedule="@publish" --tx-id="$PUBCTL_TXID" --verboseArg
    await pubCtlCLI(["generate", ...scheduleTxArgs, ...verboseArg]);

    // deno run -A --unstable pubctl.ts hugo init --publ=sandbox --tx-id="$PUBCTL_TXID" --verboseArg
    // deno-fmt-ignore
    await pubCtlCLI(["hugo", "init", ...publArgs, ...txArg, ...verboseArg]);
  }

  // deno run -A --unstable pubctl.ts build prepare --publ=sandbox --schedule="@publish" --tx-id="$PUBCTL_TXID" --verboseArg
  // deno-fmt-ignore
  await pubCtlCLI(["build", "prepare", ...publArgs, ...scheduleTxArgs, ...verboseArg]);

  if (cliArgs.server == OrchestrationServerNature.hugo) {
    console.log(
      `${colors.green("Ready")}: ${
        colors.yellow(
          `hugo server --config hugo-config.auto.toml --renderToDisk public --port ${port} --templateMetrics --templateMetricsHints`,
        )
      }`,
    );
    Deno.exit();
  }

  const hugo = Deno.run({
    // deno-fmt-ignore
    cmd: ["hugo", "--config", "hugo-config.auto.toml", "--templateMetrics", "--templateMetricsHints" ],
    stdout: "piped",
  });
  await hugo.status();
  const hugoBuildResultsFileOrig =
    `static/.observability/${cliArgs.hugoBuildResultsFileName}`;
  Deno.writeFileSync(hugoBuildResultsFileOrig, await hugo.output());

  // deno run -A --unstable pubctl.ts build finalize --publ=sandbox --schedule="@publish" --tx-id="$PUBCTL_TXID" --observability-hugo-results-file="$hugoBuildResultsFileOrig" --verboseArg
  // deno-fmt-ignore
  await pubCtlCLI([ "build", "finalize", ...publArgs, ...scheduleTxArgs, ...verboseArg, "--observability-hugo-results-file", hugoBuildResultsFileOrig ]);

  const hugoBuildResultsFileDest =
    `public/.observability/${cliArgs.hugoBuildResultsFileName}`;
  Deno.copyFileSync(hugoBuildResultsFileOrig, hugoBuildResultsFileDest);
  if (cliArgs.verbose) {
    console.log(`Hugo build results in ${hugoBuildResultsFileDest}`);
  }

  if (cliArgs.orchestration == OrchestrationNature.experiment) {
    console.log(
      `${colors.green("Ready")}: ${
        colors.yellow(
          // deno-fmt-ignore
          `simple-http-server --index public/ --port ${port} ${host ? `--ip ${host}` : ""}`,
        )
      }`,
    );
  }
}
