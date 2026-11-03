import type { ServerProviderModel, SelectProviderOptionDescriptor, ProviderOptionSelection } from "@t3tools/contracts";
import { getProviderOptionCurrentValue, getProviderOptionDescriptors } from "@t3tools/shared/model";
import type { ModelSelection } from "./bridge.js";

const effortIds = ["reasoningEffort", "effort", "reasoning", "variant"];
export function effortDescriptor(model: ServerProviderModel | undefined, selection: ModelSelection | null | undefined): SelectProviderOptionDescriptor | undefined {
  const descriptors = getProviderOptionDescriptors({ caps: model?.capabilities ?? {}, selections: selection?.options });
  const reasoning = descriptors.find((descriptor) => descriptor.type === "select" && descriptor.role === "reasoning");
  if (reasoning?.type === "select") return reasoning.options.length ? reasoning : undefined;
  for (const id of effortIds) {
    const option = descriptors.find((descriptor) => descriptor.id === id && descriptor.type === "select");
    if (option?.type === "select" && option.options.length) return option;
  }
  return undefined;
}

/** Option label, marked when the server advertises it as the model's default. */
export function effortOptionLabel(option: { label: string; isDefault?: boolean | undefined }): string {
  return option.isDefault ? `${option.label} (Default)` : option.label;
}

/** Carry explicit options only when the new model advertises the same values. */
export function selectionForModel(instanceId: string, model: ServerProviderModel, previous: ModelSelection | null | undefined): ModelSelection {
  const descriptors = model.capabilities?.optionDescriptors ?? [];
  const options = previous?.instanceId === instanceId ? previous.options?.filter((option) => {
    const descriptor = descriptors.find((item) => item.id === option.id);
    return descriptor?.type === "boolean" ? typeof option.value === "boolean"
      : descriptor?.type === "select" && descriptor.options.some((choice) => choice.id === option.value);
  }) : undefined;
  return { instanceId, model: model.slug, ...(options?.length ? { options } : {}) };
}

export type SpeedKind = "standard" | "fast" | "ultrafast" | "other";
export interface SpeedChoice {
  readonly id: string; readonly label: string; readonly description?: string | undefined; readonly isDefault?: boolean | undefined;
  /** What to store in the model selection: the tier id for a select, true/false for a boolean. */
  readonly value: string | boolean; readonly kind: SpeedKind;
}
export interface SpeedControl {
  /** `serviceTier` (select) or `fastMode` (boolean), as advertised by the server. */
  readonly optionId: string; readonly label: string;
  readonly choices: ReadonlyArray<SpeedChoice>;
  readonly current: SpeedChoice | undefined;
  /** True when the selection names the option; otherwise `current` is the server's default. */
  readonly explicit: boolean;
}

function speedKind(id: string): SpeedKind {
  return id === "default" ? "standard" : id === "fast" || id === "priority" ? "fast" : id === "ultrafast" ? "ultrafast" : "other";
}
/** Anything above Standard costs more per request, including tier ids this extension does not know. */
export function isPremiumSpeed(choice: SpeedChoice | undefined): boolean { return choice !== undefined && choice.kind !== "standard"; }

/** The model's speed option, matched by descriptor id and type so any provider that advertises one gets the control. */
export function speedControl(model: ServerProviderModel | undefined, selection: ModelSelection | null | undefined): SpeedControl | undefined {
  const descriptors = getProviderOptionDescriptors({ caps: model?.capabilities ?? {}, selections: selection?.options });
  const tier = descriptors.find((descriptor) => descriptor.id === "serviceTier" && descriptor.type === "select");
  const fast = descriptors.find((descriptor) => descriptor.id === "fastMode" && descriptor.type === "boolean");
  const descriptor = tier?.type === "select" && tier.options.length ? tier : fast;
  if (!descriptor) return undefined;
  const stored = selection?.options?.find((option) => option.id === descriptor.id);
  const explicit = stored !== undefined;
  if (descriptor.type === "boolean") {
    const choices: SpeedChoice[] = [{ id: "off", label: "Normal", value: false, kind: "standard" }, { id: "on", label: "Fast", value: true, kind: "fast" }];
    return { optionId: descriptor.id, label: descriptor.label, choices, explicit, current: explicit && typeof stored.value !== "boolean" ? undefined : choices[descriptor.currentValue === true ? 1 : 0] };
  }
  const choices = descriptor.options.map((option): SpeedChoice => ({ id: option.id, label: option.label, description: option.description, isDefault: option.isDefault, value: option.id, kind: speedKind(option.id) }));
  // A stored tier the server no longer offers stays unresolved; falling back to the default would hide what a run really uses.
  const value = explicit ? stored.value : getProviderOptionCurrentValue(descriptor);
  return { optionId: descriptor.id, label: descriptor.label, choices, explicit, current: choices.find((choice) => choice.id === value) };
}
export function speedChoiceLabel(choice: SpeedChoice): string { return choice.isDefault ? `${choice.label} (Default)` : choice.label; }

/** The option that pins a model to its standard tier, or undefined when it advertises none (such a model behaves like "inherit"). */
export function standardSpeedOption(model: ServerProviderModel | undefined): ProviderOptionSelection | undefined {
  const control = speedControl(model, null);
  const standard = control?.choices.find((choice) => choice.kind === "standard");
  return control && standard ? { id: control.optionId, value: standard.value } : undefined;
}
/** Pin a selection to Standard unless it already names a speed. */
export function withStandardSpeed(model: ServerProviderModel | undefined, selection: ModelSelection): ModelSelection {
  const standard = standardSpeedOption(model);
  if (!standard || selection.options?.some((option) => option.id === standard.id)) return selection;
  return { ...selection, options: [...(selection.options ?? []), standard] };
}

/** Set the speed on a selection, or clear it (undefined choice) so the server default applies; no empty options array is left behind. */
export function selectionWithSpeed(selection: ModelSelection, control: SpeedControl, choiceId: string | undefined): ModelSelection {
  const { options: previous, ...base } = selection;
  const choice = control.choices.find((item) => item.id === choiceId);
  const options = [...(previous ?? []).filter((option) => option.id !== control.optionId), ...(choice ? [{ id: control.optionId, value: choice.value }] : [])];
  return { ...base, ...(options.length ? { options } : {}) };
}
