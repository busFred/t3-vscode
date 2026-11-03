import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import { splitMarkdownBlocks } from "./markdownBlocks";

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { children: text, remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeRaw] }));
test("completed markdown prefixes retain their text while the last block streams", () => {
  const prefix = "# Heading\n\nFirst paragraph.\n\n";
  assert.deepEqual(splitMarkdownBlocks(prefix + "Next"), ["# Heading\n\n", "First paragraph.\n\n", "Next"]);
  assert.deepEqual(splitMarkdownBlocks(prefix + "Next growing").slice(0, -1), splitMarkdownBlocks(prefix + "Next").slice(0, -1));
});
test("fenced code and display math are never split internally, including unfinished blocks", () => {
  for (const delimiter of ["```", "~~~~", "$$", "$$$"]) {
    const block = `${delimiter}\nfirst\n\nsecond\n${delimiter}\n\n`;
    assert.deepEqual(splitMarkdownBlocks(`Before\n\n${block}After`), ["Before\n\n", block, "After"]);
    assert.deepEqual(splitMarkdownBlocks(`Before\n\n${delimiter}\nfirst\n\nsecond`), ["Before\n\n", `${delimiter}\nfirst\n\nsecond`]);
  }
});
test("references, footnotes, HTML and ambiguous containers retain document scope", () => {
  for (const text of ["[link][id]\n\n[id]: /url", "note[^1]\n\n[^1]: body", "<div>\n\na\n\n</div>", "- first\n\n- second", "-\n\n  content", "1.\n\n   content", "> quote\n\n> more", "    code\n\n    more", "$$x\n\ny\n$$"]) assert.deepEqual(splitMarkdownBlocks(text), [text]);
});
test("splitting preserves source and rendered block semantics", () => {
  for (const text of ["", "\n\n", "Hello\n\n\n", "Hello\n\nWorld", "# Heading\n\n**Bold** and $x$.\n\n---\n\nEnd", "One\r\n\r\nTwo", "A\n\n```js\nconst a = 1;\n\n```\n\nB", "A\n\n$$\nx + y\n\n= z\n$$\n\nB", "A\n\n|a|b|\n|-|-|\n|1|2|\n\nB", "A\n\n```mermaid\ngraph TD\n```\n\n- one\n\n- two\n\nC", "A\n\n> quote\n\n> more\n\nB", "A\n\n<div>\n\nx\n\n</div>\n\nB", "A\n\nsee $$x$$ here\n\nB"]) {
    const blocks = splitMarkdownBlocks(text); assert.equal(blocks.join(""), text);
    assert.equal(blocks.map(render).join("\n"), render(text));
  }
});

test("a later list, quote, HTML or inline math keeps earlier blocks and only merges the tail", () => {
  const prefix = "Intro\n\n```mermaid\ngraph TD\n```\n\n";
  const before = splitMarkdownBlocks(prefix + "More text");
  for (const tail of ["-", "- item\n\n- next", "1.", "> quote\n\nafter", "<div>\n\nx", "see $$x$$\n\nafter"]) {
    const blocks = splitMarkdownBlocks(prefix + tail);
    assert.deepEqual(blocks.slice(0, -1), before.slice(0, -1));
    assert.equal(blocks.at(-1), tail);
  }
});
