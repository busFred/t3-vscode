import { useSyncExternalStore } from "react";
import { sessionSort, type SessionSort } from "../shared/sessionSort";
import { bridge } from "./bridge-client";

let value = sessionSort(bridge.readViewState<{ sessionSort?: unknown }>()?.sessionSort);
const listeners = new Set<() => void>();
export function useSessionSort() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => value);
  const update = (next: SessionSort) => {
    value = next;
    bridge.saveViewState({ ...bridge.readViewState<Record<string, unknown>>(), sessionSort: value });
    listeners.forEach(listener => listener());
  };
  return [current, update] as const;
}
