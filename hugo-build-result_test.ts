import { testingAsserts as ta } from "./deps-test.ts";
import * as hbr from "./hugo-build-results.ts";

Deno.test(`Hugo build results parser error: file not found`, () => {
  const buildResults = hbr.parseHugoBuildResults(
    "hugo-build-bad-filename.golden",
    "nets_pubctl_",
  );
  ta.assert(!hbr.isValidHugoBuildResults(buildResults));
  ta.assertEquals(
    buildResults,
    "Unable to parse Hugo Build Results: file not found",
  );
});

Deno.test(`Hugo build results parser`, () => {
  const buildResults = hbr.parseHugoBuildResults(
    "hugo-build-results_test.golden",
    "nets_pubctl_",
  );
  ta.assert(hbr.isValidHugoBuildResults(buildResults));
  ta.assertEquals(buildResults.parsedTemplateMetrics.length, 202);
});

Deno.test(`Hugo duration parser`, () => {
  ta.assertEquals(
    hbr.durationInSeconds("33m31.5456494s"),
    (33 * 60) + 31.5456494,
  );
  ta.assertEquals(hbr.durationInSeconds("3.0587915s"), 3.0587915);
  ta.assertEquals(hbr.durationInSeconds("901.634087ms"), 901.634087 / 1000);
  ta.assertEquals(hbr.durationInSeconds("151.1µs"), 151.1 / 1000000);
});
