import { getProviderAttachmentLimitError } from "@t3tools/contracts";
import { attachmentUploadInput, insertAttachmentReferences, type TextSelection, type DraftAttachment, type AttachmentInsertionOptions } from "../shared/composerAttachments";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { bridge } from "./bridge-client";
import { readDraft, updateDraft } from "./composerDrafts";

const pending = new Map<string, Set<Promise<unknown>>>();
export function trackAttachmentWork<T>(draftKey: string, work: Promise<T>): Promise<T> {
  const jobs = pending.get(draftKey) ?? new Set(); jobs.add(work); pending.set(draftKey, jobs);
  void work.finally(() => { jobs.delete(work); if (!jobs.size) pending.delete(draftKey); }).catch(() => undefined);
  return work;
}
export async function settleDraftAttachments(draftKey: string): Promise<void> { await Promise.allSettled([...(pending.get(draftKey) ?? [])]); }
export function addDraftAttachments(draftKey: string, attachments: ReadonlyArray<DraftAttachment>, selection?: TextSelection, options?: AttachmentInsertionOptions): number | undefined {
  const added = attachments.map((file) => ({ ...file, contextId: file.contextId ?? `${file.mimeType.startsWith("image/") ? "image" : "file"}_${crypto.randomUUID()}` }));
  let cursor: number | undefined;
  updateDraft(draftKey, (draft) => {
    const inserted = selection ? insertAttachmentReferences(draft.text, added, selection, options) : undefined;
    cursor = inserted?.cursor;
    return { ...draft, ...(inserted ? { text: inserted.text } : {}), attachments: [...(draft.attachments ?? []), ...added] };
  });
  return cursor;
}
export async function removeDraftAttachment(draftKey: string, key: string): Promise<void> {
  const attachment = readDraft(draftKey).attachments?.find((file) => file.key === key);
  updateDraft(draftKey, (draft) => ({ ...draft, text: attachment?.contextId ? replaceComposerContextReferences(draft.text, (ref) => ref.contextId === attachment.contextId ? "" : ref.source) : draft.text, attachments: (draft.attachments ?? []).filter((file) => file.key !== key) }));
  if (attachment?.attachment) await bridge.request("releaseAttachment", { attachmentId: attachment.attachment.id });
}
const dataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`Could not read '${file.name}'.`)); reader.readAsDataURL(file);
});
export function pasteAttachments(draftKey: string, files: ReadonlyArray<File>, threadId?: string, selection?: TextSelection, onInsert?: (cursor: number) => void, options?: AttachmentInsertionOptions): Promise<void> {
  return trackAttachmentWork(draftKey, (async () => {
    const inputs = files.map((file) => attachmentUploadInput(file.name || "image.png", file.type, file.size));
    const existing = (readDraft(draftKey).attachments ?? []).map((file) => ({ ...file, type: file.attachment?.type ?? (file.mimeType.startsWith("image/") ? "image" : "file") }));
    const error = getProviderAttachmentLimitError([...existing, ...inputs.map((input) => ({ ...input, type: input.type ?? "image" }))]);
    if (error) throw new Error(error);
    const added = inputs.map((input) => ({ key: crypto.randomUUID(), name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, pending: true }));
    // Insert the entire batch before reading/uploading so later typing cannot move image positions.
    const cursor = addDraftAttachments(draftKey, added, selection, options);
    if (cursor !== undefined) onInsert?.(cursor);
    for (const [index, file] of files.entries()) {
      const input = inputs[index]!; const key = added[index]!.key;
      try {
        const encoded = await dataUrl(file);
        updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).map((attachment) => attachment.key === key && input.type === "image" ? { ...attachment, previewUrl: encoded } : attachment) }));
        if (!readDraft(draftKey).attachments?.some((attachment) => attachment.key === key)) continue;
        const ready = await bridge.request<DraftAttachment>("uploadAttachment", { slotKey: key, name: input.name, mimeType: input.mimeType, base64: encoded.slice(encoded.indexOf(",") + 1), ...(threadId ? { threadId } : {}) }, 6 * 60_000);
        if (!readDraft(draftKey).attachments?.some((attachment) => attachment.key === key)) { if (ready.attachment) await bridge.request("releaseAttachment", { attachmentId: ready.attachment.id }); continue; }
        updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).map((attachment) => attachment.key === key ? { ...ready, key, ...(attachment.contextId ? { contextId: attachment.contextId } : {}) } : attachment) }));
      } catch (cause) {
        updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).map((attachment) => attachment.key === key ? { ...attachment, pending: false, error: cause instanceof Error ? cause.message : String(cause) } : attachment) }));
      }
    }
  })());
}
