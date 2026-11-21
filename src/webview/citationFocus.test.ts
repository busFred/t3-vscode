import test from "node:test";
import assert from "node:assert/strict";
import { shouldFocusCitedSource } from "./citationFocus.ts";

const element = (tag: string, isContentEditable = false) => ({ isContentEditable, matches: (selector: string) => selector.split(",").map((part) => part.trim()).includes(tag) }) as unknown as Element;

test("a citation jump focuses the cited response unless someone is typing", () => {
  assert.equal(shouldFocusCitedSource(null), true);
  assert.equal(shouldFocusCitedSource(element("body")), true);
  assert.equal(shouldFocusCitedSource(element("button")), true);
  assert.equal(shouldFocusCitedSource(element("textarea")), false);
  assert.equal(shouldFocusCitedSource(element("input")), false);
  assert.equal(shouldFocusCitedSource(element("div", true)), false);
});
