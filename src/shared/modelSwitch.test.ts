import assert from "node:assert/strict";
import test from "node:test";
import { describeModelSwitch, type ModelSwitchSelection } from "./modelSwitch.js";

const selection = (model: string, effort?: string, instanceId = "codex"): ModelSwitchSelection =>
  ({ instanceId, model, ...(effort ? { options: [{ id: "reasoningEffort", value: effort }] } : {}) });

const names: Record<string, string> = { "gpt-6-luna": "GPT-6 Luna", "gpt-6-astra": "GPT-6 Astra" };
const name = (slug: string) => names[slug];

test("A model change reads as the two catalog names without an effort suffix", () => {
  const summary = describeModelSwitch(selection("gpt-6-luna"), selection("gpt-6-astra"), name);
  assert.deepEqual(summary, { from: "GPT-6 Luna", to: "GPT-6 Astra", changed: "model" });
});

test("An effort change on one model names the dial on both sides", () => {
  const summary = describeModelSwitch(selection("gpt-6-luna", "low"), selection("gpt-6-luna", "high"), name);
  assert.deepEqual(summary, { from: "GPT-6 Luna (low)", to: "GPT-6 Luna (high)", changed: "effort" });
});

test("Gaining an effort reads against the default rather than showing a blank side", () => {
  const summary = describeModelSwitch(selection("gpt-6-luna"), selection("gpt-6-luna", "high"), name);
  assert.deepEqual(summary, { from: "GPT-6 Luna (default)", to: "GPT-6 Luna (high)", changed: "effort" });
});

test("A model and effort change together reports both", () => {
  const summary = describeModelSwitch(selection("gpt-6-luna", "low"), selection("gpt-6-astra", "high"), name);
  assert.deepEqual(summary, { from: "GPT-6 Luna (low)", to: "GPT-6 Astra (high)", changed: "both" });
});

test("An unchanged selection draws no row", () => {
  assert.equal(describeModelSwitch(selection("gpt-6-luna", "low"), selection("gpt-6-luna", "low"), name), null);
});

test("A model the catalog no longer advertises still shows its slug", () => {
  const summary = describeModelSwitch(selection("retired-model"), selection("gpt-6-luna"), name);
  assert.deepEqual(summary, { from: "retired-model", to: "GPT-6 Luna", changed: "model" });
});

test("The same slug on a different provider instance is still a change", () => {
  const summary = describeModelSwitch(selection("shared-slug", undefined, "codex"), selection("shared-slug", undefined, "claudeAgent"), name);
  assert.equal(summary?.changed, "model");
});

test("Effort ids differ by provider, so a Claude effort change is recognised too", () => {
  const claude = (effort: string): ModelSwitchSelection =>
    ({ instanceId: "claudeAgent", model: "claude-opus-5", options: [{ id: "effort", value: effort }] });
  assert.equal(describeModelSwitch(claude("medium"), claude("max"), name)?.changed, "effort");
});

test("A legacy object-form options payload still reports an effort change", () => {
  const legacy = (effort: string): ModelSwitchSelection => ({ provider: "codex", model: "gpt-6-luna", options: { reasoningEffort: effort } });
  assert.deepEqual(describeModelSwitch(legacy("low"), legacy("high"), name), { from: "GPT-6 Luna (low)", to: "GPT-6 Luna (high)", changed: "effort" });
});

test("The legacy provider key is read where instanceId is absent, so it is not a false change", () => {
  assert.equal(describeModelSwitch({ provider: "codex", model: "gpt-6-luna" }, { instanceId: "codex", model: "gpt-6-luna" }, name), null);
});

test("A missing or malformed selection draws no row instead of throwing", () => {
  assert.equal(describeModelSwitch(undefined, selection("gpt-6-luna"), name), null);
  assert.equal(describeModelSwitch({ model: 42 }, { model: 42 }, name), null);
  assert.equal(describeModelSwitch({ model: 42 }, selection("gpt-6-luna"), name)?.to, "GPT-6 Luna");
});
