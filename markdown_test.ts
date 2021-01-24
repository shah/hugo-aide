import { testingAsserts as ta } from "./deps-test.ts";
import * as md from "./markdown.ts";

const generated = `{{<todo assign="shah">}}an assignment{{</todo>}}`;

Deno.test(`simple Hugo specific content generator`, () => {
  const todo = md.hugoShortCodeFn("todo");
  const markdown = todo({ assign: "shah" }, "an assignment");
  ta.assertEquals(markdown, generated);
});
