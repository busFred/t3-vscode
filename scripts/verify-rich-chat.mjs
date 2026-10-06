/** Focused native checks; all data and profiles belong to the caller's isolated test home. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

export async function verifyRichChat({ home, evidence, workbench, sidebar, findWebview, findVisualFrame, chooseLiveTestModel }) {
  const fixture = JSON.parse(await readFile(join(home, 'rich-chat-fixture.json'), 'utf8'));
  assert.equal(fixture.home, home);
  // ClipboardItem writes through Chromium's OS clipboard; VS Code receives a real Ctrl+V.
  const clipboardServer = createServer((_request, response) => { response.end('<!doctype html><title>Isolated clipboard verification</title>'); });
  await new Promise(resolve => clipboardServer.listen(0, '127.0.0.1', resolve));
  const clipboardBrowser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: false, args: ['--no-sandbox'], env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } });
  const context = await clipboardBrowser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const clipboardPage = await context.newPage();
  await clipboardPage.goto(`http://127.0.0.1:${clipboardServer.address().port}`);
  await clipboardPage.evaluate(async () => { window.previousClipboard = await navigator.clipboard.read().then(items => Promise.all(items.map(async item => {const types={};for(const type of item.types)types[type]=await item.getType(type);return types;}))).catch(() => []); });
  try {
  await workbench.bringToFront();
  await sidebar.wait(`document.querySelector('.thread[data-thread-id="${fixture.threadId}"]')`);
  assert.equal(await sidebar.evaluate('document.querySelectorAll(".project-heading").length'), 0);
  assert.equal(await sidebar.evaluate('!!document.querySelector(".session-list > .session-tree-node")'), true);
  await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${fixture.threadId}"]').click()`);
  const panel = await findWebview('panel');
  await panel.wait(`document.querySelector('.chat-main')?.dataset.threadId === '${fixture.threadId}' && document.querySelector('.katex-display') && document.querySelector('.mermaid-svg svg')`);
  await workbench.locator('.tab').filter({ hasText: 'Rendering verification' }).waitFor();
  assert.equal(await panel.evaluate('document.querySelectorAll(".katex-error").length'), 0);
  await panel.wait('document.fonts.check("16px KaTeX_Main") && document.fonts.check("16px KaTeX_Math")');
  assert.equal(await panel.evaluate('document.querySelector(".message-navigator").classList.contains("left")'), true);
  await workbench.screenshot({ path: join(evidence, 'edh-rich-math.png') });
  console.log('PASS: conversation tab title, native fonts, KaTeX equations and Mermaid inside the real VS Code webview');

  const latex = await panel.evaluate(`(() => {
    const glyph=document.querySelector('.katex .katex-html .mord');const box=glyph.getBoundingClientRect();
    glyph.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+3,clientY:box.top+3}));
    return glyph.closest('.katex').querySelector('annotation').textContent;
  })()`);
  await panel.wait('document.querySelector(".math-context-menu")');
  await panel.evaluate('document.querySelector(".math-context-menu button").click()');
  await panel.wait('!document.querySelector(".math-context-menu")');
  await panel.evaluate('document.querySelector("textarea").focus()');
  await workbench.keyboard.press('Control+v');
  await panel.wait(`document.querySelector('textarea').value === ${JSON.stringify(latex)}`);
  const setMessage = async text => {
    await panel.evaluate(`(() => {const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await panel.wait(`document.querySelector('textarea').value === ${JSON.stringify(text)}`);
  };
  const jumpRail = async key => {
    await panel.evaluate(`document.querySelector('.message-nav-track').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
    await panel.wait(key === 'Home' ? "document.querySelector('.message-nav-position')?.textContent.startsWith('1 /')" : "document.querySelector('.message-nav-position')?.textContent.split(' / ')[0] === document.querySelector('.message-nav-track').querySelectorAll('[role=option]').length.toString()");
    await panel.evaluate(`document.querySelector('.message-nav-track').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  };
  console.log('PASS: right-click equation copies original LaTeX through the native clipboard');
  await setMessage('A draft preserved during navigation');
  for (let page = 0; page < 20 && await panel.evaluate('!!document.querySelector(".message-nav-earlier")'); page++) {
    const count = await panel.evaluate('document.querySelectorAll(".message-nav-tick").length');
    await panel.evaluate('document.querySelector(".message-nav-earlier").click()');
    await panel.wait(`!document.querySelector('.message-nav-earlier') || (document.querySelectorAll('.message-nav-tick').length > ${count} && !document.querySelector('.message-nav-earlier').disabled)`);
  }
  assert.equal(await panel.evaluate('!!document.querySelector(".message-nav-earlier")'), false);
  await jumpRail('Home');
  await panel.wait(`[...document.querySelectorAll('.user-message')].some(row => row.textContent.includes('Verification prompt 0'))`);
  const settingsPath = join(home, 'workspace/.vscode/settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  for (const placement of ['right', 'off', 'left']) {
    await writeFile(settingsPath, JSON.stringify({ ...settings, 't3-vscode.messageNavigation': placement }));
    await panel.wait(placement === 'off' ? '!document.querySelector(".message-navigator")' : `document.querySelector('.message-navigator')?.classList.contains('${placement}')`);
    assert.equal(await panel.evaluate('document.querySelector("textarea").value'), 'A draft preserved during navigation');
  }
  await jumpRail('End');
  await panel.wait('document.querySelector(".work-group") && document.querySelector(".attachment-thumbnail img")');
  assert.equal(await panel.evaluate('document.querySelector(".work-group-toggle").getAttribute("aria-expanded")'), 'false');
  await panel.wait('document.querySelector(".attachment-thumbnail img").naturalWidth > 0');
  await panel.wait('document.querySelector("iframe[title=\\"Actual T3 navigation mockup\\"]")');
  const visual = await findVisualFrame();
  assert.equal(await visual.evaluate('typeof acquireVsCodeApi'), 'undefined');
  await visual.evaluate(`document.querySelector('#theme').click()`);
  await visual.wait("document.querySelector('#theme').textContent === 'Try light theme'");
  await visual.evaluate(`document.querySelector('#theme').click()`);
  await visual.wait("document.querySelector('#theme').textContent === 'Try dark theme'");
  await workbench.screenshot({ path: join(evidence, 'edh-actual-html-mockup.png') });
  console.log('PASS: rail jumps, native placement settings, preserved draft, automatically collapsed commands/thought, authenticated thumbnails and the actual published interactive HTML mockup');

    await chooseLiveTestModel(panel);
    await panel.evaluate('document.querySelector(".message-nav-latest")?.click()');
    await panel.wait('!document.querySelector(".message-nav-latest")');
    await clipboardPage.bringToFront();
    const png = (await readFile(join(home, 'clipboard-fixture.png'))).toString('base64');
    await clipboardPage.evaluate(async encoded => { const blob = new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); }, png);
    await workbench.bringToFront(); await setMessage('Reply exactly ATTACHMENT-OK. These images verify the UI. Do not run commands or edit files.');
    await panel.evaluate(`window.__pasteSeen=[];document.querySelector('textarea').addEventListener('paste',event=>window.__pasteSeen.push({types:[...event.clipboardData.types],files:[...event.clipboardData.files].map(file=>({type:file.type,size:file.size}))}));document.querySelector('textarea').focus()`); await workbench.keyboard.press('Control+v');
    await panel.wait('window.__pasteSeen.some(event => event.files.some(file => file.type === "image/png" && file.size > 0))');
    console.log('Native paste:', await panel.evaluate('window.__pasteSeen'));
    await panel.wait('document.querySelector(".composer-attachment img") && !document.querySelector(".send-button").disabled');
    await panel.wait('document.querySelector(".composer-attachment img").naturalWidth > 0');
    await panel.evaluate(`document.querySelector('[aria-label="Attach files"]').click()`);
    const input = workbench.locator('.quick-input-widget input').filter({ visible: true }).first();
    await input.waitFor(); await input.fill(join(home, 'clipboard-fixture.png'));
    await workbench.getByRole('button', { name: 'Attach', exact: true }).click();
    await input.waitFor({ state: 'hidden' });
    await panel.wait('document.querySelectorAll(".composer-attachment").length === 2 && !document.querySelector(".send-button").disabled');
    await workbench.screenshot({ path: join(evidence, 'edh-clipboard-and-picker.png') });
    await panel.evaluate('document.querySelector(".send-button").click()');
    await panel.wait('!document.querySelector(".composer-attachment")');
    await panel.evaluate('document.querySelector(".message-nav-latest")?.click()');
    await panel.wait('document.querySelectorAll(".attachment-thumbnail img").length >= 2');
    await panel.wait(`[...document.querySelectorAll('.assistant-message')].some(row=>row.textContent.includes('ATTACHMENT-OK')&&!row.querySelector('.streaming-label'))`, 120_000);
    await workbench.screenshot({ path: join(evidence, 'edh-attachments-sent.png') });
    console.log('PASS: actual OS clipboard image paste, native file-picker API for a file outside the workspace, draft thumbnails, signed upload, provider delivery and sent-message thumbnails');

  await panel.evaluate(`document.querySelector('.chat-header [aria-label="New thread"]').click()`);
  await panel.wait('document.querySelector(".chat-heading strong")?.textContent === "New thread"');
  const emptyId = await panel.evaluate('document.querySelector(".chat-main").dataset.threadId');
  await workbench.bringToFront(); await workbench.keyboard.press('Control+w');
  await sidebar.wait(`!document.querySelector('.thread[data-thread-id="${emptyId}"]')`);
  await workbench.locator('[aria-label="Open Chat in Editor Tab"]').filter({ visible: true }).first().click();
  const typed = await findWebview('panel');
  await typed.wait('document.querySelector(".chat-header")');
  await typed.evaluate(`document.querySelector('.chat-header [aria-label="New thread"]').click()`);
  await typed.wait('document.querySelector(".chat-heading strong")?.textContent === "New thread"');
  const typedId = await typed.evaluate('document.querySelector(".chat-main").dataset.threadId');
  await typed.evaluate(`(() => {const input=document.querySelector('textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;for(const text of ['Preserve this typed draft','']){set.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await workbench.keyboard.press('Control+w');
  await sidebar.wait(`document.querySelector('.thread[data-thread-id="${typedId}"]')`);
  console.log('PASS: closing an untouched new tab deletes its thread; typing then clearing preserves it');
  } finally {
    await clipboardPage.bringToFront().catch(() => {});
    await Promise.race([clipboardPage.evaluate(async () => { if (window.previousClipboard?.length) await navigator.clipboard.write(window.previousClipboard.map(types => new ClipboardItem(types))); }), new Promise((_, reject) => setTimeout(() => reject(new Error('Clipboard restore timed out')), 5000))]).catch(() => {});
    await clipboardBrowser.close(); await new Promise(resolve => clipboardServer.close(resolve));
  }

}
