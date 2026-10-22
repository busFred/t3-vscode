import test from "node:test";
import assert from "node:assert/strict";
import { collapseBlankLines, escapeMarkdownText } from "./selectionMarkdown.js";

test("escapeMarkdownText leaves ordinary punctuation alone mid-sentence", () => {
  assert.equal(escapeMarkdownText("branch is deleted. You're back on main.", false), "branch is deleted. You're back on main.");
  assert.equal(escapeMarkdownText("a-b and 1-2 and C++ and e.g. 1.5", false), "a-b and 1-2 and C++ and e.g. 1.5");
});

test("escapeMarkdownText always escapes characters that change inline meaning", () => {
  assert.equal(escapeMarkdownText("a*b_c`d~e[f]g<h>i", false), "a\\*b\\_c\\`d\\~e\\[f\\]g\\<h\\>i");
  assert.equal(escapeMarkdownText("back\\slash", false), "back\\\\slash");
});

test("escapeMarkdownText escapes a leading marker only at a line start", () => {
  assert.equal(escapeMarkdownText("- not a bullet", true), "\\- not a bullet");
  assert.equal(escapeMarkdownText("- not a bullet", false), "- not a bullet");
  assert.equal(escapeMarkdownText("# not a heading", true), "\\# not a heading");
  assert.equal(escapeMarkdownText("1. not a list", true), "1\\. not a list");
  assert.equal(escapeMarkdownText("+ not a bullet", true), "\\+ not a bullet");
  // A period after a number mid-sentence is never a list marker.
  assert.equal(escapeMarkdownText("see section 1. for details", true), "see section 1. for details");
});

test("escapeMarkdownText re-evaluates line start after an embedded newline", () => {
  assert.equal(escapeMarkdownText("intro\n- looks like a bullet", false), "intro\n\\- looks like a bullet");
});

test("escapeMarkdownText only escapes | when told it is inside a table cell", () => {
  assert.equal(escapeMarkdownText("a|b", false), "a|b");
  assert.equal(escapeMarkdownText("a|b", false, true), "a\\|b");
});

test("collapseBlankLines flattens runs of 3+ newlines to a single blank line", () => {
  assert.equal(collapseBlankLines("a\n\n\nb"), "a\n\nb");
  assert.equal(collapseBlankLines("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(collapseBlankLines("a\n\nb"), "a\n\nb");
  assert.equal(collapseBlankLines("a\nb"), "a\nb");
});

test("collapseBlankLines keeps sibling blocks on separate lines while flattening runs", () => {
  assert.equal(collapseBlankLines("src/foo.ts\n\nsrc/bar.ts\n\n"), "src/foo.ts\n\nsrc/bar.ts\n\n");
  assert.equal(collapseBlankLines("a\n\n\n\n\nb"), "a\n\nb");
});
