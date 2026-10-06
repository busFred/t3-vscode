import { getProviderAttachmentLimitError } from "@t3tools/contracts";
import { attachmentUploadInput, type DraftAttachment } from "../shared/composerAttachments";
import { bridge } from "./bridge-client";
import { readDraft, updateDraft } from "./composerDrafts";

const pending = new Map<string, Set<Promise<unknown>>>();
export function trackAttachmentWork<T>(draftKey: string, work: Promise<T>): Promise<T> {
  const jobs = pending.get(draftKey) ?? new Set(); jobs.add(work); pending.set(draftKey, jobs);
  void work.finally(() => { jobs.delete(work); if (!jobs.size) pending.delete(draftKey); }).catch(() => undefined);
  return work;
}
export async function settleDraftAttachments(draftKey: string): Promise<void> { await Promise.allSettled([...(pending.get(draftKey) ?? [])]); }
export function addDraftAttachments(draftKey: string, attachments: ReadonlyArray<DraftAttachment>): void {
  updateDraft(draftKey, (draft) => ({ ...draft, attachments: [...(draft.attachments ?? []), ...attachments] }));
}
export async function removeDraftAttachment(draftKey: string, key: string): Promise<void> {
  const attachment = readDraft(draftKey).attachments?.find((file) => file.key === key);
  updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).filter((file) => file.key !== key) }));
  if (attachment?.attachment) await bridge.request("releaseAttachment", { attachmentId: attachment.attachment.id });
}
const dataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`Could not read '${file.name}'.`)); reader.readAsDataURL(file);
});
export function pasteAttachments(draftKey: string, files: ReadonlyArray<File>, threadId?: string): Promise<void> {
  return trackAttachmentWork(draftKey, (async () => {
    for (const file of files) {
      const input = attachmentUploadInput(file.name || "image.png", file.type, file.size);
      const error = getProviderAttachmentLimitError([...(readDraft(draftKey).attachments ?? []).map((attachment) => ({ ...attachment, type: attachment.attachment?.type ?? (attachment.mimeType.startsWith("image/") ? "image" : "file") })), { ...input, type: input.type ?? "image" }]);
      if (error) throw new Error(error);
      const key = crypto.randomUUID();
      addDraftAttachments(draftKey, [{ key, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, pending: true }]);
      try {
        const encoded = await dataUrl(file);
        updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).map((attachment) => attachment.key === key && input.type === "image" ? { ...attachment, previewUrl: encoded } : attachment) }));
        if (!readDraft(draftKey).attachments?.some((attachment) => attachment.key === key)) continue;
        const ready = await bridge.request<DraftAttachment>("uploadAttachment", { name: input.name, mimeType: input.mimeType, base64: encoded.slice(encoded.indexOf(",") + 1), ...(threadId ? { threadId } : {}) }, 6 * 60_000);
        if (!readDraft(draftKey).attachments?.some((attachment) => attachment.key === key)) { if (ready.attachment) await bridge.request("releaseAttachment", { attachmentId: ready.attachment.id }); continue; }
        updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).map((attachment) => attachment.key === key ? { ...ready, key } : attachment) }));
      } catch (cause) {
        updateDraft(draftKey, (draft) => ({ ...draft, attachments: (draft.attachments ?? []).map((attachment) => attachment.key === key ? { ...attachment, pending: false, error: cause instanceof Error ? cause.message : String(cause) } : attachment) }));
      }
    }
  })());
}
