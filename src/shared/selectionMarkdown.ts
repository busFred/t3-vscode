/** Pure helpers for selectionMarkdown.ts; split out so they can be unit tested without a DOM. */

/** `#`, `-`, `+` and `N.` only matter at the start of a markdown line, where they would read as a heading, list item or ordered list marker. */
function escapeLineStartMarkers(line: string): string {
  return line
    .replace(/^([ \t]{0,3})(#{1,6})(?=[ \t]|$)/, "$1\\$2")
    .replace(/^([ \t]{0,3})([-+])(?=[ \t]|$)/, "$1\\$2")
    .replace(/^([ \t]{0,3})(\d+)\.(?=[ \t]|$)/, "$1$2\\.");
}

/**
 * Escapes only characters that change markdown meaning. `\`, backtick, `*`, `_`, `~`, `[`, `]`, `<` and `>`
 * always do; `#`, `-`, `+` and `N.` only do at a line start, so an ordinary sentence with a period, hyphen
 * or number is left untouched. `escapePipe` is opt-in because `|` only matters inside a table cell.
 */
export function escapeMarkdownText(text: string, atLineStart: boolean, escapePipe = false): string {
  const pattern = escapePipe ? /[\\`*_~[\]<>|]/g : /[\\`*_~[\]<>]/g;
  const escaped = text.replace(pattern, "\\$&");
  if (escaped === "") return escaped;
  return escaped.split("\n").map((line, index) => (index === 0 && !atLineStart) ? line : escapeLineStartMarkers(line)).join("\n");
}

/** Block separators compound (a paragraph's trailing blank plus the next block's leading newline); flatten the result to at most one blank line. */
export function collapseBlankLines(markdown: string): string {
  return markdown.replace(/\n{3,}/g, "\n\n");
}
