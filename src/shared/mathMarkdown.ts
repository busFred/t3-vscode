/** Accept the usual LaTeX delimiters too, without modifying code or escapes. */
export function normalizeMathMarkdown(text: string): string {
  let output = ""; let offset = 0;
  while (offset < text.length) {
    const char = text[offset]!;
    if (char === "`" || (char === "~" && text.slice(offset, offset + 3) === "~~~")) {
      const marker = /^[`~]+/.exec(text.slice(offset))![0];
      const start = offset; const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
      const fenced = marker.length >= 3 && /^ {0,3}$/.test(text.slice(lineStart, offset));
      let end = offset + marker.length;
      if (fenced) {
        const closing = new RegExp(`^ {0,3}${char === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`, "m").exec(text.slice(end));
        end = closing ? end + closing.index + closing[0].length : text.length;
      } else {
        const closing = text.indexOf(marker, end); end = closing < 0 ? text.length : closing + marker.length;
      }
      output += text.slice(start, end); offset = end; continue;
    }
    if (char === "\\" && text[offset + 1] === "\\") { output += "\\\\"; offset += 2; continue; }
    if (char === "\\" && (text[offset + 1] === "(" || text[offset + 1] === "[")) {
      const block = text[offset + 1] === "["; const closing = text.indexOf(block ? "\\]" : "\\)", offset + 2);
      if (closing >= 0) {
        const content = text.slice(offset + 2, closing);
        const delimiter = block ? "$$" : "$";
        output += block ? `\n${delimiter}\n${content.trim()}\n${delimiter}\n` : `${delimiter}${content}${delimiter}`;
        offset = closing + 2; continue;
      }
    }
    output += char; offset++;
  }
  return output;
}
