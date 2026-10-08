import test from "node:test";
import assert from "node:assert/strict";
import { sessionActivityLabel } from "./sessionActivity.js";

test("Session labels cover minute/hour/day boundaries, invalid and future dates", () => {
  const now = new Date(2026, 9, 8, 12).getTime();
  for (const [age, label] of [[0, "<1 min"], [59_999, "<1 min"], [60_000, "1 min"], [900_000, "15 min"],
    [1_800_000, "30 min"], [3_600_000, "1 hr"], [28_800_000, "8 hr"], [86_400_000, "1 day"], [604_800_000, "7 days"], [-60_000, "<1 min"]] as const) {
    assert.equal(sessionActivityLabel(new Date(now - age).toISOString(), now), label);
  }
  assert.equal(sessionActivityLabel("invalid", now), "");
  assert.equal(sessionActivityLabel(null, now), "");
  assert.equal(sessionActivityLabel(new Date(now - 604_800_001).toISOString(), now), new Date(now - 604_800_001).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  const lastYear = new Date(2025, 11, 31);
  assert.equal(sessionActivityLabel(lastYear.toISOString(), now), lastYear.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
});
