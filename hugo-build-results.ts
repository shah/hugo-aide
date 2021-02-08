import { fs, govnSvcMetrics as gsm } from "./deps.ts";

export interface HugoBuildParsedTemplateMetrics {
  readonly cachePotential: number;
  readonly cumulativeDuration: number;
  readonly averageDuration: number;
  readonly maximumDuration: number;
  readonly cumulativeDurationText: string;
  readonly averageDurationText: string;
  readonly maximumDurationText: string;
  readonly count: number;
  readonly templateName: string;
}

export interface HugoBuildParsedTemplateMetricsCsvColumns {
  readonly names: string[];
  readonly values: string[];
}

export interface HugoBuildResults {
  readonly resultFileName: string;
  readonly resultFileInfo: Deno.FileInfo;
  readonly buildTimeMS: number;
  readonly buildMetrics: HugoBuildMetrics;
  readonly parsedTemplateMetrics: HugoBuildParsedTemplateMetrics[];
  readonly parsedTemplateMetricsCSV: (
    ptmCSV: HugoBuildParsedTemplateMetricsCsvColumns,
  ) => string[];
}

export interface HugoBuildResultMetricLabels {
  readonly src: string;
  readonly srcMTime: Date;
  readonly publ: string;
  readonly host: string;
  readonly txId: string;
}

export interface HugoBuildResultTemplateMetricLabels
  extends HugoBuildResultMetricLabels {
  readonly template: string;
}

export interface HugoBuildResultTemplateDurationMetricLabels
  extends HugoBuildResultTemplateMetricLabels {
  readonly durationText: string;
}

export class HugoBuildMetrics extends gsm.TypicalMetrics {
  readonly hugoBuildTotalTime = this.gaugeMetric<
    HugoBuildResultMetricLabels
  >(
    "hugo_build_total_time_ms",
    "Total amount of time the Hugo build took to generate HTML pages",
  );
  readonly hugoTemplateMetricCount = this.gaugeMetric<
    HugoBuildResultTemplateMetricLabels
  >("hugo_template_count", "Total number of times Hugo template was used");
  readonly hugoTemplateMetricCachePotential = this.gaugeMetric<
    HugoBuildResultTemplateMetricLabels
  >(
    "hugo_template_cache_potential",
    "How useful caching this Hugo template might be",
  );
  readonly hugoTemplateMetricCumulativeDuration = this.gaugeMetric<
    HugoBuildResultTemplateDurationMetricLabels
  >(
    "hugo_template_cumulative_duration_seconds",
    "Total CPU seconds the template consumed",
  );
  readonly hugoTemplateMetricAverageDuration = this.gaugeMetric<
    HugoBuildResultTemplateDurationMetricLabels
  >(
    "hugo_template_average_duration_seconds",
    "Average CPU seconds the template consumed",
  );
  readonly hugoTemplateMetricMaximumDuration = this.gaugeMetric<
    HugoBuildResultTemplateDurationMetricLabels
  >(
    "hugo_template_maximum_duration_seconds",
    "Maximim CPU seconds the template consumed in a single consumption",
  );
}

export function durationInSeconds(duration: string): number {
  let result = 0.0;
  const days = duration.match(/(\d+)*d/);
  const hours = duration.match(/(\d+)\s*h/);
  const minutes = duration.match(/([\d\.]+)\s*m[^s]/);
  const seconds = duration.match(/([\d\.]+)\s*s/);
  const millis = duration.match(/([\d\.]+)\s*ms/);
  const micros = duration.match(/([\d\.]+)\s*µs/);
  if (days) result += parseInt(days[1]) * 86400;
  if (hours) result += parseInt(hours[1]) * 3600;
  if (minutes) result += parseFloat(minutes[1]) * 60;
  if (seconds) result += parseFloat(seconds[1]);
  if (millis) result += parseFloat(millis[1]) / 1000;
  if (micros) result += parseFloat(micros[1]) / 1000000;
  return result;
}

export function isValidHugoBuildResults(
  o: HugoBuildResults | string,
): o is HugoBuildResults {
  if (typeof o === "string") return false;
  return true;
}

export function parseHugoBuildResults(
  resultFileName: string,
): HugoBuildResults | string {
  if (!fs.existsSync(resultFileName)) {
    return `Unable to parse Hugo Build Results: file not found`;
  }
  const buildResultsContent = Deno.readTextFileSync(resultFileName);
  const buildTimeRegEx = /^Total in (\d+) ms/m;
  const buildTimeMatch = buildResultsContent.match(buildTimeRegEx);
  if (buildTimeMatch) {
    const buildResultsLines = buildResultsContent.split("\n");
    const resultFileInfo = Deno.statSync(resultFileName);
    const buildTimeMS = Number.parseInt(buildTimeMatch[1]);
    const parsedTemplateMetrics: HugoBuildParsedTemplateMetrics[] = [];
    const templateMetricsRegEx =
      /^\s*(\d+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+(\d+)\s+(.*?)$/;
    for (const line of buildResultsLines) {
      const metrics = line.match(templateMetricsRegEx);
      if (metrics) {
        const ptm: HugoBuildParsedTemplateMetrics = {
          cachePotential: Number.parseInt(metrics[1]),
          cumulativeDuration: durationInSeconds(metrics[2]),
          averageDuration: durationInSeconds(metrics[3]),
          maximumDuration: durationInSeconds(metrics[4]),
          cumulativeDurationText: metrics[2],
          averageDurationText: metrics[3],
          maximumDurationText: metrics[4],
          count: Number.parseInt(metrics[5]),
          templateName: metrics[6],
        };
        parsedTemplateMetrics.push(ptm);
      }
    }
    return {
      resultFileName,
      resultFileInfo,
      buildTimeMS,
      parsedTemplateMetrics,
      parsedTemplateMetricsCSV: (
        ptmCSV: HugoBuildParsedTemplateMetricsCsvColumns,
      ) => {
        const parsedTemplateMetricsCSV: string[] = [
          [
            ...ptmCSV.names,
            "Template Name",
            "Cache Potential",
            "Count",
            "Cumulative Duration Seconds",
            "Average Duration Seconds",
            "Maximum Duration Seconds",
          ].join(","),
        ];
        for (const ptm of parsedTemplateMetrics) {
          parsedTemplateMetricsCSV.push(
            [
              ...ptmCSV.values,
              ptm.templateName,
              ptm.cachePotential,
              ptm.count,
              ptm.cumulativeDuration,
              ptm.averageDuration,
              ptm.maximumDuration,
            ].join(","),
          );
        }
        return parsedTemplateMetricsCSV;
      },
      buildMetrics: new HugoBuildMetrics(),
    };
  }
  return `Unable to parse Hugo Build Results: build time match for ${buildTimeRegEx} not found`;
}
