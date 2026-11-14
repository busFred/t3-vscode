import { useSyncExternalStore } from "react";
import { bridge } from "./bridge-client";

interface ComposerPreferences {
  readonly listAssist: boolean;
  /** Message box height the user dragged to, or null to grow with the text up to the default ceiling. */
  readonly height: number | null;
}
const saved = bridge.readViewState<{ composer?: Partial<ComposerPreferences> }>()?.composer;
let preferences: ComposerPreferences = { listAssist: saved?.listAssist !== false, height: typeof saved?.height === "number" && Number.isFinite(saved.height) ? saved.height : null };
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
