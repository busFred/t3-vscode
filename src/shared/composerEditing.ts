import type { TextSelection } from "./composerAttachments.js";

export interface MarkdownEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly selection: TextSelection;
}
export type MarkdownFormat = "bold" | "italic" | "underline" | "strike" | "code" | "fence" | "link" | "bullet" | "number" | "task" | "quote";

function selectionIn(text: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(text.length, selection.start));
  return { start, end: Math.max(start, Math.min(text.length, selection.end)) };
}
function insert(start: number, end: number, text: string, selection: TextSelection = { start: start + text.length, end: start + text.length }): MarkdownEdit {
  return { start, end, text, selection };
}
function lineStart(text: string, position: number): number { return position <= 0 ? 0 : text.lastIndexOf("\n", position - 1) + 1; }
function linesAt(text: string, selection: TextSelection) {
  const start = lineStart(text, selection.start);
  const last = selection.end > selection.start && text[selection.end - 1] === "\n" ? selection.end - 1 : selection.end;
  const newline = text.indexOf("\n", last);
  const end = newline < 0 ? text.length : newline;
  return { start, end, lines: text.slice(start, end).split("\n") };
}
function fenceStates(lines: ReadonlyArray<string>): boolean[] {
  let fence: { character: string; length: number } | undefined;
  let math: "$$" | "\\[" | undefined;
  const states: boolean[] = [];
  for (const line of lines) {
    states.push(fence !== undefined || math !== undefined);
    const trimmed = line.trim();
    if (!fence && (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]")) {
      if (math && (trimmed === math || math === "\\[" && trimmed === "\\]")) math = undefined;
      else if (trimmed !== "\\]") math = trimmed as "$$" | "\\[";
      continue;
    }
    if (math) continue;
    const match = /^[ \t]*(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const marker = match[1]!;
    if (fence) { if (marker[0] === fence.character && marker.length >= fence.length && !match[2]!.trim()) fence = undefined; }
    else if (marker[0] !== "`" || !match[2]!.includes("`")) fence = { character: marker[0]!, length: marker.length };
  }
  states.push(fence !== undefined || math !== undefined);
  return states;
}
function inFence(text: string, before: number): boolean { return fenceStates(text.slice(0, before).split("\n")).at(-1)!; }
function listLine(line: string) {
  if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) return null;
  const match = /^([ \t]*)(?:(\d{1,9})([.)])|([-+*]))([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/.exec(line);
  if (!match) return null;
  return { indent: match[1]!, number: match[2], delimiter: match[3], bullet: match[4], task: !!match[6], body: match[7]!, prefixLength: line.length - match[7]!.length };
}

/** Return null to let the textarea insert an ordinary newline, including inside code fences. */
export function continueMarkdownList(text: string, selection: TextSelection): MarkdownEdit | null {
  const range = selectionIn(text, selection), start = lineStart(text, range.start);
  if (inFence(text, start)) return null;
  const prefix = text.slice(start, range.start), list = listLine(prefix);
  if (!list) return null;
  const end = text.indexOf("\n", range.end), suffix = text.slice(range.end, end < 0 ? text.length : end);
  if (!list.body.trim() && !suffix.trim() && range.start === range.end) return insert(start, range.start, "");
  const marker = list.number === undefined ? list.bullet : `${Number(list.number) + 1}${list.delimiter}`;
  return insert(range.start, range.end, `\n${list.indent}${marker} ${list.task ? "[ ] " : ""}`);
}

const columns = (whitespace: string) => [...whitespace].reduce((column, character) => character === "\t" ? column + 4 - column % 4 : column + 1, 0);
/** Tab remains focus navigation outside lists, fenced code and multiline selections. */
export function indentMarkdown(text: string, selection: TextSelection, outdent = false, explicit = false): MarkdownEdit | null {
  const range = selectionIn(text, selection), block = linesAt(text, range);
  const first = block.lines[0]!, list = listLine(first);
  if (!explicit && !list && !inFence(text, block.start) && !text.slice(range.start, range.end).includes("\n")) return null;
  const currentIndent = columns(/^[ \t]*/.exec(first)![0]);
  let step = 4;
  if (list) {
    // Nest under the preceding item's content; this also handles wide ordered markers (100.).
    for (const line of text.slice(0, block.start).split("\n").reverse()) {
      if (!line.trim()) continue;
      const previous = listLine(line);
      if (!previous) break;
      const parentIndent = columns(previous.indent);
      if (outdent ? parentIndent < currentIndent : parentIndent <= currentIndent) {
        step = outdent ? currentIndent - parentIndent : Math.max(1, columns(line.slice(0, previous.prefixLength - (previous.task ? 4 : 0))) - currentIndent);
        break;
      }
    }
  }
  const changed = block.lines.map(line => {
    if (!outdent) return " ".repeat(step) + line;
    let count = 0, index = 0;
    while (index < line.length && count < step && /[ \t]/.test(line[index]!)) { count += line[index] === "\t" ? 4 - count % 4 : 1; index++; }
    return line.slice(index);
  });
  const replacement = changed.join("\n");
  if (range.start === range.end) {
    const shift = changed[0]!.length - first.length, cursor = Math.max(block.start, range.start + shift);
    return insert(block.start, block.end, replacement, { start: cursor, end: cursor });
  }
  return insert(block.start, block.end, replacement, { start: block.start, end: block.start + replacement.length });
}

/** Formatting selections must not split an attachment, citation or editor-reference token. */
export function protectMarkdownSelection(text: string, selection: TextSelection, references: ReadonlyArray<TextSelection>): TextSelection {
  let { start, end } = selectionIn(text, selection);
  if (start === end) {
    const reference = references.find(ref => ref.start < start && start < ref.end);
    if (reference) start = end = reference.end;
  } else for (const ref of references) {
    if (ref.start < start && start < ref.end) start = ref.start;
    if (ref.start < end && end < ref.end) end = ref.end;
  }
  return { start, end };
}

export function formatMarkdown(text: string, selection: TextSelection, format: MarkdownFormat): MarkdownEdit {
  const { start, end } = selectionIn(text, selection), selected = text.slice(start, end);
  if (["bullet", "number", "task", "quote"].includes(format)) {
    const block = linesAt(text, { start, end });
    const replacement = block.lines.map((line, index) => {
      const indent = /^[ \t]*/.exec(line)![0], body = line.slice(indent.length);
      const prefix = format === "number" ? `${index + 1}. ` : format === "task" ? "- [ ] " : format === "quote" ? "> " : "- ";
      return indent + prefix + body;
    }).join("\n");
    return insert(block.start, block.end, replacement, { start: block.start, end: block.start + replacement.length });
  }
  if (format === "link") {
    const label = selected || "text", result = `[${label}](url)`, url = start + label.length + 3;
    return insert(start, end, result, { start: url, end: url + 3 });
  }
  if (format === "fence") {
    const body = selected || "code", fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(match => match[0].length + 1)));
    const before = start > 0 && text[start - 1] !== "\n" ? "\n" : "", after = end < text.length && text[end] !== "\n" ? "\n" : "";
    const prefix = `${before}${fence}\n`, result = `${prefix}${body}\n${fence}${after}`;
    return insert(start, end, result, { start: start + prefix.length, end: start + prefix.length + body.length });
  }
  if (format === "underline") {
    if (selected && text.slice(start - 3, start) === "<u>" && text.slice(end, end + 4) === "</u>") return insert(start - 3, end + 4, selected, { start: start - 3, end: end - 3 });
    const body = selected || "text";
    return insert(start, end, `<u>${body}</u>`, { start: start + 3, end: start + 3 + body.length });
  }
  const marker = format === "bold" ? "**" : format === "italic" ? "*" : format === "strike" ? "~~" : "`".repeat(Math.max(1, ...[...selected.matchAll(/`+/g)].map(match => match[0].length + 1)));
  if (selected && text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker) {
    return insert(start - marker.length, end + marker.length, selected, { start: start - marker.length, end: end - marker.length });
  }
  const body = selected || (format === "code" ? "code" : "text");
  const padding = format === "code" && (/^`|`$/.test(body) || /^ .* $/.test(body)) ? " " : "";
  const prefix = marker + padding;
  return insert(start, end, prefix + body + padding + marker, { start: start + prefix.length, end: start + prefix.length + body.length });
}

/** Ordinary punctuation still replaces the selection; only explicit pairs surround it. */
export function wrapMarkdownSelection(text: string, selection: TextSelection, character: string): MarkdownEdit | null {
  const pairs: Record<string, string> = { '"': '"', "'": "'", "`": "`", "(": ")", "[": "]", "{": "}", "$": "$" };
  const closing = pairs[character], { start, end } = selectionIn(text, selection);
  if (!closing || start === end) return null;
  return insert(start, end, character + text.slice(start, end) + closing, { start: start + 1, end: end + 1 });
}

/** Paste, undo and ordinary typing retain their source; only structural edits trigger numbering. */
export function changesListStructure(before: string, after: string, inputType: string): boolean {
  if (/paste|drop|history|composition/i.test(inputType)) return false;
  let start = 0, oldEnd = before.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return before.slice(start, oldEnd).includes("\n") || after.slice(start, newEnd).includes("\n");
}

/** Repair the edited list while retaining the start and delimiter of each nested sequence. */
export function renumberMarkdownList(text: string, selection: TextSelection): MarkdownEdit | null {
  const range = selectionIn(text, selection), lines = text.split("\n");
  const offsets: number[] = []; let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  let at = text.slice(0, range.start).split("\n").length - 1;
  const protectedLines = fenceStates(lines);
  if (protectedLines[at]) return null;
  if (!listLine(lines[at]!)) {
    if (lines[at]!.trim()) return null;
    if (at > 0 && listLine(lines[at - 1]!)) at--;
    else if (at + 1 < lines.length && listLine(lines[at + 1]!)) at++;
    else return null;
  }
  const belongs = (index: number) => !protectedLines[index] && (!!listLine(lines[index]!) || !lines[index]!.trim() || /^[ \t]+\S/.test(lines[index]!));
  let first = at, last = at;
  while (first > 0 && belongs(first - 1)) first--;
  while (last + 1 < lines.length && belongs(last + 1)) last++;
  const counters = new Map<number, { number: number; delimiter: string }>();
  const edits: Array<{ start: number; end: number; value: string }> = [];
  for (let index = first; index <= last; index++) {
    const item = listLine(lines[index]!); if (!item) continue;
    const depth = columns(item.indent);
    for (const key of counters.keys()) if (key > depth) counters.delete(key);
    if (item.number === undefined) { counters.delete(depth); continue; }
    const previous = counters.get(depth), number = previous && previous.delimiter === item.delimiter ? previous.number + 1 : Number(item.number);
    counters.set(depth, { number, delimiter: item.delimiter! });
    if (String(number) !== item.number) edits.push({ start: offsets[index]! + item.indent.length, end: offsets[index]! + item.indent.length + item.number.length, value: String(number) });
  }
  if (!edits.length) return null;
  const start = edits[0]!.start, end = edits.at(-1)!.end;
  const parts: string[] = []; let cursor = start;
  for (const edit of edits) { parts.push(text.slice(cursor, edit.start), edit.value); cursor = edit.end; }
  parts.push(text.slice(cursor, end)); const replacement = parts.join("");
  const move = (position: number) => edits.reduce((next, edit) => next + (edit.end <= position ? edit.value.length - (edit.end - edit.start) : 0), position);
  return insert(start, end, replacement, { start: move(range.start), end: move(range.end) });
}
