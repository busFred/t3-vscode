import * as Schema from "effect/Schema";
import { AssistantCitation, ChatAttachment, ComposerContextId } from "@t3tools/contracts";
import type { ComposerContext } from "./composerContext.js";
import { isObject } from "./bridge.js";
import type { DraftAttachment } from "./composerAttachments.js";

export interface ViewDraft { readonly text: string; readonly contexts: ReadonlyArray<ComposerContext>; readonly attachments?: ReadonlyArray<DraftAttachment> }
export interface DraftTransfer { readonly draftKey: string; readonly draft: ViewDraft }
export function parseDraftTransfer(raw: unknown, expectedKey: string): DraftTransfer | undefined {
  if (!isObject(raw) || raw.draft === undefined) return undefined;
  if (raw.draftKey !== expectedKey) throw new Error("The conversation changed before its draft could be copied. Try opening it again.");
  if (!isObject(raw.draft) || typeof raw.draft.text !== "string" || !Array.isArray(raw.draft.contexts)) throw new Error("Invalid conversation draft.");
  const contexts = raw.draft.contexts.map((context): ComposerContext => {
    if (!isObject(context)) throw new Error("Invalid draft context.");
    if (context.type === "assistant") return { type: "assistant", citation: Schema.decodeUnknownSync(AssistantCitation)(context.citation), ...(context.contextId !== undefined ? { contextId: Schema.decodeUnknownSync(ComposerContextId)(context.contextId) } : {}) };
    const position = (raw: unknown) => isObject(raw) && Number.isInteger(raw.line) && Number(raw.line) > 0 && Number.isInteger(raw.column) && Number(raw.column) > 0;
    if (context.type !== "file" || ![context.uri, context.path, context.label, context.text].every((value) => typeof value === "string") || !isObject(context.range) || !position(context.range.start) || !position(context.range.end)) throw new Error("Invalid file reference in draft.");
    return context as unknown as ComposerContext;
  });
  const attachments = raw.draft.attachments;
  if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > 100)) throw new Error("Invalid draft attachments.");
  const parsed = attachments?.map((value): DraftAttachment => {
    if (!isObject(value) || typeof value.key !== "string" || typeof value.name !== "string" || typeof value.mimeType !== "string" || !Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) < 1 || value.pending) throw new Error("Wait for attachments to finish uploading before opening this chat.");
    if (value.previewUrl !== undefined && (typeof value.previewUrl !== "string" || value.previewUrl.length > 14_000_000 || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.previewUrl))) throw new Error("Invalid attachment preview.");
    return { key: value.key, name: value.name, mimeType: value.mimeType, sizeBytes: Number(value.sizeBytes),
      ...(value.contextId !== undefined ? { contextId: Schema.decodeUnknownSync(ComposerContextId)(value.contextId) } : {}),
      ...(typeof value.previewUrl === "string" ? { previewUrl: value.previewUrl } : {}),
      ...(value.attachment ? { attachment: Schema.decodeUnknownSync(ChatAttachment)(value.attachment) } : {}),
      ...(typeof value.environmentId === "string" ? { environmentId: value.environmentId } : {}),
      ...(typeof value.error === "string" ? { error: value.error } : {}) };
  });
  return { draftKey: expectedKey, draft: { text: raw.draft.text, contexts, ...(parsed ? { attachments: parsed } : {}) } };
}
