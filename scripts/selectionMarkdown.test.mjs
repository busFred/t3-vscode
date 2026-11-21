/** Copying part of a numbered list keeps the items' numbers. Needs a real browser (Range and selection), so it is skipped without CHROMIUM_PATH. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const chromiumPath = process.env.CHROMIUM_PATH;
const skip = !chromiumPath || !existsSync(chromiumPath) ? "set CHROMIUM_PATH to a Chromium binary" : false;

test("Copying items from the middle of a numbered list keeps their numbers", { skip }, async () => {
  const esbuild = createRequire(createRequire(import.meta.url).resolve("vite")).resolve("esbuild");
  const { buildSync } = createRequire(import.meta.url)(esbuild);
  const bundle = buildSync({ entryPoints: [new URL("../src/webview/selectionMarkdown.ts", import.meta.url).pathname], bundle: true, format: "iife", globalName: "T3Selection", write: false }).outputFiles[0].text;
  const browser = await chromium.launch({ executablePath: chromiumPath });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="source"><ol><li>one</li><li>two</li><li>three</li><li>four</li></ol><ol start="5"><li>five</li><li>six</li><li>seven</li></ol></div>');
    await page.addScriptTag({ content: bundle });
    const copy = (selector, from, to) => page.evaluate(({ selector, from, to }) => {
      const items = document.querySelectorAll(`${selector} li`);
      const range = document.createRange(); range.setStartBefore(items[from]); range.setEndAfter(items[to]);
      return window.T3Selection.selectionMarkdown(range, document.getElementById("source")).trim();
    }, { selector, from, to });
    assert.equal(await copy("ol:first-child", 2, 3), "3. three\n4. four");
    assert.equal(await copy("ol:first-child", 0, 1), "1. one\n2. two");
    assert.equal(await copy("ol:last-child", 1, 2), "6. six\n7. seven");
  } finally { await browser.close(); }
});
