import type { AssistantCitation } from "./messageCitations.js";
import { ComposerContextId, ResponseContextRecord, type OrchestrationMessageContext, type ThreadContextRecord } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { collectAssistantCitations, serializeAssistantCitation } from "./messageCitations.js";
import { collectComposerContextReferences, formatComposerContextReference, replaceComposerContextReferences, sanitizeComposerContextLabel, toKindScopedComposerContextId } from "@t3tools/shared/composerContextReferences";
import { insertComposerReferenceText, type TextSelection } from "./composerAttachments.js";
import { renderAssistantQuoteBlock } from "./assistantQuoteText.js";

export interface FileReference {
  readonly type: "file";
  readonly uri: string;
  readonly path: string;
  readonly label: string;
  /** One-based positions; the end is exclusive, as in VS Code selections. Absent on whole-file references. */
  readonly range?: { readonly start: { readonly line: number; readonly column: number }; readonly end: { readonly line: number; readonly column: number } };
  readonly text?: string;
  /** Readable draft token; absent on legacy references that were added as chips only. */
  readonly inlineText?: string;
}
export interface AssistantQuoteContext { readonly type: "assistant"; readonly citation: AssistantCitation; readonly contextId?: string }
/** A reply to an earlier assistant response (T3 0.1.10). Its draft token is already the wire form, so sending only attaches `record`. */
export interface ResponseReplyContext { readonly type: "response"; readonly record: ResponseContextRecord }
export type ComposerContext = FileReference | AssistantQuoteContext | ResponseReplyContext | { readonly type: "thread"; readonly record: ThreadContextRecord };

export function insertSideChatReference(text: string, contexts: ReadonlyArray<ComposerContext>, record: ThreadContextRecord, selection: TextSelection) {
  const token = formatComposerContextReference({ kind: "thread", contextId: record.contextId, label: record.label });
  const prefix = selection.start > 0 && !/\s/.test(text[selection.start - 1] ?? "") ? " " : "";
  const inserted = insertComposerReferenceText(text, `${prefix}${token} `, selection);
  return { ...inserted, contexts: [...contexts.filter((context) => context.type !== "thread" || context.record.contextId !== record.contextId), { type: "thread" as const, record }] };
}

export function sideChatRecordsForMessage(text: string, contexts: ReadonlyArray<ComposerContext>): ThreadContextRecord[] {
  const ids = new Set(collectComposerContextReferences(text).flatMap(reference => reference.kind === "thread" ? [reference.contextId] : []));
  return contexts.flatMap(context => context.type === "thread" && ids.delete(context.record.contextId) ? [context.record] : []);
}
export function messageContextWithSideChats(context: OrchestrationMessageContext | undefined, text: string, records: ReadonlyArray<ThreadContextRecord>): OrchestrationMessageContext | undefined {
  const taken = new Set(context?.records.map(record => record.contextId));
  const threads = sideChatRecordsForMessage(text, records.map(record => ({ type: "thread", record }))).filter(record => !taken.has(record.contextId));
  return threads.length ? { ...(context ?? { version: 1 }), records: [...(context?.records ?? []), ...threads] } : context;
}
export interface InsertReferenceEvent { readonly draftKey: string; readonly reference: FileReference }

/** Draft-only quote references keep their payload out of the input; sending expands them to T3's portable citation format. `contexts` lets the new quote count the ones already in the draft; unknown tokens in `text` count as distinct. */
export function insertAssistantQuote(text: string, context: AssistantQuoteContext & { contextId: string }, selection: TextSelection, contexts: ReadonlyArray<ComposerContext> = []) {
  const insert = (number: number) => insertComposerReferenceText(text, formatComposerContextReference({ kind: "assistant-quote", contextId: ComposerContextId.make(context.contextId), label: assistantQuoteLabel(context.citation, number) }), selection);
  // Only the new token's own label depends on its number, so the second pass cannot move anything the first measured.
  const number = assistantQuoteNumbers(insert(1).text, [...contexts, context]).at(-1) ?? 1;
  return insert(number);
}
/** How many subagents a reply may name, as the contract allows. */
const RESPONSE_SUBAGENT_LIMIT = 20;
const RESPONSE_LABEL_MAX_CHARS = 64;
/** A reply carries the response's opening, which the webview caps at 300 characters (`captureAssistantMessageOpening`). */
export const RESPONSE_OPENING_MAX_CHARS = 300;
/**
 * Ported from T3 Code `responseContextRecord` (apps/web/src/lib/composerContextRecords.ts, 0.1.10): one record per response, so
 * replying to it again reuses the same reference. Decoded, so a record that would exceed the contract's limits throws here, not at send.
 */
export function responseContextRecord(input: {
  readonly citation: { readonly environmentId: string; readonly threadId: string; readonly messageId: string; readonly text: string; readonly start: number; readonly end: number; readonly prefix: string; readonly suffix: string };
  readonly itemId: string;
  readonly subagents: ReadonlyArray<{ readonly threadId: string; readonly title: string; readonly environmentId?: string }>;
}): ResponseContextRecord {
  const { environmentId, threadId, messageId, text, start, end, prefix, suffix } = input.citation;
  // As T3 Code 0.1.10's apps/web/src/lib/composerContextRecords.ts: never end the label inside a surrogate pair.
  function responseLabel(value: string): string {
    const last = value.charCodeAt(RESPONSE_LABEL_MAX_CHARS - 1);
    return sanitizeComposerContextLabel(value.slice(0, last >= 0xd800 && last <= 0xdbff ? RESPONSE_LABEL_MAX_CHARS - 1 : RESPONSE_LABEL_MAX_CHARS), "response");
  }
  return Schema.decodeUnknownSync(ResponseContextRecord)({
    version: 1, kind: "response",
    contextId: toKindScopedComposerContextId("response", messageId),
    label: responseLabel(text),
    citation: { version: 1, environmentId, threadId, messageId, text, start, end, prefix, suffix },
    itemId: input.itemId,
    ...(input.subagents.length > 0 ? { subagents: input.subagents.slice(0, RESPONSE_SUBAGENT_LIMIT).map(({ title, ...subagent }) => ({ ...subagent, title: sanitizeComposerContextLabel(title, "response") })) } : {}),
  });
}
/**
 * Leads the draft with a reply to `record`, as T3 sends it: the reference comes first, so its card sits above the text it is about.
 * One reply per message, as in T3: an earlier reply's token is replaced. Replying again to the same response changes nothing.
 * The result differs from `text` in one contiguous range, so the composer applies it as a single native edit.
 */
export function insertResponseReply(text: string, contexts: ReadonlyArray<ComposerContext>, record: ResponseContextRecord) {
  const nextContexts: ComposerContext[] = [...contexts.filter((context) => context.type !== "response"), { type: "response", record }];
  const replies = collectComposerContextReferences(text).filter((reference) => reference.kind === "response");
  const only = replies.length === 1 ? replies[0]! : undefined;
  if (only && only.contextId === record.contextId && only.start === 0) return { text, contexts: nextContexts, cursor: text.length };
  let rest = "", at = 0;
  // Each earlier token goes with the one space that separated it from the text after it.
  for (const reply of replies) { rest += text.slice(at, reply.start); at = reply.end + (text[reply.end] === " " ? 1 : 0); }
  rest += text.slice(at);
  const token = formatComposerContextReference({ kind: "response", contextId: record.contextId, label: record.label });
  const next = `${token}${/^\s/.test(rest) ? "" : " "}${rest}`;
  return { text: next, contexts: nextContexts, cursor: next.length };
}
/** The reply records the sent text still references, once each. */
export function responseRecordsForMessage(text: string, contexts: ReadonlyArray<ComposerContext>): ReadonlyArray<ResponseContextRecord> {
  const ids = new Set<string>(collectComposerContextReferences(text).flatMap((reference) => reference.kind === "response" ? [reference.contextId] : []));
  const records = new Map<string, ResponseContextRecord>();
  for (const context of contexts) if (context.type === "response" && ids.has(context.record.contextId)) records.set(context.record.contextId, context.record);
  return [...records.values()];
}
/** Adds the replies `text` references to a message's context, after its attachment records; an id already taken is not overwritten. */
export function messageContextWithReplies(context: OrchestrationMessageContext | undefined, text: string, records: ReadonlyArray<ResponseContextRecord>): OrchestrationMessageContext | undefined {
  const taken = new Set<string>(context?.records.map((record) => record.contextId));
  const replies = responseRecordsForMessage(text, records.map((record) => ({ type: "response" as const, record }))).filter((record) => !taken.has(record.contextId));
  return replies.length ? { ...(context ?? { version: 1 as const }), records: [...(context?.records ?? []), ...replies] } : context;
}
const QUOTE_PREVIEW_CHARS = 42;
/** Bounded before collapsing, so a quote of many thousands of characters costs no more than a short one. */
function quotePreview(value: string): string {
  const head = value.slice(0, QUOTE_PREVIEW_CHARS * 8), chars = Array.from(head.replace(/\s+/g, " ").trim());
  return chars.length > QUOTE_PREVIEW_CHARS || value.trimEnd().length > head.length ? `${chars.slice(0, QUOTE_PREVIEW_CHARS).join("")}…` : chars.join("");
}
/** The comment says what the user wants, so it leads; the quoted text is the fallback. Chips and draft tokens share this, sanitising included, so they never differ. */
export function assistantQuoteLabel(citation: AssistantCitation, number: number): string {
  // The textarea cannot slant one token, so quotation marks carry what italics carry on the chip:
  // a comment is the user's own voice, the fallback is the assistant's words.
  const comment = quotePreview(citation.comment ?? "");
  const preview = comment || (quotePreview(citation.text) && `“${quotePreview(citation.text)}”`);
  return sanitizeComposerContextLabel(`❝${number}${preview ? ` ${preview}` : ""}`, "assistant-quote");
}
/** Must match `citationKey` in AssistantCitationLink: the transcript numbers quotes by this identity, comment excluded. */
const citationIdentity = (citation: AssistantCitation) => [citation.environmentId, citation.threadId, citation.messageId, citation.start, citation.end, citation.text].join("\u0000");
/**
 * Each quote's number, aligned with `contexts`, exactly as the transcript will badge it once sent: by order of
 * appearance in the message, one number per distinct citation, chip-only legacy quotes after the inline ones.
 * Derived from the draft rather than stored, so removing or moving a quote renumbers the rest.
 */
export function assistantQuoteNumbers(text: string, contexts: ReadonlyArray<ComposerContext>): Array<number | undefined> {
  const indexById = new Map<string, number>();
  contexts.forEach((context, index) => { if (context.type === "assistant" && context.contextId) indexById.set(context.contextId, index); });
  const numbers = new Map<string, number>();
  const claim = (key: string) => { let number = numbers.get(key); if (number === undefined) { number = numbers.size + 1; numbers.set(key, number); } return number; };
  const result: Array<number | undefined> = contexts.map(() => undefined);
  const keyOf = (index: number) => { const context = contexts[index]; return context?.type === "assistant" ? citationIdentity(context.citation) : ""; };
  const inline = [
    ...collectComposerContextReferences(text).flatMap((reference) => reference.kind === "assistant-quote" ? [{ start: reference.start, id: reference.contextId as string, citation: undefined }] : []),
    ...(text.includes("t3-citation:") ? collectAssistantCitations(text).map(({ start, citation }) => ({ start, id: "", citation })) : []),
  ].sort((a, b) => a.start - b.start);
  for (const item of inline) {
    const index = indexById.get(item.id);
    const number = claim(item.citation ? citationIdentity(item.citation) : index === undefined ? `token:${item.id}` : keyOf(index));
    if (index !== undefined) result[index] = number;
  }
  contexts.forEach((context, index) => { if (context.type === "assistant" && !context.contextId) result[index] = claim(citationIdentity(context.citation)); });
  return result;
}
/**
 * Rewrites draft tokens whose label has gone stale (comment edited, quote added or removed before them).
 * `map` carries a caret through the rewrite: a caret inside a rewritten token lands after it.
 * Null when nothing is stale, so applying it repeatedly settles.
 */
export function syncAssistantQuoteLabels(text: string, contexts: ReadonlyArray<ComposerContext>): { readonly text: string; readonly map: (position: number) => number } | null {
  const numbers = assistantQuoteNumbers(text, contexts);
  const edits: Array<{ start: number; end: number; source: string }> = [];
  for (const reference of collectComposerContextReferences(text)) {
    if (reference.kind !== "assistant-quote") continue;
    const index = contexts.findIndex((context) => context.type === "assistant" && context.contextId === reference.contextId);
    const context = contexts[index], number = numbers[index];
    if (context?.type !== "assistant" || number === undefined) continue;
    const source = formatComposerContextReference({ kind: "assistant-quote", contextId: reference.contextId, label: assistantQuoteLabel(context.citation, number) });
    if (source !== reference.source) edits.push({ start: reference.start, end: reference.end, source });
  }
  if (!edits.length) return null;
  let result = "", at = 0;
  for (const edit of edits) { result += text.slice(at, edit.start) + edit.source; at = edit.end; }
  return { text: result + text.slice(at), map: (position) => {
    let shift = 0;
    for (const edit of edits) {
      if (position >= edit.end) shift += edit.source.length - (edit.end - edit.start);
      else return position > edit.start ? edit.start + shift + edit.source.length : position + shift;
    }
    return position + shift;
  } };
}
export function contextIsReferenced(text: string, context: ComposerContext): boolean {
  if (context.type === "response" || context.type === "thread") return collectComposerContextReferences(text).some((reference) => reference.kind === context.type && reference.contextId === context.record.contextId);
  if (context.type === "file") return !context.inlineText || fileReferenceOccurrences(text, [context]).length > 0;
  return context.type !== "assistant" || !context.contextId || collectComposerContextReferences(text).some((reference) => reference.kind === "assistant-quote" && reference.contextId === context.contextId);
}
export function removeContextReference(text: string, context: ComposerContext): string {
  if (context.type === "file" && context.inlineText) {
    for (const match of fileReferenceOccurrences(text, [context]).reverse()) text = text.slice(0, match.start) + text.slice(match.end);
    return text;
  }
  if (context.type === "response" || context.type === "thread") {
    // The space the reply was inserted with goes too, so the message does not start with one.
    const tokens = collectComposerContextReferences(text).filter((reference) => reference.kind === context.type && reference.contextId === context.record.contextId);
    for (const token of tokens.reverse()) text = text.slice(0, token.start) + text.slice(token.end + (text[token.end] === " " ? 1 : 0));
    return text;
  }
  return context.type === "assistant" && context.contextId ? replaceComposerContextReferences(text, (reference) => reference.kind === "assistant-quote" && reference.contextId === context.contextId ? "" : reference.source) : text;
}

export function fileReferenceLabel(reference: FileReference): string {
  if (!reference.range) return reference.label;
  const { start, end } = reference.range;
  const lastLine = end.column === 1 && end.line > start.line ? end.line - 1 : end.line;
  return `${reference.label}:${start.line}${lastLine > start.line ? `-${lastLine}` : ""}`;
}
export function fileReferenceOccurrences(text: string, contexts: ReadonlyArray<ComposerContext>) {
  const protectedRanges = [...collectComposerContextReferences(text), ...collectAssistantCitations(text)];
  const matches: Array<{ start: number; end: number; context: FileReference }> = [];
  // Longest token first: whole-file references end at a `.`, so `@.env` would otherwise claim `@.env.local`.
  for (const context of [...contexts].sort((a, b) => (b.type === "file" && b.inlineText ? b.inlineText.length : 0) - (a.type === "file" && a.inlineText ? a.inlineText.length : 0))) {
    if (context.type !== "file" || !context.inlineText) continue;
    for (let start = text.indexOf(context.inlineText); start >= 0; start = text.indexOf(context.inlineText, start + context.inlineText.length)) {
      const end = start + context.inlineText.length;
      if (/[\p{L}\p{N}_:/\\-]/u.test(text[end] ?? "") || protectedRanges.some(range => start < range.end && end > range.start) || matches.some(range => start < range.end && end > range.start)) continue;
      matches.push({ start, end, context });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}
export function insertFileReference(text: string, contexts: ReadonlyArray<ComposerContext>, reference: FileReference, selection: TextSelection) {
  const sameRange = (item: ComposerContext) => item.type === "file" && item.uri === reference.uri && JSON.stringify(item.range) === JSON.stringify(reference.range);
  const label = fileReferenceLabel(reference);
  const collision = contexts.some(item => item.type === "file" && fileReferenceLabel(item) === label && !sameRange(item));
  const { start, end } = reference.range ?? {};
  const uniqueLabel = collision ? start && end ? `${reference.path}:${start.line}:${start.column}-${end.line}:${end.column}` : reference.path : label;
  const existing = contexts.find(item => sameRange(item) && item.type === "file" && item.inlineText) as FileReference | undefined;
  const inlineText = existing?.inlineText ?? `@${/[\s"\\]/.test(uniqueLabel) ? JSON.stringify(uniqueLabel) : uniqueLabel}`;
  const context = { ...reference, inlineText };
  const prefix = selection.start > 0 && !/\s/.test(text[Math.min(text.length, selection.start) - 1] ?? "") ? " " : "";
  const inserted = insertComposerReferenceText(text, `${prefix}${inlineText} `, selection);
  return { ...inserted, contexts: [...contexts.filter(item => !sameRange(item)), context] };
}
/** The `@` stays in the label so the transcript shows the token the user typed, and renderers can spot it. */
function fileReferenceLink(context: FileReference): string {
  const title = `@${fileReferenceLabel(context).replace(/[\\[\]]/g, "\\$&")}`;
  const lastLine = context.range && (context.range.end.column === 1 && context.range.end.line > context.range.start.line ? context.range.end.line - 1 : context.range.end.line);
  const range = context.range && lastLine ? `#L${context.range.start.line}${lastLine > context.range.start.line ? `-L${lastLine}` : ""}` : "";
  return `[${title}](${(context.uri + range).replace(/[()]/g, character => encodeURIComponent(character))})`;
}
export function formatComposerMessage(text: string, contexts: ReadonlyArray<ComposerContext>): string {
  const usedFiles = new Set<FileReference>();
  for (const match of fileReferenceOccurrences(text, contexts).reverse()) {
    usedFiles.add(match.context);
    text = text.slice(0, match.start) + fileReferenceLink(match.context) + text.slice(match.end);
  }
  const quotes = new Map(contexts.flatMap((context) => context.type === "assistant" && context.contextId ? [[context.contextId, context] as const] : []));
  const used = new Set<string>();
  const inlineText = replaceComposerContextReferences(text, (reference) => {
    const context = reference.kind === "assistant-quote" ? quotes.get(reference.contextId) : undefined;
    if (!context) return reference.source;
    used.add(reference.contextId);
    return serializeAssistantCitation(context.citation);
  });
  return [inlineText.trim(), ...contexts.map((context) => {
    // A reply's token is already its wire form; its record travels as message context.
    if (context.type === "response" || context.type === "thread") return "";
    if (context.type === "assistant") {
      if (context.contextId && !used.has(context.contextId)) return "";
      // Retain T3's clickable source for chip-only legacy quotes, and the readable quote/comment for every provider/server version.
      return `${context.contextId ? "" : serializeAssistantCitation(context.citation)}${renderAssistantQuoteBlock(context.citation)}`;
    }
    if (context.inlineText && !usedFiles.has(context)) return "";
    // A whole-file reference has no snapshot to attach: its inline link already is the whole payload.
    if (!context.range && !context.text) return "";
    const { start, end } = context.range ?? {};
    const selection = !start || !end ? "" : context.text ? `Selected range: ${start.line}:${start.column}–${end.line}:${end.column} (end exclusive). Snapshot from the editor, including unsaved changes.` : "File reference from the editor.";
    const fence = "`".repeat(Math.max(3, ...[...(context.text ?? "").matchAll(/`+/g)].map((match) => match[0].length + 1)));
    return [fileReferenceLink(context), selection, context.text ? `${fence}\n${context.text}\n${fence}` : ""].filter(Boolean).join("\n");
  })].filter(Boolean).join("\n\n");
}
