import test from "node:test";
import assert from "node:assert/strict";
import { clampSectionHeight, MIN_SECTION_HEIGHT } from "./sectionHeight";

test("section heights stay within the minimum and the available space", () => {
  assert.equal(clampSectionHeight(undefined, 500), null);
  assert.equal(clampSectionHeight("200", 500), null);
  assert.equal(clampSectionHeight(Number.NaN, 500), null);
  assert.equal(clampSectionHeight(10, 500), MIN_SECTION_HEIGHT);
  assert.equal(clampSectionHeight(240.4, 500), 240);
  assert.equal(clampSectionHeight(900, 500), 500);
  assert.equal(clampSectionHeight(900, 20), MIN_SECTION_HEIGHT);
});
