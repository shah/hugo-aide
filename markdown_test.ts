import { testingAsserts as ta } from "./deps-test.ts";
import {
  bold,
  frontMatterYAML,
  heading,
  htmlTag,
  htmlTagFn,
  hugoShortCodeFn,
  inlineCode,
  italic,
  lines,
  link,
  ordered,
  spaces,
  strike,
  times,
  unordered,
} from "./markdown.ts";

const generatedMD = `---
title: Generated Markdown
---

# This is a heading.
## This is a heading.
### This is a heading.
#### This is a heading.
##### This is a heading.
###### This is a heading.
This is regular text.
***Italic text.***
**Bold text.**
~~Strike through text.~~
More regular text.
Text and \`inline code\` :-)
and then some more text.
  
1. Apples
2. Oranges
3. Bananas
  
* Apples
* Oranges
* Bananas
[example](https://github.com/skulptur/markdown-fns/tree/master/example)
<b>HTML without params</b>
<tag param>HTML tag with simple param</tag>
<span style="abc:xyz">span HTML with key/value param</span>
{{<todo assign="shah">}}an assignment{{</todo>}}`;

Deno.test(`Test simple Markdown content generator`, () => {
  const exampleUrl =
    "https://github.com/skulptur/markdown-fns/tree/master/example";
  const fruits = ["Apples", "Oranges", "Bananas"];

  const span = htmlTagFn("span");
  const customTag = htmlTagFn("tag");
  const todo = hugoShortCodeFn("todo");

  const markdown = lines([
    frontMatterYAML({ title: "Generated Markdown" }),
    lines(times((index) => heading(index + 1, "This is a heading."), 6)),
    "This is regular text.",
    italic("Italic text."),
    bold("Bold text."),
    strike("Strike through text."),
    lines([
      "More regular text.",
      spaces("Text and", inlineCode("inline code"), ":-)"),
      "and then some more text.",
    ]),
    ordered(fruits),
    unordered(fruits),
    link("example", exampleUrl),
    htmlTag("b", "HTML without params"),
    customTag("param", "HTML tag with simple param"),
    span({ style: "abc:xyz" }, "span HTML with key/value param"),
    todo({ assign: "shah" }, "an assignment"),
  ]);

  ta.assertEquals(markdown, generatedMD);
});
