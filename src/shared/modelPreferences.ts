import { ClientSettingsPatch, type ServerProvider, type ServerProviderModel } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { FavoriteModel } from "./bridge.js";

export interface ProviderModelPreference {
  readonly hiddenModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
}
export type ProviderModelPreferences = Readonly<Record<string, ProviderModelPreference>>;
export interface ModelPickerPreferences {
  readonly favoriteModels: ReadonlyArray<FavoriteModel>;
  readonly providerModelPreferences: ProviderModelPreferences;
}
export interface ModelPreferencesImport {
  readonly favoriteModels?: ReadonlyArray<FavoriteModel>;
  readonly providerModelPreferences?: ProviderModelPreferences;
}
const importSchema = Schema.Struct({
  favorites: ClientSettingsPatch.fields.favorites,
  providerModelPreferences: ClientSettingsPatch.fields.providerModelPreferences,
});

/** Import only model display settings, even when given a full browser settings export. */
export function parseModelPreferencesImport(json: string): ModelPreferencesImport {
  try {
    if (json.length > 200_000) throw new Error("Too large");
    const parsed = Schema.decodeUnknownSync(importSchema)(JSON.parse(json));
    if (parsed.favorites === undefined && parsed.providerModelPreferences === undefined) throw new Error("Missing preferences");
    return {
      ...(parsed.favorites !== undefined ? { favoriteModels: parsed.favorites.map((favorite) => ({ instanceId: favorite.provider, model: favorite.model })) } : {}),
      ...(parsed.providerModelPreferences !== undefined ? { providerModelPreferences: parsed.providerModelPreferences } : {}),
    };
  } catch {
    throw new Error("Paste valid T3 Web JSON containing favorites or providerModelPreferences.");
  }
}

export function orderedProviderModels(provider: Pick<ServerProvider, "models">, preferences?: ProviderModelPreference): ServerProviderModel[] {
  const ranks = new Map<string, number>();
  for (const slug of preferences?.modelOrder ?? []) if (!ranks.has(slug)) ranks.set(slug, ranks.size);
  return [...provider.models].sort((left, right) => (ranks.get(left.slug) ?? Infinity) - (ranks.get(right.slug) ?? Infinity));
}

export function visibleProviderModels(provider: Pick<ServerProvider, "models">, preferences?: ProviderModelPreference, showLegacy = false): ServerProviderModel[] {
  return orderedProviderModels(provider, preferences).filter((model) => preferences
    ? !preferences.hiddenModels.includes(model.slug)
    : showLegacy || !model.isLegacy);
}

export function defaultProviderModelPreference(provider: Pick<ServerProvider, "models">): ProviderModelPreference {
  return { hiddenModels: provider.models.filter((model) => model.isLegacy).map((model) => model.slug), modelOrder: [] };
}
