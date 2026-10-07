/** Capture the real development extension with prepared, non-private demo content. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function captureReadme({ home, workbench, sidebar, findWebview, runCommand }) {
  const fixture = JSON.parse(await readFile(join(home, 'readme-fixture.json'), 'utf8'));
  assert.equal(fixture.home, home);
  const output = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
  await mkdir(output, { recursive: true });
  if (await workbench.locator('.part.auxiliarybar').isVisible()) await runCommand('View: Hide Secondary Side Bar');
  await sidebar.wait('document.querySelector(".dedicated-sessions")');
  assert.equal(await sidebar.evaluate('document.querySelector(".account-usage").open'), false);
  const open = async (key, condition) => {
    const id = fixture.threads[key];
    await sidebar.wait(`document.querySelector('.thread[data-thread-id="${id}"]')`);
    await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${id}"]').click()`);
    const view = await findWebview('panel');
    await view.wait(`document.querySelector('.chat-main')?.dataset.threadId === '${id}' && (${condition})`);
    return view;
  };
  const capture = async (view, filename) => {
    await view.evaluate('document.fonts.ready');
    await workbench.mouse.move(8, 30);
    // Let native layout, lazy graphics and fonts settle before taking the actual window image.
    await view.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await workbench.screenshot({ path: join(output, filename) });
  };
  const math = await open('math', 'document.querySelectorAll(".katex-display").length === 2');
  await math.wait('document.fonts.check("16px KaTeX_Main") && document.fonts.check("16px KaTeX_Math")');
  assert.equal(await math.evaluate('document.querySelectorAll(".katex-error").length'), 0);
  await math.evaluate('document.querySelector(".transcript-list").scrollTop=0');
  await capture(math, 'math-and-sessions.png');

  const visuals = await open('visuals', 'document.querySelector(".mermaid-svg svg") && document.querySelector(".html-visual-frame")');
  await visuals.evaluate('document.querySelector(".transcript-list").scrollTop=0');
  await capture(visuals, 'diagrams-and-graphics.png');

  const settingsFile = join(home, 'workspace/.vscode/settings.json');
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  await writeFile(settingsFile, JSON.stringify({ ...settings, 'workbench.colorTheme': 'Default Light Modern' }));
  const review = await open('review', 'document.querySelector(".work-group-toggle") && document.querySelector("[data-assistant-citation-source]")');
  await review.wait('document.body.classList.contains("vscode-light")');
  assert.equal(await review.evaluate('document.querySelector(".work-group-toggle").getAttribute("aria-expanded")'), 'false');
  await review.evaluate(`(() => {
    const input=document.querySelector('textarea[aria-label="Message"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'About this:  Could you expand on it?');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await review.wait('document.querySelector("textarea[aria-label=Message]").value === "About this:  Could you expand on it?"');
  await review.evaluate('document.querySelector("textarea[aria-label=Message]").focus()');
  await workbench.keyboard.press('Control+Home');
  for (let index = 0; index < 12; index++) await workbench.keyboard.press('ArrowRight');
  assert.equal(await review.evaluate('document.querySelector("textarea[aria-label=Message]").selectionStart'), 12);
  // Like selecting transcript text with the pointer, leave the composer before moving the document selection.
  await review.evaluate('document.querySelector("textarea[aria-label=Message]").blur()');
  await review.evaluate(`(() => {
    const source=document.querySelector('[data-assistant-citation-source]');
    const walker=document.createTreeWalker(source,NodeFilter.SHOW_TEXT);let node;
    const quote='Keep the original logits for the loss calculation.';
    while(node=walker.nextNode()) {const start=node.textContent.indexOf(quote);if(start<0)continue;
      const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+quote.length);
      window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));break;}
  })()`);
  await review.wait('document.querySelector(".citation-selection-button")');
  await review.evaluate('document.querySelector(".citation-selection-button").click()');
  await review.wait('document.querySelector(".citation-comment")');
  await review.evaluate(`(() => {const input=document.querySelector('.citation-comment textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Does this also apply when using label smoothing?');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await capture(review, 'quotes-and-code.png');
  await review.evaluate('document.querySelector(".citation-comment .primary").click()');
  await review.wait('!document.querySelector(".citation-comment") && document.querySelector(".context-chip")');
  const prompt = await review.evaluate('document.querySelector("textarea[aria-label=Message]").value');
  assert.ok(prompt.startsWith('About this: [❝ Keep the original logits'));
  assert.ok(prompt.endsWith(' Could you expand on it?'));
  assert.ok(prompt.includes('t3-context://v1/assistant-quote/'));
  console.log('PASS: native README screenshots, themes, math/diagrams/HTML, collapsed commands and citation insertion at the saved composer cursor; no provider turns');
}
