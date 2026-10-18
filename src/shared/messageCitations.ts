/** Keep existing assistant links compatible while preserving user authorship in local quotes. */
import { ASSISTANT_CITATION_MAX_TEXT_LENGTH, ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation as ContractCitation } from "@t3tools/contracts";
import { formatAssistantCitationHref, parseAssistantCitationHref as parseBase, withAssistantCitationComment as withComment } from "@t3tools/shared/assistantCitations";
const MAX_HREF_LENGTH = 9 * (ASSISTANT_CITATION_MAX_TEXT_LENGTH + ASSISTANT_CITATION_MAX_COMMENT_LENGTH) + 16_000 + "&author=user".length;
const CITATION_LINK = new RegExp(String.raw`\[(?:Assistant|User) quote\]\((t3-citation:\/\/v1\/[^\s)]{1,${MAX_HREF_LENGTH}})\)`, "g");
export type AssistantCitation = ContractCitation & { readonly author?: "user" };
export function withAssistantCitationComment(citation: AssistantCitation, comment: string): AssistantCitation {
  return { ...withComment(citation, comment), ...(citation.author === "user" ? { author: "user" } : {}) };
}
export function parseAssistantCitationHref(href: string): AssistantCitation | null {
  if (!href.startsWith("t3-citation://v1/") || href.length > MAX_HREF_LENGTH) return null;
  try {
    const url = new URL(href);
    const authors = url.searchParams.getAll("author");
    if (authors.length && (authors.length !== 1 || authors[0] !== "user")) return null;
    url.searchParams.delete("author");
    const citation = parseBase(authors.length ? url.href : href);
    return citation ? { ...citation, ...(authors.length ? { author: "user" as const } : {}) } : null;
  } catch { return null; }
}
export function serializeAssistantCitation(citation: AssistantCitation): string {
  const user = citation.author === "user";
  return `[${user ? "User" : "Assistant"} quote](${formatAssistantCitationHref(citation)}${user ? "&author=user" : ""})`;
}
export function collectAssistantCitations(text: string) {
  const results: { citation: AssistantCitation; source: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(CITATION_LINK)) {
    const citation = parseAssistantCitationHref(match[1]!);
    if (citation) results.push({ citation, source: match[0], start: match.index, end: match.index + match[0].length });
  }
  return results;
}
export function assistantCitationsToPlainText(text: string): string {
  for (const match of collectAssistantCitations(text).reverse()) {
    const { citation, start, end } = match;
    text = text.slice(0, start) + citation.text + (citation.comment === undefined ? "" : `\nComment: ${citation.comment}`) + text.slice(end);
  }
  return text;
}
