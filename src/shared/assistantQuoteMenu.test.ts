import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
import { assistantQuoteMenuItems, clampMenuPosition, QUOTE_TOO_LONG_LABEL } from "./assistantQuoteMenu.js";

test("The selection menu offers copy and a single Quote action for optional comments", () => {
  const items = assistantQuoteMenuItems(42);
  assert.deepEqual(items.map((item) => item.label), ["Copy as plain text", "Copy as Markdown", "Quote"]);
  assert.deepEqual(items.map((item) => item.action), ["copy", "markdown", "quote"]);
  // The owner asked for the ellipsis to be dropped, and for the separator to sit between copying and quoting.
  assert.ok(items.every((item) => !item.label.includes("…") && !item.label.endsWith("...")));
  assert.deepEqual(items.map((item) => item.separated), [false, false, true]);
  assert.deepEqual(items.map((item) => item.disabled), [false, false, false]);
});

test("A selection past the citation length limit keeps copy and disables quoting", () => {
  const items = assistantQuoteMenuItems(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1);
  assert.deepEqual(items.map((item) => item.disabled), [false, false, true]);
  assert.deepEqual(assistantQuoteMenuItems(ASSISTANT_CITATION_MAX_TEXT_LENGTH).map((item) => item.disabled), [false, false, false]);
  assert.equal(QUOTE_TOO_LONG_LABEL, "Shorten selection");
});

test("Menu placement stays inside the window whichever edge the selected row sits against", () => {
  const size = { width: 200, height: 120 }, viewport = { width: 800, height: 600 };
  assert.deepEqual(clampMenuPosition({ x: 300, y: 200 }, size, viewport), { x: 300, y: 200 });
  assert.deepEqual(clampMenuPosition({ x: 790, y: 595 }, size, viewport), { x: 594, y: 474 });
  assert.deepEqual(clampMenuPosition({ x: -40, y: -10 }, size, viewport), { x: 6, y: 6 });
  // A menu wider than the window still starts at the margin rather than off the left edge.
  assert.deepEqual(clampMenuPosition({ x: 100, y: 100 }, { width: 900, height: 700 }, viewport), { x: 6, y: 6 });
});
