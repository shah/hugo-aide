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
