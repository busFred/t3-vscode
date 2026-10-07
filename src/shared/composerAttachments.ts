import { ComposerContextId, isProviderSendTurnSupportedImageMimeType, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, PROVIDER_SEND_TURN_MAX_FILE_BYTES, type OrchestrationMessageContext, type ChatAttachment, type AttachmentCreateUploadUrlInput } from "@t3tools/contracts";
import { mediaMimeType } from "@t3tools/shared/filePreview";
import { collectComposerContextReferences, formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import * as Schema from "effect/Schema";

export interface DraftAttachment {
  readonly key: string;
  readonly contextId?: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly previewUrl?: string;
  readonly attachment?: ChatAttachment;
  readonly environmentId?: string;
  readonly pending?: boolean;
  readonly error?: string;
}
export interface AttachmentReference { readonly contextId: string; readonly attachmentId: string }
export interface TextSelection { readonly start: number; readonly end: number }
export function insertComposerReferenceText(text: string, referenceText: string, selection: TextSelection) {
  let start = Math.max(0, Math.min(text.length, selection.start));
  let end = Math.max(start, Math.min(text.length, selection.end));
  const existing = [...collectComposerContextReferences(text), ...collectAssistantCitations(text)];
  if (start === end) {
    const inside = existing.find((reference) => reference.start < start && start < reference.end);
    if (inside) start = end = inside.end;
  } else {
    for (const reference of existing) {
      if (reference.start < start && start < reference.end) start = reference.start;
      if (reference.start < end && end < reference.end) end = reference.end;
    }
  }
  return { text: text.slice(0, start) + referenceText + text.slice(end), cursor: start + referenceText.length };
}
export function insertAttachmentReferences(text: string, attachments: ReadonlyArray<DraftAttachment>, selection: TextSelection) {
  const references = attachments.filter((file) => file.contextId).map((file) => formatComposerContextReference({
    kind: file.mimeType.startsWith("image/") ? "image" : "file", contextId: ComposerContextId.make(file.contextId!), label: file.name,
  })).join(" ");
  return insertComposerReferenceText(text, references, selection);
}
/** Bind inline positions to host-owned uploads, rather than trusting filenames from the renderer. */
export function attachmentMessageContext(text: string, attachments: ReadonlyArray<ChatAttachment>, bindings: ReadonlyArray<AttachmentReference>): OrchestrationMessageContext | undefined {
  const byId = new Map<string, ChatAttachment>();
  for (const binding of bindings) {
    const id = Schema.decodeUnknownSync(ComposerContextId)(binding.contextId);
    const file = attachments.find((file) => file.id === binding.attachmentId);
    if (!file || byId.has(id)) throw new Error("Invalid inline attachment reference.");
    byId.set(id, file);
  }
  const records = new Map<string, OrchestrationMessageContext["records"][number]>();
  for (const reference of collectComposerContextReferences(text)) {
    const file = byId.get(reference.contextId);
    if (!file) continue;
    const kind = file.type === "image" ? "image" : "file";
    if (reference.kind !== kind) throw new Error("This inline reference does not match its attachment.");
    const payload = { version: 1 as const, contextId: reference.contextId, label: file.name, attachmentId: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes };
    records.set(reference.contextId, kind === "image" ? { ...payload, kind: "image" } : { ...payload, kind: "file" });
  }
  return records.size ? { version: 1, records: [...records.values()] } : undefined;
}
const fileTypes: Record<string, string> = { pdf: "application/pdf", json: "application/json", csv: "text/csv", txt: "text/plain", md: "text/markdown", py: "text/x-python", js: "text/javascript", ts: "text/plain", html: "text/html", css: "text/css", zip: "application/zip" };
export function attachmentMimeType(name: string, reported = ""): string {
  return reported.trim().toLowerCase() || mediaMimeType(name) || fileTypes[name.split(".").at(-1)?.toLowerCase() ?? ""] || "application/octet-stream";
}
export function attachmentUploadInput(name: string, mimeType: string, sizeBytes: number): AttachmentCreateUploadUrlInput {
  const mime = attachmentMimeType(name, mimeType);
  const type = isProviderSendTurnSupportedImageMimeType(mime) ? "image" : "file";
  const max = type === "image" ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
  if (!name.trim() || name.length > 255 || mime.length > 100 || !Number.isInteger(sizeBytes) || sizeBytes < 1) throw new Error("Choose a nonempty file with a valid name and type.");
  if (sizeBytes > max) throw new Error(`'${name}' exceeds the ${max / 1024 / 1024} MB attachment limit.`);
  return { type, name, mimeType: mime, sizeBytes } as AttachmentCreateUploadUrlInput;
}
