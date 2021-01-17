import { testingAsserts as ta } from "./deps-test.ts";
import * as mod from "./mod.ts";

Deno.test(`module sources compile`, () => {
  // not a real unit test, but just check for compile
  ta.assert(mod);
});
