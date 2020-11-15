import {
  encodingTOML as toml,
  encodingYAML as yaml,
  path,
  safety,
} from "./deps.ts";

export type HugoConfigurationIdentity = string;

export interface HugoConfigurationSupplier {
  readonly hugoConfigFileName?: string;
  readonly hugoConfig: HugoConfiguration;
}

export function persistConfiguration(
  dir: string,
  hcs: HugoConfigurationSupplier,
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
      configText = toml.stringify(config);
      break;

    default:
      configText =
        "Unable to determined type from extension: ${path.extname(fileName)}";
  }
  Deno.writeTextFileSync(fileName, configText);
  return fileName;
}

export interface HugoConfigurator {
  readonly name: string;
  readonly onImport?: (moduleUrl: string) => void;
  readonly identities: () => HugoConfigurationIdentity[];
  readonly configure: (
    name: HugoConfigurationIdentity,
  ) => HugoConfigurationSupplier | undefined;
}

export const isHugoConfiguratorStructure = safety.typeGuard<HugoConfigurator>(
  "name",
  "identities",
  "configure",
);

export function isHugoConfigurator(o: unknown): o is HugoConfigurator {
  if (isHugoConfiguratorStructure(o)) {
    // TODO: add check to ensure proper function definition
    return true;
  }
  return false;
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
  params?: Record<string, unknown>;
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
