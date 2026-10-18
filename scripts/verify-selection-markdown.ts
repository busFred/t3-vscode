/** Real DOM ranges and Markdown output; a disposable browser, no T3 service/provider. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import ts from "typescript";

const source = await readFile(new URL('../src/webview/selectionMarkdown.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source.replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: `${js}\nwindow.serializeSelection = selectionMarkdown;` });
  const copy = (html: string, selector?: string) => page.evaluate(({ html, selector }) => {
    const root = document.createElement('div'); root.innerHTML = html; document.body.replaceChildren(root);
    const range = document.createRange(); range.selectNodeContents(selector ? root.querySelector(selector)! : root);
    return (window as unknown as { serializeSelection: (range: Range, root: HTMLElement) => string }).serializeSelection(range, root);
  }, { html, selector });
  assert.equal(await copy('<p>A <strong>bold</strong> <em>word</em> and <a href="https://example.com">link</a>.</p>'), 'A **bold** *word* and [link](https://example.com)\\.');
  assert.equal(await copy('<p>A <strong>bold word</strong> after.</p>', 'strong'), '**bold word**');
  assert.equal(await copy('<ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>'), '- Parent\n  - Child\n- Sibling');
  assert.equal(await copy('<ol start="3"><li>Third</li><li>Fourth</li></ol>'), '3. Third\n4. Fourth');
  assert.equal(await copy('<p>*literal stars* [brackets](text)</p>'), '\\*literal stars\\* \\[brackets\\](text)');
  assert.equal(await copy('<p>1. literal list</p>'), '1\\. literal list');
  assert.equal(await copy('<p><code>*literal*</code></p>'), '`*literal*`');
  assert.equal(await copy('<div class="code-block"><div><span aria-hidden="true">js</span><button>Copy</button></div><pre><code class="language-js">const a = `value`;\n</code></pre></div>'), '```js\nconst a = `value`;\n```');
  assert.equal(await copy('<table><thead><tr><th>A | B</th></tr></thead><tbody><tr><td>C | D</td></tr></tbody></table>'), '| A \\| B |\n| --- |\n| C \\| D |');
  console.log('PASS: selection Markdown preserves partial formatting, links, nested/ordered lists, literal syntax, tables and fenced code without hidden controls.');
} finally { await browser.close(); }
