import { useSyncExternalStore } from "react";
import { bridge } from "./bridge-client";

interface ComposerPreferences { readonly listAssist: boolean }
const saved = bridge.readViewState<{ composer?: Partial<ComposerPreferences> }>()?.composer;
let preferences: ComposerPreferences = { listAssist: saved?.listAssist !== false };
const listeners = new Set<() => void>();
/** Preferences belong to the editor view, and survive switching its conversations. */
export function useComposerPreferences() {
  const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => preferences);
  const update = (patch: Partial<ComposerPreferences>) => {
    preferences = { ...preferences, ...patch };
    bridge.saveViewState({ ...bridge.readViewState<Record<string, unknown>>(), composer: preferences });
    listeners.forEach(listener => listener());
  };
  return [value, update] as const;
}
