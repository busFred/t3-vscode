import { ComposerContextId, type AssistantCitation } from "@t3tools/contracts";
import { renderAssistantCitationsAsText, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
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
  return context.type !== "assistant" || !context.contextId || collectComposerContextReferences(text).some((reference) => reference.kind === "assistant-quote" && reference.contextId === context.contextId);
}
export function removeContextReference(text: string, context: ComposerContext): string {
  return context.type === "assistant" && context.contextId ? replaceComposerContextReferences(text, (reference) => reference.kind === "assistant-quote" && reference.contextId === context.contextId ? "" : reference.source) : text;
}

export function fileReferenceLabel(reference: FileReference): string {
  const { start, end } = reference.range;
  const lastLine = end.column === 1 && end.line > start.line ? end.line - 1 : end.line;
  return `${reference.label}:${start.line}${lastLine > start.line ? `-${lastLine}` : ""}`;
}
export function formatComposerMessage(text: string, contexts: ReadonlyArray<ComposerContext>): string {
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
    const { start, end } = context.range;
    const title = fileReferenceLabel(context).replace(/[\\[\]]/g, "\\$&");
    const href = `${context.uri}#L${start.line}`.replace(/[()]/g, (character) => encodeURIComponent(character));
    const selection = context.text ? `Selected range: ${start.line}:${start.column}–${end.line}:${end.column} (end exclusive). Snapshot from the editor, including unsaved changes.` : "File reference from the editor.";
    const fence = "`".repeat(Math.max(3, ...[...context.text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
    return `[${title}](${href})\n${selection}${context.text ? `\n${fence}\n${context.text}\n${fence}` : ""}`;
  })].filter(Boolean).join("\n\n");
}
