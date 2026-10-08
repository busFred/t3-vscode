/** Renderer-local drafts are independent in each webview, including contexts for inactive conversations. */
import { useSyncExternalStore } from "react";
import type { ComposerContext } from "../shared/composerContext";
import type { ViewDraft } from "../shared/viewDraft";
import { insertFileReference, type FileReference } from "../shared/composerContext";
import type { TextSelection } from "../shared/composerAttachments";

export interface ComposerDraft extends ViewDraft { readonly text: string; readonly contexts: ReadonlyArray<ComposerContext> }
const EMPTY: ComposerDraft = { text: "", contexts: [] };
const drafts = new Map<string, ComposerDraft>();
const selections = new Map<string, TextSelection>();
const editorFocus = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
export const readDraft = (key: string): ComposerDraft => drafts.get(key) ?? EMPTY;
export const readDraftSelection = (key: string): TextSelection | undefined => selections.get(key);
export function rememberDraftSelection(key: string, selection: TextSelection): void { selections.set(key, selection); }
export function takeEditorReferenceFocus(key: string): number | undefined { const cursor = editorFocus.get(key); editorFocus.delete(key); return cursor; }
export function addEditorReference(key: string, reference: FileReference): number {
  let cursor = 0;
  updateDraft(key, draft => {
    const inserted = insertFileReference(draft.text, draft.contexts, reference, selections.get(key) ?? { start: draft.text.length, end: draft.text.length });
    cursor = inserted.cursor; rememberDraftSelection(key, { start: cursor, end: cursor });
    editorFocus.set(key, cursor);
    return { ...draft, text: inserted.text, contexts: inserted.contexts };
  });
  return cursor;
}
export function updateDraft(key: string, update: (draft: ComposerDraft) => ComposerDraft): void {
  drafts.set(key, update(readDraft(key))); listeners.get(key)?.forEach((listener) => listener());
}
export function addDraftContext(key: string, context: ComposerContext): void {
  updateDraft(key, (draft) => ({ ...draft, contexts: [...draft.contexts, context] }));
}
export function clearDraft(key: string): void { selections.delete(key); editorFocus.delete(key); updateDraft(key, () => EMPTY); }
export function useComposerDraft(key: string): ComposerDraft {
  return useSyncExternalStore((listener) => {
    let subscribers = listeners.get(key);
    if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers); }
    subscribers.add(listener);
    return () => { subscribers!.delete(listener); if (!subscribers!.size) listeners.delete(key); };
  }, () => readDraft(key));
}
