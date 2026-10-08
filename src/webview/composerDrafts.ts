/** Renderer-local drafts are independent in each webview, including contexts for inactive conversations. */
import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "./bridge-client";
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
export function rememberDraftSelection(key: string, selection: TextSelection): void { const previous = selections.get(key); selections.set(key, selection); if (previous?.start !== selection.start || previous?.end !== selection.end) persist(key); }
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
  if (!recovery.get(key)?.ready) { const queued = mutations.get(key) ?? []; queued.push(update); mutations.set(key, queued); }
  drafts.set(key, update(readDraft(key))); notify(key); persist(key);
}
export function addDraftContext(key: string, context: ComposerContext): void {
  updateDraft(key, (draft) => ({ ...draft, contexts: [...draft.contexts, context] }));
}
export function clearDraft(key: string): void { selections.delete(key); editorFocus.delete(key); updateDraft(key, () => EMPTY); }
interface DraftRecovery { readonly ready: boolean; readonly recovered: boolean; readonly error?: string }
const RESTORING: DraftRecovery = { ready: false, recovered: false };
const recovery = new Map<string, DraftRecovery>();
const restores = new Map<string, Promise<void>>();
const mutations = new Map<string, Array<(draft: ComposerDraft) => ComposerDraft>>();
const notify = (key: string) => listeners.get(key)?.forEach(listener => listener());
function subscribe(key: string, listener: () => void) {
  let subscribers = listeners.get(key); if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers); }
  subscribers.add(listener); return () => { subscribers!.delete(listener); if (!subscribers!.size) listeners.delete(key); };
}
const failedSaves = new Set<string>();
const saveVersions = new Map<string, number>();
let saveRetry: ReturnType<typeof setTimeout> | undefined;
function retryFailedSaves(): void {
  if (saveRetry || !failedSaves.size) return;
  saveRetry = setTimeout(() => { saveRetry = undefined; for (const key of failedSaves) persist(key); }, 1500);
}
function persist(key: string): void {
  if (!recovery.get(key)?.ready) return;
  // Post immediately: closing a tab must not discard a renderer-side debounce timer.
  const draft = readDraft(key);
  const saved = { ...draft, attachments: (draft.attachments ?? []).map(file => { if (!file.attachment) return file; const { previewUrl: _preview, ...metadata } = file; return metadata; }) };
  const version = (saveVersions.get(key) ?? 0) + 1; saveVersions.set(key, version);
  void bridge.request("saveComposerDraft", { draftKey: key, draft: saved, selection: selections.get(key) }).then(() => {
    if (saveVersions.get(key) !== version) return;
    failedSaves.delete(key);
    const status = recovery.get(key);
    if (status?.error?.startsWith("Draft could not be saved:")) { recovery.set(key, { ready: status.ready, recovered: status.recovered }); notify(key); }
  }).catch(cause => {
    if (saveVersions.get(key) !== version) return;
    failedSaves.add(key); retryFailedSaves();
    recovery.set(key, { ...recovery.get(key)!, error: `Draft could not be saved: ${String(cause)}` }); notify(key);
  });
}
function restore(key: string): Promise<void> {
  if (restores.has(key)) return restores.get(key)!;
  const work = bridge.request<{ draft: ComposerDraft; selection?: TextSelection }>("restoreComposerDraft", { draftKey: key }).then(saved => {
    if (recovery.get(key)?.ready) {
      // Only merge uploads completed by the host while this tab was closed; never replace ongoing typing.
      const current = readDraft(key);
      drafts.set(key, { ...current, attachments: (current.attachments ?? []).map(file => file.pending ? saved.draft.attachments?.find(next => next.key === file.key) ?? file : file) });
    } else {
      const pending = mutations.get(key) ?? []; mutations.delete(key);
      drafts.set(key, pending.reduce((draft, update) => update(draft), saved.draft));
      if (!selections.has(key) && saved.selection) selections.set(key, saved.selection);
      recovery.set(key, { ready: true, recovered: !!(saved.draft.text || saved.draft.attachments?.length) });
      if (pending.length) persist(key);
    }
    notify(key);
  }).catch(cause => { recovery.set(key, { ready: false, recovered: false, error: `Draft recovery unavailable: ${String(cause)}` }); notify(key); }).finally(() => restores.delete(key));
  restores.set(key, work); return work;
}
export function useDraftRecovery(key: string): DraftRecovery {
  const status = useSyncExternalStore(listener => subscribe(key, listener), () => recovery.get(key) ?? RESTORING);
  useEffect(() => { if (status.ready) return; void restore(key); const timer = setInterval(() => { void restore(key); }, 1500); return () => clearInterval(timer); }, [key, status.ready]);
  const pending = readDraft(key).attachments?.some(file => file.pending);
  useEffect(() => { if (!status.ready || !pending) return; const timer = setInterval(() => { void restore(key); }, 750); return () => clearInterval(timer); }, [key, status.ready, pending]);
  return status;
}
export function useComposerDraft(key: string): ComposerDraft {
  return useSyncExternalStore(listener => subscribe(key, listener), () => readDraft(key));
}
