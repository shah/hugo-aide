import { colors, docopt, fs, path, uuid } from "./deps.ts";
import * as ctl from "./controller.ts";
import "https://deno.land/x/dotenv@v2.0.0/load.ts"; // automatically load .env into environment

const orchestrationVersion = "0.9.0";
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
  initConfig: boolean;
  generateContent: boolean;
  verbose: boolean;
  publID: string;
  hugoBuildResultsFileName: string;
}

function prepareOrchestrationArgs(
  caller: ctl.CommandHandlerCaller,
): OrchestrationCliArguments {
  try {
    const cmd = path.basename(caller.calledFromMetaURL);
    const cliArgs = docopt.default(`
Publication Controller Orchestrator ${orchestrationVersion}.

Usage:
  ${cmd} experiment (hugo|file) [--publ=<publ-id>] [--init-config] [--generate-content] [--verbose] [--hugo-build-results=<file>]
  ${cmd} publish [--publ=<publ-id>] [--verbose] [--hugo-build-results=<file>]
  ${cmd} -h | --help

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
      initConfig: orchestration == OrchestrationNature.experiment
        ? (cliArgs["--init-config"] ? true : false)
        : true, // always re-init if publishing
      generateContent: orchestration == OrchestrationNature.experiment
        ? (cliArgs["--generate-content"] ? true : false)
        : true, // always re-init if publishing
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
  wrapCLI: ctl.ControllerCommandLineInterface,
  constructCaller: (
    inherit: ctl.CommandHandlerCaller,
  ) => ctl.CommandHandlerCaller,
): Promise<void> {
  const pubCtlCLI: (argV: string[]) => Promise<void> = async (
    argV: string[],
  ) => {
    const caller = constructCaller({
      calledFromMain: import.meta.main,
      calledFromMetaURL: import.meta.url,
      version: orchestrationVersion,
      docOptInitArgV: argV,
    });
    if (cliArgs.verbose) {
      const cmd = path.basename(caller.calledFromMetaURL);
      console.log(
        colors.green(cmd),
        colors.green(caller.docOptInitArgV!.join(" ")),
      );
    }
    await wrapCLI(caller);
  };

  const port = Deno.env.get("PUBCTL_PORT") ?? 3100;
  const host = Deno.env.get("PUBCTL_HOST");
  const txID = uuid.v4.generate();

  const cliArgs = prepareOrchestrationArgs(constructCaller({
    calledFromMain: import.meta.main,
    calledFromMetaURL: import.meta.url,
    version: orchestrationVersion,
  }));
  const verboseArg = cliArgs.verbose ? ["--verbose"] : [];
  const txArg = ["--tx-id", txID];
  const scheduleTxArgs = ["--schedule", `@${cliArgs.orchestration}`, ...txArg];
  const publArgs = ["--publ", cliArgs.publID];

  if (cliArgs.initConfig) {
    // deno run -A --unstable pubctl.ts hugo clean --tx-id="$PUBCTL_TXID"
    await pubCtlCLI(["hugo", "clean", ...txArg]);

    // deno run -A --unstable pubctl.ts hugo init --publ=sandbox --tx-id="$PUBCTL_TXID" --verboseArg
    // deno-fmt-ignore
    await pubCtlCLI(["hugo", "init", ...publArgs, ...txArg, ...verboseArg]);

    const hugoModVendor = Deno.run({
      cmd: ["hugo", "mod", "vendor", "--config", "hugo-config.auto.toml"],
    });
    await hugoModVendor.status();
    hugoModVendor.close();
    const vendoredModules = path.join("_vendor", "modules.txt");
    if (fs.existsSync(vendoredModules)) {
      const count =
        Deno.readTextFileSync(vendoredModules).split("\n").filter((s) =>
          s.trim().length > 0
        ).length;
      console.log(
        colors.cyan(
          `Vendored Hugo modules: ${colors.yellow(count.toString())}`,
        ),
      );
    } else {
      console.log(colors.red("No Hugo modules vendored"));
      Deno.removeSync("_vendor");
    }
  }

  if (cliArgs.generateContent) {
    // deno run -A --unstable pubctl.ts generate --schedule="@publish" --tx-id="$PUBCTL_TXID" --verboseArg
    await pubCtlCLI(["generate", ...scheduleTxArgs, ...verboseArg]);
  }

  // deno run -A --unstable pubctl.ts build prepare --publ=sandbox --schedule="@publish" --tx-id="$PUBCTL_TXID" --verboseArg
  // deno-fmt-ignore
  await pubCtlCLI(["build", "prepare", ...publArgs, ...scheduleTxArgs, ...verboseArg]);

  if (cliArgs.server == OrchestrationServerNature.hugo) {
    console.log(
      `${colors.green("Ready")}: ${
        colors.yellow(
          `hugo server --config hugo-config.auto.toml --renderToDisk public --port ${port}`,
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
  hugo.close();

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
