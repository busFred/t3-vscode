import test from "node:test";
import assert from "node:assert/strict";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import { effortDescriptor, selectionForModel } from "./modelOptions.js";
import { scoreModelPickerSearch } from "../webview/components/t3/modelPickerSearch.js";

const model = { slug: "test", name: "Test", isCustom: false, capabilities: { optionDescriptors: [
  { id: "effort", label: "Effort", type: "select" as const, options: [{ id: "high", label: "High" }, { id: "max", label: "Max", isDefault: true }] },
  { id: "fastMode", label: "Fast", type: "boolean" as const },
] } };
test("Effort follows advertised defaults and explicit selections without inventing unsupported levels", () => {
  assert.equal(getProviderOptionCurrentValue(effortDescriptor(model, null)), "max");
  assert.equal(getProviderOptionCurrentValue(effortDescriptor(model, { instanceId: "provider", model: "test", options: [{ id: "effort", value: "high" }] })), "high");
  assert.equal(effortDescriptor({ ...model, capabilities: null }, null), undefined);
});
test("Changing models preserves compatible explicit options and drops incompatible or cross-provider options", () => {
  const previous = { instanceId: "provider", model: "old", options: [{ id: "effort", value: "high" }, { id: "fastMode", value: true }, { id: "other", value: "discard" }] };
  assert.deepEqual(selectionForModel("provider", model, previous).options, previous.options.slice(0, 2));
  assert.equal(selectionForModel("other-provider", model, previous).options, undefined);
  assert.deepEqual(selectionForModel("provider", model, { ...previous, options: [{ id: "effort", value: "ultra" }, { id: "fastMode", value: "yes" }] }), { instanceId: "provider", model: "test" });
});
test("T3 model search ranks provider-instance matches, fuzzy names and favorites", () => {
  const entry = { name: "GPT-6 Astra", driverKind: "codex", providerDisplayName: "Codex Personal" };
  assert.notEqual(scoreModelPickerSearch(entry, "personal astra"), null);
  assert.notEqual(scoreModelPickerSearch(entry, "astra"), null);
  assert.notEqual(scoreModelPickerSearch(entry, "asra"), null);
  assert.equal(scoreModelPickerSearch(entry, "unrelated"), null);
  assert.ok(scoreModelPickerSearch({ ...entry, isFavorite: true }, "astra")! < scoreModelPickerSearch(entry, "astra")!);
});
