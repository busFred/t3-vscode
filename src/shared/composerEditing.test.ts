import assert from "node:assert/strict";
import test from "node:test";
import { changesListStructure, renumberMarkdownList, wrapMarkdownSelection, continueMarkdownList, formatMarkdown, indentMarkdown, protectMarkdownSelection, type MarkdownEdit } from "./composerEditing.js";

const cursor = (text: string) => ({ start: text.length, end: text.length });
const apply = (text: string, edit: MarkdownEdit | null) => { assert.ok(edit); return text.slice(0, edit.start) + edit.text + text.slice(edit.end); };

test("Newline continues ordered, bulleted and task lists without changing existing source", () => {
  for (const [text, expected] of [["9. ninth", "9. ninth\n10. "], ["2) second", "2) second\n3) "], ["  * nested", "  * nested\n  * "], ["- [x] done", "- [x] done\n- [ ] "], ["+ item", "+ item\n+ "]]) {
    assert.equal(apply(text!, continueMarkdownList(text!, cursor(text!))), expected);
  }
  assert.equal(apply("1. first\n2. ", continueMarkdownList("1. first\n2. ", { start: 12, end: 12 })), "1. first\n");
});

test("List assistance ignores prose, escaped markers, quotes, thematic breaks and code fences", () => {
  for (const text of ["plain", "\\1. literal", "> 1. quoted example", "---", "- - -", "```python\n1. literal", "~~~~\n1. literal", "````\n```\n1. literal"]) {
    assert.equal(continueMarkdownList(text, cursor(text)), null, text);
  }
  const closed = "```\n1. literal\n```\n1. real";
  assert.equal(apply(closed, continueMarkdownList(closed, cursor(closed))), closed + "\n2. ");
});

test("List continuation splits a line or replaces selected text without losing its suffix", () => {
  assert.equal(apply("1. first second", continueMarkdownList("1. first second", { start: 8, end: 9 })), "1. first\n2. second");
  assert.equal(continueMarkdownList("1. item", { start: 1, end: 1 }), null);
});

test("Indent/outdent uses the parent marker width, retains selection and excludes the next unselected line", () => {
  const source = "100. parent\n101. child\nlast";
  const edit = indentMarkdown(source, { start: 12, end: 21 });
  const indented = apply(source, edit);
  assert.equal(indented, "100. parent\n     101. child\nlast");
  assert.equal(apply(indented, indentMarkdown(indented, edit!.selection, true)), source);
  const selected = "one\ntwo\nthree";
  assert.equal(apply(selected, indentMarkdown(selected, { start: 0, end: 8 })), "    one\n    two\nthree");
});

test("Tab leaves plain-text focus traversal available and supports code indentation", () => {
  assert.equal(indentMarkdown("plain text", { start: 3, end: 3 }), null);
  const code = "```ts\nconst x = 1;";
  assert.equal(apply(code, indentMarkdown(code, cursor(code))), "```ts\n    const x = 1;");
  assert.equal(apply("\ntext", indentMarkdown("\ntext", { start: 0, end: 0 }, false, true)), "    \ntext");
});

test("Inline formatting and links remain editable Markdown, including embedded backticks", () => {
  assert.equal(apply("hello", formatMarkdown("hello", { start: 0, end: 5 }, "bold")), "**hello**");
  assert.equal(apply("**hello**", formatMarkdown("**hello**", { start: 2, end: 7 }, "bold")), "hello");
  assert.equal(apply("a`b", formatMarkdown("a`b", { start: 0, end: 3 }, "code")), "``a`b``");
  const link = formatMarkdown("paper", { start: 0, end: 5 }, "link");
  const text = apply("paper", link);
  assert.equal(text, "[paper](url)"); assert.equal(text.slice(link.selection.start, link.selection.end), "url");
  const fenced = formatMarkdown("a```b", { start: 0, end: 5 }, "fence");
  assert.equal(apply("a```b", fenced), "````\na```b\n````");
});

test("Formatting expands partial reference selections and moves an empty caret outside tokens", () => {
  const source = "before [image](t3-context:test) after", reference = { start: 7, end: 31 };
  assert.deepEqual(protectMarkdownSelection(source, { start: 10, end: 17 }, [reference]), reference);
  assert.deepEqual(protectMarkdownSelection(source, { start: 15, end: 15 }, [reference]), { start: 31, end: 31 });
  assert.equal(apply(source, formatMarkdown(source, reference, "bold")), "before **[image](t3-context:test)** after");
});


test("Selections wrap with explicit pairs while punctuation and unselected typing remain literal", () => {
  for (const [open, close] of [["\"", "\""], ["'", "'"], ["`", "`"], ["$", "$"], ["(", ")"], ["[", "]"], ["{", "}"]]) {
    assert.equal(apply("term", wrapMarkdownSelection("term", { start: 0, end: 4 }, open!)), `${open}term${close}`);
  }
  for (const char of [":", ";", "x"]) assert.equal(wrapMarkdownSelection("term", { start: 0, end: 4 }, char), null);
  assert.equal(wrapMarkdownSelection("term", { start: 4, end: 4 }, "$"), null);
  assert.equal(apply("term", formatMarkdown("term", { start: 0, end: 4 }, "underline")), "<u>term</u>");
});

test("Numbering repairs nested sequences after structural edits, retaining starting values and prose", () => {
  const text = "Intro\n4. first\n5. inserted\n5. second\n   7) child\n   7) child two\n6. third\n\nSeparate prose";
  assert.equal(apply(text, renumberMarkdownList(text, { start: 25, end: 25 })), "Intro\n4. first\n5. inserted\n6. second\n   7) child\n   8) child two\n7. third\n\nSeparate prose");
  assert.equal(renumberMarkdownList("```\n1. a\n1. b\n```", { start: 10, end: 10 }), null);
  assert.equal(renumberMarkdownList("$$\n1. a\n1. b\n$$", { start: 10, end: 10 }), null);
  assert.equal(continueMarkdownList("$$\n1. math", cursor("$$\n1. math")), null);
  assert.equal(changesListStructure("1. a", "1. a\n2. b", "insertFromPaste"), false);
  assert.equal(changesListStructure("1. a\n2. b", "1. a", "historyUndo"), false);
  assert.equal(changesListStructure("1. a\n2. b", "1. a2. b", "deleteContentBackward"), true);
  assert.equal(changesListStructure("1. a", "1. ab", "insertText"), false);
});
