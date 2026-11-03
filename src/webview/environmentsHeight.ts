import { useSyncExternalStore } from "react";
import { bridge } from "./bridge-client";
import { clampSectionHeight } from "./sectionHeight";

const KEY = "environmentsHeight";
let value = clampSectionHeight(bridge.readViewState<Record<string, unknown>>()?.[KEY], Number.MAX_SAFE_INTEGER);
const listeners = new Set<() => void>();
/** The Machines list height survives hiding and reloading the sidebar, like the session sort. */
export function useEnvironmentsHeight() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => value);
  const update = (next: number | null) => {
    value = next;
    bridge.saveViewState({ ...bridge.readViewState<Record<string, unknown>>(), [KEY]: value });
    listeners.forEach(listener => listener());
  };
  return [current, update] as const;
}
