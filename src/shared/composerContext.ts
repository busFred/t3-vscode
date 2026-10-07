import { ComposerContextId, type AssistantCitation } from "@t3tools/contracts";
import { collectAssistantCitations, renderAssistantCitationsAsText, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { collectComposerContextReferences, formatComposerContextReference, replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { insertComposerReferenceText, type TextSelection } from "./composerAttachments.js";

export interface FileReference {
  readonly type: "file";
  readonly uri: string;
  readonly path: string;
  readonly label: string;
  /** One-based positions; the end is exclusive, as in VS Code selections. */
  readonly range: { readonly start: { readonly line: number; readonly column: number }; readonly end: { readonly line: number; readonly column: number } };
  readonly text: string;
  /** Readable draft token; absent on legacy references that were added as chips only. */
  readonly inlineText?: string;
}
export interface AssistantQuoteContext { readonly type: "assistant"; readonly citation: AssistantCitation; readonly contextId?: string }
export type ComposerContext = FileReference | AssistantQuoteContext;
export interface InsertReferenceEvent { readonly draftKey: string; readonly reference: FileReference }

/** Draft-only quote references keep their payload out of the input; sending expands them to T3's portable citation format. */
export function insertAssistantQuote(text: string, context: AssistantQuoteContext & { contextId: string }, selection: TextSelection) {
  const quote = context.citation.text.replace(/\s+/g, " ").trim();
  const reference = formatComposerContextReference({ kind: "assistant-quote", contextId: ComposerContextId.make(context.contextId), label: `❝ ${quote.length > 36 ? `${quote.slice(0, 36)}…` : quote}` });
  return insertComposerReferenceText(text, reference, selection);
}
export function contextIsReferenced(text: string, context: ComposerContext): boolean {
  if (context.type === "file") return !context.inlineText || fileReferenceOccurrences(text, [context]).length > 0;
  return context.type !== "assistant" || !context.contextId || collectComposerContextReferences(text).some((reference) => reference.kind === "assistant-quote" && reference.contextId === context.contextId);
}
export function removeContextReference(text: string, context: ComposerContext): string {
  if (context.type === "file" && context.inlineText) {
    for (const match of fileReferenceOccurrences(text, [context]).reverse()) text = text.slice(0, match.start) + text.slice(match.end);
    return text;
  }
  return context.type === "assistant" && context.contextId ? replaceComposerContextReferences(text, (reference) => reference.kind === "assistant-quote" && reference.contextId === context.contextId ? "" : reference.source) : text;
}

export function fileReferenceLabel(reference: FileReference): string {
  const { start, end } = reference.range;
  const lastLine = end.column === 1 && end.line > start.line ? end.line - 1 : end.line;
  return `${reference.label}:${start.line}${lastLine > start.line ? `-${lastLine}` : ""}`;
}
export function fileReferenceOccurrences(text: string, contexts: ReadonlyArray<ComposerContext>) {
  const protectedRanges = [...collectComposerContextReferences(text), ...collectAssistantCitations(text)];
  const matches: Array<{ start: number; end: number; context: FileReference }> = [];
  for (const context of contexts) {
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
  const { start, end } = reference.range;
  const uniqueLabel = collision ? `${reference.path}:${start.line}:${start.column}-${end.line}:${end.column}` : label;
  const existing = contexts.find(item => sameRange(item) && item.type === "file" && item.inlineText) as FileReference | undefined;
  const inlineText = existing?.inlineText ?? `@${/[\s"\\]/.test(uniqueLabel) ? JSON.stringify(uniqueLabel) : uniqueLabel}`;
  const context = { ...reference, inlineText };
  const prefix = selection.start > 0 && !/\s/.test(text[Math.min(text.length, selection.start) - 1] ?? "") ? " " : "";
  const inserted = insertComposerReferenceText(text, `${prefix}${inlineText} `, selection);
  return { ...inserted, contexts: [...contexts.filter(item => !sameRange(item)), context] };
}
function fileReferenceLink(context: FileReference): string {
  const title = fileReferenceLabel(context).replace(/[\\[\]]/g, "\\$&");
  const lastLine = context.range.end.column === 1 && context.range.end.line > context.range.start.line ? context.range.end.line - 1 : context.range.end.line;
  const range = `#L${context.range.start.line}${lastLine > context.range.start.line ? `-L${lastLine}` : ""}`;
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
    if (context.type === "assistant") {
      if (context.contextId && !used.has(context.contextId)) return "";
      const link = serializeAssistantCitation(context.citation);
      // Retain T3's clickable source and readable quote/comment for every provider/server version.
      return `${context.contextId ? "" : link}${renderAssistantCitationsAsText(link)}`;
    }
    if (context.inlineText && !usedFiles.has(context)) return "";
    const { start, end } = context.range;
    const selection = context.text ? `Selected range: ${start.line}:${start.column}–${end.line}:${end.column} (end exclusive). Snapshot from the editor, including unsaved changes.` : "File reference from the editor.";
    const fence = "`".repeat(Math.max(3, ...[...context.text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
    return `${fileReferenceLink(context)}\n${selection}${context.text ? `\n${fence}\n${context.text}\n${fence}` : ""}`;
  })].filter(Boolean).join("\n\n");
}
