import type { AssistantCitation } from "./messageCitations.js";
import { assistantCitationsToPlainText, collectAssistantCitations } from "./messageCitations.js";

/** Markup only. The vendored escaper also backslash-escaped punctuation, and the math normalizer then read its `\(…\)`/`\[…\]` as KaTeX. */
function neutralizeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** One line per element, comments included: the stripper compares these against the message's own lines. */
function quoteBlockLines(citation: AssistantCitation): string[] {
  const quote = neutralizeMarkup(citation.text).split("\n").map((line) => `> ${line}`);
  const comment = citation.comment === undefined ? [] : ["", ...`Comment: ${neutralizeMarkup(citation.comment)}`.split("\n")];
  return [`> ${citation.author === "user" ? "User" : "Assistant"} quote:`, ...quote, ...comment];
}
/** Readable copy of a quote for clients and providers that never expand `t3-citation:` links. */
export function renderAssistantQuoteBlock(citation: AssistantCitation): string {
  return `\n\n${quoteBlockLines(citation).join("\n")}\n\n`;
}
/** Tolerates trailing spaces and CRLF in either direction, so a transcript that normalized whitespace still matches. */
function sameLine(value: string): string {
  return value.replace(/[ \t\r]+$/, "");
}
/** The generated block is appended, so the last match is ours and an identical one the user typed earlier survives. */
function lastBlockLine(lines: ReadonlyArray<string>, block: ReadonlyArray<string>): number {
  for (let at = lines.length - block.length; at >= 0; at -= 1) {
    if (block.every((line, offset) => lines[at + offset] === line)) return at;
  }
  return -1;
}
/**
 * Drop the readable blocks a transcript already shows as citation cards. Matching is by rendered
 * content of a citation present in the same text, never by position, so an edited message keeps a
 * block we cannot attribute: a stray duplicate is survivable, deleting the user's prose is not.
 * Compared line by line rather than with a generated pattern, which a quote of a few thousand
 * short lines grew past the regular-expression size limit.
 */
export function stripRenderedAssistantQuotes(text: string): string {
  let lines = text.split("\n"); let stripped = false;
  // Longest block first, so a quote that happens to repeat another's lines cannot match inside it.
  const blocks = collectAssistantCitations(text).map(({ citation }) => quoteBlockLines(citation).map(sameLine)).sort((a, b) => b.length - a.length);
  for (const block of blocks) {
    const at = lastBlockLine(lines.map(sameLine), block);
    if (at < 0) continue;
    let start = at; let end = at + block.length;
    while (start > 0 && sameLine(lines[start - 1]!) === "") start -= 1;
    while (end < lines.length && sameLine(lines[end]!) === "") end += 1;
    lines = [...lines.slice(0, start), "", ...lines.slice(end)]; stripped = true;
  }
  return stripped ? lines.join("\n").trim() : text;
}

const CITATION_LINK = "t3-citation:";
let renderedSource = "", renderedText = "";
/**
 * What the transcript shows: the readable quote block is gone and each citation link reads as its
 * quote and comment. Strip first, flatten second — the stripper finds its blocks through the links
 * that flattening consumes. Memoized on the last message, since search asks for the same row twice.
 */
export function renderedMessageText(text: string): string {
  if (!text.includes(CITATION_LINK)) return text;
  if (text !== renderedSource) { renderedSource = text; renderedText = assistantCitationsToPlainText(stripRenderedAssistantQuotes(text)); }
  return renderedText;
}

/**
 * A quote carries runs of blank lines wherever it spans blocks: rendered markdown puts a newline
 * text node between every pair, and the capture counts each one. Collapsed here rather than at
 * capture, which is a faithful port of T3 Code's reader — diverging it stopped this client
 * resolving whole-message quotes the T3 app keeps producing.
 * Collapsed cards get one flowing paragraph, so neither of the two visible lines is spent on a
 * blank; expanded cards keep one blank line per break, and both keep code indentation.
 */
export function quoteDisplayText(text: string, expanded: boolean): string {
  if (!expanded) return text.replace(/\s+/g, " ").trim();
  return text.replace(/\n[^\S\n]*\n(?:[^\S\n]*\n)+/g, "\n\n").replace(/^(?:[^\S\n]*\n)+/, "").replace(/(?:\n[^\S\n]*)+$/, "");
}
