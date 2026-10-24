import { ComposerContextId, type AttachmentCreateUploadUrlInput } from "@t3tools/contracts";
import { collectComposerContextReferences, formatComposerContextReference, replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { attachmentUploadInput, insertComposerReferenceText, type DraftAttachment, type TextSelection } from "./composerAttachments.js";
import { fileReferenceOccurrences, type ComposerContext, type FileReference } from "./composerContext.js";
import { collectAssistantCitations } from "./messageCitations.js";
import { parseDraftTransfer } from "./viewDraft.js";

/**
 * What a copy from the composer carries. `text/plain` reads well anywhere; `text/html` shows text and images to rich editors and
 * hides the payload in a `data-t3-composer` attribute, because Chromium round-trips HTML intact between webviews while it neither
 * writes nor exposes custom formats to a paste event. Image bytes ride once, in the `<img>` tags, not in the payload.
 */
export interface ComposerClipboardPayload { readonly text: string; readonly contexts: ReadonlyArray<ComposerContext>; readonly attachments: ReadonlyArray<DraftAttachment> }
export interface ComposerClipboard {
  /** The copied range, widened to whole references; a cut removes exactly this. */
  readonly range: TextSelection;
  readonly plain: string;
  readonly html: string;
  /** Set when the selection is one image and nothing else, so it can also be offered as a pasteable file. */
  readonly image?: { readonly dataUrl: string; readonly name: string };
}
export interface ComposerPastePlan {
  readonly text: string;
  readonly cursor: number;
  readonly contexts: ReadonlyArray<ComposerContext>;
  /** New pending slots, each with a matching entry in `uploads`. */
  readonly attachments: ReadonlyArray<DraftAttachment>;
  readonly uploads: ReadonlyArray<{ readonly key: string; readonly input: AttachmentCreateUploadUrlInput; readonly dataUrl: string }>;
}
type ClipboardDraft = { readonly text: string; readonly contexts: ReadonlyArray<ComposerContext>; readonly attachments?: ReadonlyArray<DraftAttachment> };

/** Larger selections fall back to the browser's own paste. */
const MAX_PAYLOAD_TEXT = 200_000;
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+)(=*)$/;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function encode(value: string): string {
  const bytes = new TextEncoder().encode(value); let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
const decode = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
/** Decoded size is derived, never trusted from the payload. */
function imageData(dataUrl: string | undefined): { mimeType: string; sizeBytes: number } | undefined {
  const match = dataUrl && IMAGE_DATA_URL.exec(dataUrl); if (!match) return undefined;
  return { mimeType: match[1]!, sizeBytes: Math.floor(match[2]!.length * 3 / 4) - match[3]!.length };
}
const wholeReferences = (text: string, selection: TextSelection): TextSelection => {
  let { start, end } = selection;
  for (const reference of [...collectComposerContextReferences(text), ...collectAssistantCitations(text)]) {
    if (reference.start < selection.start && selection.start < reference.end) start = reference.start;
    if (reference.start < selection.end && selection.end < reference.end) end = reference.end;
  }
  return { start, end };
};

/** Undefined when the selection holds no reference, so the browser's own copy stands. */
/** `nonce` is the host's per-session clipboard secret; only a payload carrying it may restore file and quote contexts on paste. */
export function buildComposerClipboard(draft: ClipboardDraft, selection: TextSelection, nonce?: string): ComposerClipboard | undefined {
  if (selection.start >= selection.end) return undefined;
  const range = wholeReferences(draft.text, { start: Math.max(0, selection.start), end: Math.min(draft.text.length, selection.end) });
  const text = draft.text.slice(range.start, range.end), references = collectComposerContextReferences(text), files = fileReferenceOccurrences(text, draft.contexts);
  if (!references.length && !files.length) return undefined;
  const backed = (id: string) => draft.attachments?.find((file) => file.contextId === id && file.mimeType.startsWith("image/") && imageData(file.previewUrl));
  let html = "", at = 0;
  for (const reference of references) {
    const file = reference.kind === "image" ? backed(reference.contextId) : undefined;
    html += `${escapeHtml(text.slice(at, reference.start))}${file ? `<img data-t3-context-id="${escapeHtml(reference.contextId)}" src="${file.previewUrl}" alt="${escapeHtml(reference.label)}">` : escapeHtml(reference.label)}`;
    at = reference.end;
  }
  html = (html + escapeHtml(text.slice(at))).replace(/\n/g, "<br>");
  const ids = new Set<string>(references.map((reference) => reference.contextId));
  const payload = { v: 1, ...(nonce ? { nonce } : {}), text,
    contexts: [...draft.contexts.filter((context) => context.type === "assistant" && context.contextId && ids.has(context.contextId)), ...new Set(files.map((match) => match.context))],
    attachments: [...ids].flatMap((id) => { const file = backed(id); return file ? [{ key: file.key, contextId: id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes }] : []; }) };
  const only = references.length === 1 && references[0]!.source === text.trim() ? backed(references[0]!.contextId) : undefined;
  return { range, plain: replaceComposerContextReferences(text, (reference) => reference.label),
    html: `<span data-t3-composer="${encode(JSON.stringify(payload))}" style="white-space:pre-wrap">${html}</span>`,
    ...(only && references[0]!.kind === "image" ? { image: { dataUrl: only.previewUrl!, name: only.name } } : {}) };
}

/**
 * Anything from outside is untrusted: it passes the same checks as a draft handed to another tab. Any web page can put this
 * HTML on the clipboard, and file and quote contexts reach the prompt while showing only as a chip, so they are kept only when
 * the payload carries `trustedNonce`; otherwise just the visible text and images are pasted.
 */
export function parseComposerClipboardHtml(html: string, trustedNonce?: string): ComposerClipboardPayload | undefined {
  const encoded = /data-t3-composer="([A-Za-z0-9+/=]+)"/.exec(html)?.[1]; if (!encoded) return undefined;
  try {
    const raw = JSON.parse(decode(encoded)) as { v?: unknown; nonce?: unknown; text?: unknown; contexts?: unknown; attachments?: unknown };
    if (raw.v !== 1 || !Array.isArray(raw.attachments) || typeof raw.text !== "string" || raw.text.length > MAX_PAYLOAD_TEXT) return undefined;
    if (!trustedNonce || raw.nonce !== trustedNonce) raw.contexts = [];
    const previews = new Map<string, string>();
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
      const id = /\sdata-t3-context-id="([^"]+)"/.exec(tag)?.[1], source = /\ssrc="(data:image\/[^"]+)"/.exec(tag)?.[1];
      if (id && source && !previews.has(id)) previews.set(id, source);
    }
    const attachments = raw.attachments.map((file: { contextId?: string }) => ({ ...file, ...(file.contextId && previews.has(file.contextId) ? { previewUrl: previews.get(file.contextId)! } : {}) }));
    const draft = parseDraftTransfer({ draftKey: "clipboard", draft: { text: raw.text, contexts: raw.contexts, attachments } }, "clipboard")?.draft;
    return draft && { text: draft.text, contexts: draft.contexts, attachments: draft.attachments ?? [] };
  } catch { return undefined; }
}

/**
 * Lands a payload in a draft. A reference gets a fresh id when its own is still referenced there (a second copy needs its
 * own chip); one whose backing is still in the draft unreferenced (it was just cut) takes that back instead of re-uploading.
 * What cannot be backed (a file without bytes, or `attach` off) falls back to its label.
 */
export function planComposerPaste(payload: ComposerClipboardPayload, draft: ClipboardDraft, selection: TextSelection, newId: () => string, attach = true): ComposerPastePlan {
  const rest = draft.text.slice(0, selection.start) + draft.text.slice(selection.end);
  const used = new Set<string>(collectComposerContextReferences(rest).map((reference) => reference.contextId));
  const contexts = [...draft.contexts], attachments: DraftAttachment[] = [], uploads: Array<ComposerPastePlan["uploads"][number]> = [];
  const taken = (id: string) => used.has(id) || contexts.some((context) => context.type === "assistant" && context.contextId === id) || [...(draft.attachments ?? []), ...attachments].some((file) => file.contextId === id);
  // Short ids keep the text readable; a collision falls back to the whole uuid.
  const fresh = (prefix: string, size?: number) => { const id = newId().replaceAll("-", ""); return taken(`${prefix}_${id.slice(0, size)}`) ? `${prefix}_${id}` : `${prefix}_${id.slice(0, size)}`; };
  const resolved = new Map<string, string | null>();
  const resolve = (reference: ReturnType<typeof collectComposerContextReferences>[number]): string | null => {
    const id = reference.contextId, known = resolved.get(id); if (known !== undefined) return known;
    let result: string | null = null;
    if (reference.kind === "assistant-quote") {
      const context = payload.contexts.find((item) => item.type === "assistant" && item.contextId === id), existing = draft.contexts.some((item) => item.type === "assistant" && item.contextId === id);
      if (context?.type === "assistant") {
        result = existing && used.has(id) ? fresh("quote", 12) : id;
        if (!existing || result !== id) contexts.push({ ...context, contextId: result });
      }
    } else if (draft.attachments?.some((file) => file.contextId === id && !file.error) && !used.has(id)) result = id;
    else {
      const file = reference.kind === "image" && attach ? payload.attachments.find((item) => item.contextId === id) : undefined, data = imageData(file?.previewUrl);
      try {
        if (file && data) {
          const input = attachmentUploadInput(file.name, data.mimeType, data.sizeBytes), key = newId();
          result = fresh("image");
          attachments.push({ key, contextId: result, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, previewUrl: file.previewUrl!, pending: true });
          uploads.push({ key, input, dataUrl: file.previewUrl! });
        }
      } catch { result = null; }
    }
    resolved.set(id, result); return result;
  };
  const pasted = replaceComposerContextReferences(payload.text, (reference) => {
    const id = resolve(reference);
    return id === null ? reference.label : formatComposerContextReference({ kind: reference.kind, contextId: ComposerContextId.make(id), label: reference.label });
  });
  // An `@` token binds to a context by its text, so a token the draft already owns for another file loses its binding rather than hijack that one.
  const sameFile = (a: FileReference, b: FileReference) => a.uri === b.uri && JSON.stringify(a.range) === JSON.stringify(b.range);
  for (const { context } of fileReferenceOccurrences(payload.text, payload.contexts)) {
    const owner = contexts.find((item): item is FileReference => item.type === "file" && item.inlineText === context.inlineText);
    if (!owner) contexts.push(context);
    else if (!sameFile(owner, context)) { const { inlineText: _token, ...chip } = context; contexts.push(chip); }
  }
  return { ...insertComposerReferenceText(draft.text, pasted, selection), contexts, attachments, uploads };
}
