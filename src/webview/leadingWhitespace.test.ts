import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { remarkEnableLeadingWhitespace, remarkKeepLeadingWhitespace } from "../../vendor/shared/src/markdownLeadingWhitespace.ts";

// unified and remark-parse are dependencies of the vendored T3 package, not of the extension.
const vendorRequire = createRequire(new URL("../../vendor/shared/package.json", import.meta.url));
const load = async (name: string) => import(pathToFileURL(vendorRequire.resolve(name)).href);
const { unified } = await load("unified");
const remarkParse = (await load("remark-parse")).default;
const remarkGfm = (await load("remark-gfm")).default;

/** The text of every span the plugin adds for typed line-start whitespace. */
function kept(text: string, enabled: boolean): string[] {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (enabled) processor.use(remarkEnableLeadingWhitespace);
  processor.use(remarkKeepLeadingWhitespace);
  const out: string[] = [];
  const walk = (node: any) => {
    if (node.data?.hProperties && "dataLeadingWhitespace" in node.data.hProperties) out.push(node.children?.[0]?.value ?? node.value);
    for (const child of node.children ?? []) walk(child);
  };
  walk(processor.runSync(processor.parse(text), text));
  return out;
}

test("sent messages keep spaces typed at the start of a line", () => {
  assert.deepEqual(kept("   Plan\nnext", true), ["   "]);
  assert.deepEqual(kept("Plan\n            Deep\n                        Deeper", true), ["            ", "                        "]);
});

test("replies keep CommonMark's reading and drop line-start spaces", () => {
  assert.deepEqual(kept("   Plan\n   next", false), []);
});
