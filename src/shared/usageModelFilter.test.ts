import assert from "node:assert/strict";
import test from "node:test";
import { filterByUsageModel, usageModelNames, type MeterRow } from "./usage.js";

const row = (label: string, primary: boolean, reported = true): MeterRow =>
  ({ label, short: label[0] ?? "?", primary, window: reported ? ({ id: label.toLowerCase(), label, kind: "weekly" } as MeterRow["window"]) : null });

const rows: ReadonlyArray<MeterRow> = [row("Session", true), row("Week", true), row("Opus", false), row("Fable", false), row("Month", true)];

test("Only model-specific quotas are offered as filters", () => {
  assert.deepEqual(usageModelNames(rows), ["Opus", "Fable"]);
});

test("An account reporting no model quota offers no model filter", () => {
  assert.deepEqual(usageModelNames([row("Session", true), row("Week", true)]), []);
});

test("A placeholder row for an unreported window is not a model", () => {
  assert.deepEqual(usageModelNames([row("Opus", false, false)]), []);
});

test("No selected model keeps every row, general allowances included", () => {
  assert.equal(filterByUsageModel(rows, null).length, rows.length);
});

test("A selected model keeps only that model's quota", () => {
  assert.deepEqual(filterByUsageModel(rows, "Opus").map((entry) => entry.label), ["Opus"]);
});

test("A model that is no longer reported filters to nothing rather than falling back to everything", () => {
  assert.deepEqual(filterByUsageModel(rows, "Retired"), []);
});
