import type { ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import type { FavoriteModel } from "./bridge.js";

export interface ProviderModelPreference {
  readonly hiddenModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
}
export type ProviderModelPreferences = Readonly<Record<string, ProviderModelPreference>>;
export function getProviderModelPreference(preferences: ProviderModelPreferences | undefined, instanceId: string): ProviderModelPreference | undefined {
  return preferences && Object.hasOwn(preferences, instanceId) ? preferences[instanceId] : undefined;
}
export interface ModelPickerPreferences {
  readonly favoriteModels: ReadonlyArray<FavoriteModel>;
  readonly providerModelPreferences: ProviderModelPreferences;
}
export function orderedProviderModels(provider: Pick<ServerProvider, "models">, preferences?: ProviderModelPreference): ServerProviderModel[] {
  const ranks = new Map<string, number>();
  for (const slug of preferences?.modelOrder ?? []) if (!ranks.has(slug)) ranks.set(slug, ranks.size);
  // A model a server reports twice is listed once (T3 0.1.11).
  const unique = provider.models.filter((model, index) => provider.models.findIndex((other) => other.slug === model.slug) === index);
  return unique.sort((left, right) => (ranks.get(left.slug) ?? Infinity) - (ranks.get(right.slug) ?? Infinity));
}

export function visibleProviderModels(provider: Pick<ServerProvider, "models">, preferences?: ProviderModelPreference, showLegacy = false): ServerProviderModel[] {
  return orderedProviderModels(provider, preferences).filter((model) => preferences
    ? !preferences.hiddenModels.includes(model.slug)
    : showLegacy || !model.isLegacy);
}

export function defaultProviderModelPreference(provider: Pick<ServerProvider, "models">): ProviderModelPreference {
  return { hiddenModels: provider.models.filter((model) => model.isLegacy).map((model) => model.slug), modelOrder: [] };
}
