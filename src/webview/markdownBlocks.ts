/**
 * Conservative top-level boundaries. Document-wide references keep the whole text together; from the first
 * container, HTML or inline display math onwards the rest stays one tail block, so earlier blocks (and their
 * keys, which hold mounted media and diagrams) are unchanged while a reply streams.
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (/^ {0,3}\[[^\]]+\]:/m.test(text) || /\[\^/.test(text)) return [text];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const blocks: string[] = []; let block = "", fence = "", math = 0, tail = false;
  for (const line of lines) {
    const content = line.replace(/\r?\n$/, "");
    if (tail) { block += line; continue; }
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(content)) fence = "";
    } else if (math) {
      if (new RegExp("^ {0,3}\\${" + math + ",}[ \\t]*$").test(content)) math = 0;
    } else {
      // Lists, quotes, indented code and HTML can span blank lines or change later block interpretation.
      if (/^(?: {0,3}(?:>|[-+*](?:\s|$)|\d+[.)](?:\s|$))| {4}|\t)/.test(content) || /<[!/?a-z]/i.test(content)) { tail = true; block += line; continue; }
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(content)?.[1];
      if (marker) { if (marker[0] === "`" && content.slice(content.indexOf(marker) + marker.length).includes("`")) { tail = true; block += line; continue; } fence = marker; }
      else { if (content.includes("$$") && !/^ {0,3}\${2,}\s*$/.test(content)) { tail = true; block += line; continue; } const dollars = /^ {0,3}(\${2,})\s*$/.exec(content)?.[1]; if (dollars) math = dollars.length; }
    }
    block += line;
    if (!fence && !math && !content.trim() && block.trim()) { blocks.push(block); block = ""; }
  }
  if (block.trim()) blocks.push(block);
  else if (block && blocks.length) blocks[blocks.length - 1] += block;
  return blocks.length ? blocks : [text];
}
