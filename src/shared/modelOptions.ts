import type { ServerProviderModel, SelectProviderOptionDescriptor } from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import type { ModelSelection } from "./bridge.js";

const effortIds = ["reasoningEffort", "effort", "reasoning", "variant"];
export function effortDescriptor(model: ServerProviderModel | undefined, selection: ModelSelection | null | undefined): SelectProviderOptionDescriptor | undefined {
  const descriptors = getProviderOptionDescriptors({ caps: model?.capabilities ?? {}, selections: selection?.options });
  for (const id of effortIds) {
    const option = descriptors.find((descriptor) => descriptor.id === id && descriptor.type === "select");
    if (option?.type === "select" && option.options.length) return option;
  }
  return undefined;
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
