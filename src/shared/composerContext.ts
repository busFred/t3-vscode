import type { AssistantCitation } from "@t3tools/contracts";
import { renderAssistantCitationsAsText, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";

export interface FileReference {
  readonly type: "file";
  readonly uri: string;
  readonly path: string;
  readonly label: string;
  /** One-based positions; the end is exclusive, as in VS Code selections. */
  readonly range: { readonly start: { readonly line: number; readonly column: number }; readonly end: { readonly line: number; readonly column: number } };
  readonly text: string;
}
export type ComposerContext = FileReference | { readonly type: "assistant"; readonly citation: AssistantCitation };
export interface InsertReferenceEvent { readonly draftKey: string; readonly reference: FileReference }

export function fileReferenceLabel(reference: FileReference): string {
  const { start, end } = reference.range;
  const lastLine = end.column === 1 && end.line > start.line ? end.line - 1 : end.line;
  return `${reference.label}:${start.line}${lastLine > start.line ? `-${lastLine}` : ""}`;
}
export function formatComposerMessage(text: string, contexts: ReadonlyArray<ComposerContext>): string {
  return [text.trim(), ...contexts.map((context) => {
    if (context.type === "assistant") {
      const link = serializeAssistantCitation(context.citation);
      // Retain T3's clickable source and readable quote/comment for every provider/server version.
      return `${link}${renderAssistantCitationsAsText(link)}`;
    }
    const { start, end } = context.range;
    const title = fileReferenceLabel(context).replace(/[\\[\]]/g, "\\$&");
    const href = `${context.uri}#L${start.line}`.replace(/[()]/g, (character) => encodeURIComponent(character));
    const selection = context.text ? `Selected range: ${start.line}:${start.column}–${end.line}:${end.column} (end exclusive). Snapshot from the editor, including unsaved changes.` : "File reference from the editor.";
    const fence = "`".repeat(Math.max(3, ...[...context.text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
    return `[${title}](${href})\n${selection}${context.text ? `\n${fence}\n${context.text}\n${fence}` : ""}`;
  })].filter(Boolean).join("\n\n");
}
