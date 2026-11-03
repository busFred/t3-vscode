import test from "node:test";
import assert from "node:assert/strict";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import { effortDescriptor, effortOptionLabel, isPremiumSpeed, selectionForModel, selectionWithSpeed, speedChoiceLabel, speedControl, standardSpeedOption, withStandardSpeed } from "./modelOptions.js";
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
test("Effort labels mark only the advertised default", () => {
  const labels = effortDescriptor(model, null)?.options.map(effortOptionLabel);
  assert.deepEqual(labels, ["High", "Max (Default)"]);
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

const tierModel = { slug: "astra", name: "Astra", isCustom: false, capabilities: { optionDescriptors: [
  { id: "serviceTier", label: "Service Tier", type: "select" as const, currentValue: "default", options: [
    { id: "default", label: "Standard", isDefault: true }, { id: "fast", label: "Fast" }, { id: "ultrafast", label: "Ultrafast", description: "Even faster, more expensive" }, { id: "turbo", label: "Turbo" }] },
] } };
test("Speed reads a Codex service tier, classifies tiers by id and treats unknown tiers as premium", () => {
  const idle = speedControl(tierModel, null)!;
  assert.equal(idle.optionId, "serviceTier"); assert.equal(idle.explicit, false);
  assert.equal(idle.current?.kind, "standard"); assert.equal(isPremiumSpeed(idle.current), false);
  assert.deepEqual(idle.choices.map((choice) => choice.kind), ["standard", "fast", "ultrafast", "other"]);
  const picked = speedControl(tierModel, { instanceId: "p", model: "astra", options: [{ id: "serviceTier", value: "ultrafast" }] })!;
  assert.equal(picked.explicit, true); assert.equal(picked.current?.id, "ultrafast"); assert.equal(isPremiumSpeed(picked.current), true);
  assert.equal(isPremiumSpeed(speedControl(tierModel, { instanceId: "p", model: "astra", options: [{ id: "serviceTier", value: "turbo" }] })?.current), true);
});
test("Speed shows the server's configured default tier before anything is picked", () => {
  const configured = { ...tierModel, capabilities: { optionDescriptors: [{ ...tierModel.capabilities.optionDescriptors[0]!, currentValue: "fast", options: tierModel.capabilities.optionDescriptors[0]!.options.map(({ isDefault: _, ...option }) => option.id === "fast" ? { ...option, isDefault: true } : option) }] } };
  const control = speedControl(configured, null)!;
  assert.equal(control.explicit, false); assert.equal(control.current?.id, "fast"); assert.equal(isPremiumSpeed(control.current), true);
  assert.equal(speedChoiceLabel(control.choices.find((choice) => choice.id === "fast")!), "Fast (Default)");
});
test("Speed normalizes a boolean fast mode and ignores models with no speed option", () => {
  const off = speedControl(model, null)!;
  assert.equal(off.optionId, "fastMode"); assert.equal(off.current?.label, "Normal"); assert.equal(isPremiumSpeed(off.current), false);
  const on = speedControl(model, { instanceId: "p", model: "test", options: [{ id: "fastMode", value: true }] })!;
  assert.equal(on.current?.label, "Fast"); assert.equal(on.current?.value, true); assert.equal(on.explicit, true);
  assert.equal(speedControl({ slug: "x", name: "X", isCustom: false, capabilities: { optionDescriptors: [model.capabilities.optionDescriptors[0]!] } }, null), undefined);
  assert.equal(speedControl(undefined, null), undefined);
});
test("Pinning Standard adds the model's own standard option once and never overrides a pick", () => {
  assert.deepEqual(standardSpeedOption(tierModel), { id: "serviceTier", value: "default" });
  assert.deepEqual(standardSpeedOption(model), { id: "fastMode", value: false });
  assert.equal(standardSpeedOption({ slug: "x", name: "X", isCustom: false, capabilities: null }), undefined);
  const base = { instanceId: "p", model: "astra", options: [{ id: "reasoningEffort", value: "low" }] };
  assert.deepEqual(withStandardSpeed(tierModel, base).options, [{ id: "reasoningEffort", value: "low" }, { id: "serviceTier", value: "default" }]);
  const fast = { ...base, options: [{ id: "serviceTier", value: "fast" }] };
  assert.equal(withStandardSpeed(tierModel, fast), fast);
  assert.equal(withStandardSpeed(undefined, base), base);
});
test("A stored tier the server no longer offers stays unresolved instead of showing the default", () => {
  const stale = speedControl(tierModel, { instanceId: "p", model: "astra", options: [{ id: "serviceTier", value: "warp" }] })!;
  assert.equal(stale.explicit, true); assert.equal(stale.current, undefined);
  const badBool = speedControl(model, { instanceId: "p", model: "test", options: [{ id: "fastMode", value: "yes" }] })!;
  assert.equal(badBool.current, undefined);
  assert.equal(standardSpeedOption({ slug: "x", name: "X", isCustom: false, capabilities: { optionDescriptors: [{ id: "serviceTier", label: "Tier", type: "select", options: [{ id: "fast", label: "Fast" }] }] } }), undefined);
});
test("Choosing Server default removes a lone speed option instead of leaving it behind", () => {
  const control = speedControl(tierModel, null)!;
  const pinned = { instanceId: "p", model: "astra", options: [{ id: "serviceTier", value: "default" }] };
  assert.deepEqual(selectionWithSpeed(pinned, control, undefined), { instanceId: "p", model: "astra" });
  assert.deepEqual(selectionWithSpeed({ ...pinned, options: [{ id: "reasoningEffort", value: "low" }, ...pinned.options] }, control, undefined).options, [{ id: "reasoningEffort", value: "low" }]);
  assert.deepEqual(selectionWithSpeed({ instanceId: "p", model: "astra" }, control, "fast").options, [{ id: "serviceTier", value: "fast" }]);
  assert.deepEqual(selectionWithSpeed(pinned, control, "ultrafast").options, [{ id: "serviceTier", value: "ultrafast" }]);
  assert.deepEqual(selectionWithSpeed({ instanceId: "p", model: "test" }, speedControl(model, null)!, "off").options, [{ id: "fastMode", value: false }]);
});
