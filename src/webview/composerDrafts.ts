/** Renderer-local drafts are independent in each webview, including contexts for inactive conversations. */
import { useSyncExternalStore } from "react";
import type { ComposerContext } from "../shared/composerContext";

export interface ComposerDraft { readonly text: string; readonly contexts: ReadonlyArray<ComposerContext> }
const EMPTY: ComposerDraft = { text: "", contexts: [] };
const drafts = new Map<string, ComposerDraft>();
const listeners = new Map<string, Set<() => void>>();
export const readDraft = (key: string): ComposerDraft => drafts.get(key) ?? EMPTY;
export function updateDraft(key: string, update: (draft: ComposerDraft) => ComposerDraft): void {
  drafts.set(key, update(readDraft(key))); listeners.get(key)?.forEach((listener) => listener());
}
export function addDraftContext(key: string, context: ComposerContext): void {
  updateDraft(key, (draft) => ({ ...draft, contexts: [...draft.contexts, context] }));
}
export function clearDraft(key: string): void { updateDraft(key, () => EMPTY); }
export function useComposerDraft(key: string): ComposerDraft {
  return useSyncExternalStore((listener) => {
    let subscribers = listeners.get(key);
    if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers); }
    subscribers.add(listener);
    return () => { subscribers!.delete(listener); if (!subscribers!.size) listeners.delete(key); };
  }, () => readDraft(key));
}
