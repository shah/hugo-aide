// source: https://github.com/skulptur/markdown-fns

import { encodingTOML as toml, encodingYAML as yaml } from "./deps.ts";

export const wrap = (wrapper: string, str: string) =>
  `${wrapper}${str}${wrapper}`;
export const spaces = (...text: string[]) => text.join(" ");
export const times = <T>(callback: (index: number) => T, length: number) =>
  [...new Array(length)].map((_, index) => callback(index));
export const joinWith = (separator: string, stringArray: Array<string>) =>
  stringArray.join(separator);
export const lines = (stringArray: Array<string>) => stringArray.join("\n");
export const postfix = (str1: string, str2: string) => `${str2}${str1}`;
export const prefix = (str1: string, str2: string) => `${str1}${str2}`;
export const always = <T>(value: T) => () => value;
export const join = (stringArray: Array<string>) => stringArray.join("");

export const frontMatterJSON = (fm: Record<string, unknown>) =>
  JSON.stringify(fm, undefined, "  ");

export const frontMatterTOML = (fm: Record<string, unknown>) =>
  wrap("+++\n", toml.stringify(fm));

export const frontMatterYAML = (fm: Record<string, unknown>) =>
  wrap("---\n", yaml.stringify(fm));

export const hugoShortCode = (
  sc: string | [string, string | string[] | Record<string, unknown>],
  body?: string,
  wrapBody = "",
) => {
  const tag = (typeof sc === "string" ? sc : sc[0]);
  const params =
    (typeof sc === "string"
      ? ""
      : (" " + (typeof sc[1] === "string"
        ? sc[1]
        : (Array.isArray(sc[1])
          ? sc[1].join(" ")
          : Object.entries(sc[1]).map((e) =>
            `${e[0]}=${JSON.stringify(e[1])}`
          )))));
  return body
    ? `{{<${tag}${params}>}}${wrapBody}${body}${wrapBody}{{</${tag}>}}`
    : `{{<${tag}${params}>}}`;
};

export const hugoShortCodeFn = (sc: string, wrapBody = "") => {
  return (
    paramsOrBody: string | string[] | Record<string, unknown>,
    body?: string,
  ) => {
    if (body) {
      // we have both params and body
      return hugoShortCode([sc, paramsOrBody], body, wrapBody);
    }

    // we have no params, the body is passed into first parameter
    return hugoShortCode(sc, paramsOrBody.toString(), wrapBody);
  };
};

export const htmlTag = (
  ht: string | [string, string | string[] | Record<string, unknown>],
  body?: string,
  wrapBody = "",
) => {
  const tag = (typeof ht === "string" ? ht : ht[0]);
  const params =
    (typeof ht === "string"
      ? ""
      : (" " + (typeof ht[1] === "string"
        ? ht[1]
        : (Array.isArray(ht[1])
          ? ht[1].join(" ")
          : Object.entries(ht[1]).map((e) =>
            `${e[0]}=${JSON.stringify(e[1])}`
          )))));
  return body
    ? `<${tag}${params}>${wrapBody}${body}${wrapBody}</${tag}>`
    : `<${tag}${params}/>`;
};

export const htmlTagFn = (ht: string, wrapBody = "") => {
  return (
    paramsOrBody: string | string[] | Record<string, unknown>,
    body?: string,
  ) => {
    if (body) {
      // we have both params and body
      return htmlTag([ht, paramsOrBody], body, wrapBody);
    }

    // we have no params, the body is passed into first parameter
    return htmlTag(ht, paramsOrBody.toString(), wrapBody);
  };
};

export const italic = (str: string) => wrap("***", str);

export const code = (language: string, str: string) =>
  `\`\`\`${language}\n${str}\n\`\`\``;

export const inlineCode = (str: string) => wrap("`", str);
// reference
// | parameter | type   | description |
// | --------- | ------ | ----------- |
// | `x`       | number |             |
// | `y`       | number |             |
// | `alpha`   | number |             |

const columnSeparator = "|";
const headerSeparator = "-";

export const table = (rows: Array<Array<string>>) => {
  //   TODO: format output
  //   const columnLengths = rows.reduce((lengths, column) => {
  //     return lengths.map(co)
  //   }, )

  const [header, ...content] = rows;
  const rowsWithHeader: Array<Array<string>> = [
    header,
    header.map((heading) =>
      heading
        .split("")
        .map(() => headerSeparator)
        .join("")
    ),
    ...content,
  ];

  return lineBreak().concat(
    rowsWithHeader
      .map((columns) => {
        return ["", ...columns, ""].join(columnSeparator);
      })
      .join("\n"),
  );
};

export const strike = (str: string) => wrap("~~", str);

export const unordered = (stringArray: Array<string>) =>
  prefix(lineBreak(), lines(stringArray.map((str) => prefix("* ", str))));
export const lineBreak = () => "  \n";

export const bold = (str: string) => wrap("**", str);

// TODO: clamp 1 - 6
export const heading = (level: number, str: string) =>
  spaces(join(times(always("#"), level)), str);
export const image = (alt: string) => (url: string) => `![${alt}](${url})`;

export const quote = (str: string) => prefix("> ", str);
export const link = (label: string, url: string) => `[${label}](${url})`;

export const ordered = (stringArray: Array<string>) =>
  lineBreak().concat(
    lines(stringArray.map((str, index) => prefix(`${index + 1}. `, str))),
  );
