import * as ctl from "./controller.ts";
import {
  encodingTOML as toml,
  encodingYAML as yaml,
  govnData as gd,
  path,
  safety,
} from "./deps.ts";
import * as publ from "./publication.ts";

export interface HugoPublicationModule<O = void>
  extends publ.PublicationModule {
  readonly mergeHugoModuleImports: (
    options: O,
  ) => HugoConfigModuleImport[];
  readonly mergeHugoParams?: (options: O) => HugoConfigParams;
  readonly mergeHugoTaxonomies?: (options: O) => HugoConfigTaxonomies;
  readonly mergeHugoPermalinks?: (options: O) => HugoConfigPermalinks;
}

export interface HugoPublication<O> extends publ.Publication {
  readonly hugoModuleName: string;
  readonly hugoConfigSupplier: (
    ctx: ctl.PublicationsController,
  ) => HugoConfigurationSupplier<O>;
}

// deno-lint-ignore no-explicit-any
export const isHugoPublication = safety.typeGuard<HugoPublication<any>>(
  "hugoModuleName",
  "hugoConfigSupplier",
);

export interface HugoConfigurationSupplier<O> {
  readonly hugoConfigFileName: string;
  readonly hugoConfig: HugoConfiguration;
  readonly hugoConfigModules: () => HugoPublicationModule<O>[];
}

export function persistConfiguration<O>(
  dir: string,
  hcs: HugoConfigurationSupplier<O>,
  dryRun?: boolean,
): string {
  const fileName = `${dir}/${hcs.hugoConfigFileName || "config.toml"}`;
  const config = (hcs.hugoConfig as unknown) as Record<string, unknown>;
  let configText: string;
  switch (path.extname(fileName)) {
    case ".json":
      configText = JSON.stringify(hcs.hugoConfig);
      break;

    case ".toml":
      configText = toml.stringify(config);
      break;

    case ".yaml":
    case ".yml":
      configText = yaml.stringify(config);
      break;

    default:
      configText =
        "Unable to determined type from extension: ${path.extname(fileName)}";
  }
  if (!dryRun) Deno.writeTextFileSync(fileName, configText);
  return fileName;
}

export interface HugoConfiguration {
  baseURL: string;
  title: string;
  theme: string;
  defaultContentLanguage?: string;
  languageCode?: string;
  markup?: HugoConfigMarkup;
  mediaTypes?: HugoConfigMediaTypes;
  module?: HugoConfigModule;
  outputFormats?: HugoConfigOutputFormats;
  outputs?: HugoConfigOutputs;
  params?: HugoConfigParams;
  permalinks?: HugoConfigPermalinks;
  sitemap?: HugoConfigSitemap;
  taxonomies?: HugoConfigTaxonomies;
}

export interface HugoConfigMarkup {
  asciidocExt?: AsciidocEXT;
  blackFriday?: BlackFriday;
  defaultMarkdownHandler?: "goldmark" | "blackFriday" | "asciidocExt";
  goldmark?: Goldmark;
  highlight?: Highlight;
  tableOfContents?: TableOfContents;
}

export interface AsciidocEXT {
  attributes?: Record<string, unknown>;
  backend?: string;
  failureLevel?: string;
  noHeaderOrFooter?: boolean;
  preserveTOC?: boolean;
  safeMode?: string;
  sectionNumbers?: boolean;
  trace?: boolean;
  verbose?: boolean;
  workingFolderCurrent?: boolean;
}

export interface BlackFriday {
  angledQuotes?: boolean;
  extensions?: null;
  extensionsMask?: null;
  footnoteAnchorPrefix?: string;
  footnoteReturnLinkContents?: string;
  fractions?: boolean;
  hrefTargetBlank?: boolean;
  latexDashes?: boolean;
  nofollowLinks?: boolean;
  noreferrerLinks?: boolean;
  plainIDAnchors?: boolean;
  skipHTML?: boolean;
  smartDashes?: boolean;
  smartypants?: boolean;
  smartypantsQuotesNBSP?: boolean;
  taskLists?: boolean;
}

export interface Goldmark {
  extensions?: GoldmarkExtensions;
  parser?: GoldmarkParser;
  renderer?: GoldmarkRenderer;
}

export interface GoldmarkExtensions {
  definitionList?: boolean;
  footnote?: boolean;
  linkify?: boolean;
  strikethrough?: boolean;
  table?: boolean;
  taskList?: boolean;
  typographer?: boolean;
}

export interface GoldmarkParser {
  attribute?: boolean;
  autoHeadingID?: boolean;
  autoHeadingIDType?: string;
}

export interface GoldmarkRenderer {
  hardWraps?: boolean;
  unsafe?: boolean;
  xhtml?: boolean;
}

export interface Highlight {
  anchorLineNos?: boolean;
  codeFences?: boolean;
  guessSyntax?: boolean;
  hl_Lines?: string;
  lineAnchors?: string;
  lineNoStart?: number;
  lineNos?: boolean;
  lineNumbersInTable?: boolean;
  noClasses?: boolean;
  style?: string;
  tabWidth?: number;
}

export interface TableOfContents {
  endLevel?: number;
  ordered?: boolean;
  startLevel?: number;
}

export interface HugoConfigMediaTypes {
  [mt: string]: HugoConfigMediaTypeSuffixes;
}

export interface HugoConfigMediaTypeSuffixes {
  suffixes?: string[];
}

export interface HugoConfigModule {
  noProxy?: string;
  noVendor?: string;
  private?: string;
  proxy?: string;
  replacements?: string;
  hugoVersion?: HugoModuleHugoVersion;
  imports?: HugoConfigModuleImport[];
}

export interface HugoModuleHugoVersion {
  extended?: boolean;
  max?: string;
  min?: string;
}

export interface HugoConfigModuleImport {
  disable?: boolean;
  ignoreConfig?: boolean;
  path?: string;
  mounts?: HugoConfigModuleImportMount[];
}

export interface HugoConfigModuleImportMount {
  source?: string;
  target?: string;
}

export type HugoConfigOutputFormats =
  & HugoConfigDefaultOutputFormats
  & Record<string, HugoConfigOutputFormat>;

export interface HugoConfigDefaultOutputFormats {
  HTML?: HugoConfigOutputFormat;
  Calendar?: HugoConfigOutputFormat;
  AMP?: HugoConfigOutputFormat;
  CSS?: HugoConfigOutputFormat;
  CSV?: HugoConfigOutputFormat;
  JSON?: HugoConfigOutputFormat;
  RSS?: HugoConfigOutputFormat;
  ROBOTS?: HugoConfigOutputFormat;
  Sitemap?: HugoConfigOutputFormat;
}

export type HugoConfigOutputFormatName = string;

export interface HugoConfigOutputFormat {
  name?: HugoConfigOutputFormatName;
  baseName?: string;
  rel?: string;
  isPlainText?: boolean;
  isHTML?: boolean;
  noUgly?: boolean;
  notAlternative?: boolean;
  permalinkable?: boolean;
  mediaType?: string;
  protocol?: string;
}

export type HugoConfigOutputFormatNames = HugoConfigOutputFormatName[];

export type HugoConfigOutputs =
  & HugoConfigDefaultOutputs
  & Record<string, HugoConfigOutputFormatNames>;

export interface HugoConfigDefaultOutputs {
  home?: HugoConfigOutputFormatNames;
  page?: HugoConfigOutputFormatNames;
  section?: HugoConfigOutputFormatNames;
  taxonomy?: HugoConfigOutputFormatNames;
  term?: HugoConfigOutputFormatNames;
}

export type HugoConfigPermalinkSpec = string;
export type HugoConfigPermalinks = Record<string, HugoConfigPermalinkSpec>;

export type HugoConfigParamsKey = string;
export type HugoConfigParams = Record<HugoConfigParamsKey, unknown>;

export interface HugoConfigSitemap {
  changeFreq?: string;
  filename?: string;
  priority?: number;
}

export type HugoTaxonomyName = string;
export type HugoTaxonomyTermsKey = string;
export type HugoConfigTaxonomies = Record<HugoTaxonomyName, HugoTaxonomyName>;

// What all our Hugo configurations should have, by default (Omit<> removes the
// required properties so that they must be supplied when instantiated).
export const typicalHugoConfig: Omit<
  HugoConfiguration,
  "baseURL" | "theme" | "title"
> = {
  markup: {
    defaultMarkdownHandler: "goldmark",
    goldmark: { renderer: { unsafe: true } },
  },
  outputs: {
    home: ["HTML", "RSS", "JSON"],
    page: ["HTML", "Calendar", "JSON"],
    section: ["HTML", "JSON"],
  },
  permalinks: {
    categories: "/topic/:slug/",
  },
  sitemap: { changeFreq: "daily", filename: "sitemap.xml", priority: 1 },
  taxonomies: {
    tag: "tags",
  },
};

export interface HugoPublicationModulesMergedConfig {
  readonly imports: HugoConfigModuleImport[];
  readonly params?: HugoConfigParams;
  readonly taxonomies?: HugoConfigTaxonomies;
  readonly permalinks?: HugoConfigPermalinks;
}

export function mergeHugoPublicationModulesConfig<O>(
  modules: HugoPublicationModule<O>[],
  options: O,
): HugoPublicationModulesMergedConfig {
  const imports: HugoConfigModuleImport[] = [];
  let params: HugoConfigParams = {};
  let taxonomies: HugoConfigTaxonomies = {};
  let permalinks: HugoConfigPermalinks = {};
  for (const mm of modules) {
    imports.push(...mm.mergeHugoModuleImports(options));
    if (mm.mergeHugoParams) {
      params = gd.mergeDeep(
        params,
        mm.mergeHugoParams(options),
      ) as HugoConfigParams;
    }
    if (mm.mergeHugoTaxonomies) {
      taxonomies = gd.mergeDeep(
        taxonomies,
        mm.mergeHugoTaxonomies(options),
      ) as HugoConfigTaxonomies;
    }
    if (mm.mergeHugoPermalinks) {
      permalinks = gd.mergeDeep(
        permalinks,
        mm.mergeHugoPermalinks(options),
      ) as HugoConfigPermalinks;
    }
  }
  return {
    imports,
    params: Object.keys(params).length > 0 ? params : undefined,
    taxonomies: Object.keys(taxonomies).length > 0 ? taxonomies : undefined,
    permalinks: Object.keys(permalinks).length > 0 ? permalinks : undefined,
  };
}
