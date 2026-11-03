import { useSyncExternalStore } from "react";
import { bridge } from "./bridge-client";

const KEY = "usageCollapsed";
const read = (): ReadonlySet<string> => { const value = bridge.readViewState<Record<string, unknown>>()?.[KEY]; return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []); };
let value = read();
const listeners = new Set<() => void>();
/** Folded per-account usage windows (Session, Week, …) per provider; kept with the sidebar's view state. */
export function useCollapsedUsageSections() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => value);
  const setCollapsed = (label: string, collapsed: boolean) => {
    if (value.has(label) === collapsed) return;
    const next = new Set(value); if (collapsed) next.add(label); else next.delete(label); value = next;
    bridge.saveViewState({ ...bridge.readViewState<Record<string, unknown>>(), [KEY]: [...value] });
    listeners.forEach(listener => listener());
  };
  return [current, setCollapsed] as const;
}
