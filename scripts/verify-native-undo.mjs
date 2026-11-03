/** Native Ctrl+Z in the editor-tab composer: real workbench clicks and keystrokes, so VS Code's own undo routing is exercised. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const message = 'textarea[aria-label="Message"]';

export async function verifyNativeUndo(options) {
  const server = createServer((_request, response) => response.end('<!doctype html><title>Undo clipboard fixture</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, clipboard, saved = false;
  try {
    assert.ok(options.environment?.DISPLAY, 'Use the same isolated display as VS Code for clipboard verification');
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: false, args: ['--no-sandbox'], env: options.environment });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    clipboard = await context.newPage();
    await clipboard.goto(`http://127.0.0.1:${server.address().port}`);
    await clipboard.bringToFront();
    await clipboard.waitForFunction(async () => {
      window.previousClipboard = await Promise.all((await navigator.clipboard.read()).filter(item => item.types.length).map(async item => {
        const types = {}; for (const type of item.types) types[type] = await item.getType(type); return types;
      }));
      return true;
    });
    saved = true;
    const png = (await readFile(join(options.home, 'clipboard-fixture.png'))).toString('base64');
    await clipboard.evaluate(async encoded => navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }) })]), png);
    await options.workbench.bringToFront();
    await verifyUndo(options);
  } finally {
    let restoreError;
    if (saved) try {
      await clipboard.bringToFront();
      await clipboard.evaluate(async () => { if (window.previousClipboard.length) await navigator.clipboard.write(window.previousClipboard.map(types => new ClipboardItem(types))); else await navigator.clipboard.writeText(''); });
    } catch (error) { restoreError = error; }
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    if (restoreError) throw new Error('Could not restore the clipboard after native undo verification', { cause: restoreError });
  }
}

async function verifyUndo({ home, workbench, sidebar, findWebview, runCommand }) {
  await sidebar.wait('document.querySelector(".dedicated-sessions")', 60_000);
  // Click a webview element for real; the target frame is found by matching its on-screen size.
  const click = async (view, selector) => {
    await workbench.bringToFront();
    await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
    // Revealing an Electron webview updates its compositor hit-test region asynchronously.
    // Wait for painting before translating coordinates; a DOM-visible iframe alone is not ready.
    await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const inner = await view.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth, h: innerHeight }; })()`);
    const frames = await workbench.locator('iframe.webview').evaluateAll((elements) => elements.filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'
        && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    }).map(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }));
    const frame = frames.find((box) => Math.abs(box.width - inner.w) < 2 && Math.abs(box.height - inner.h) < 2); assert.ok(frame, `webview frame for ${selector}`);
    await workbench.mouse.click(frame.x + inner.x, frame.y + inner.y);
  };
  const instrument = (view) => view.evaluate(`(() => { window.__undoLog = [];
    const command = document.execCommand.bind(document); document.execCommand = (...args) => { const result = command(...args); window.__undoLog.push('execCommand:' + args[0] + ':' + result); return result; };
    for (const type of ['keydown', 'beforeinput']) window.addEventListener(type, (event) => { const entry = type + ':' + (event.key ?? event.inputType); if (!/^(keydown|beforeinput):([a-zA-Z ]|insertText)$/.test(entry)) window.__undoLog.push(entry); }, true);
    window.addEventListener('keydown', (event) => { if (event.ctrlKey) window.__undoLog.push('bubble-keydown:' + event.key + (event.defaultPrevented ? ':prevented' : '')); });
    window.addEventListener('focus', () => window.__undoLog.push('window-focus')); window.addEventListener('blur', () => window.__undoLog.push('window-blur'));
    window.addEventListener('pointerdown', event => window.__undoLog.push('pointerdown:' + event.target.tagName + ':' + event.target.className), true);
    return true; })()`);
  const typeAndUndo = async (view, label) => {
    await instrument(view);
    await click(view, message);
    await view.wait(`document.activeElement === document.querySelector('${message}')`);
    const before = await view.evaluate(`document.querySelector('${message}').value`);
    await workbench.keyboard.type(' plain words', { delay: 40 });
    await view.wait(`document.querySelector('${message}').value === ${JSON.stringify(`${before} plain words`)}`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await workbench.keyboard.press('Control+z');
    await new Promise((resolve) => setTimeout(resolve, 800));
    const after = await view.evaluate(`document.querySelector('${message}').value`);
    const log = await view.evaluate('window.__undoLog');
    console.log(`${label}: log ${JSON.stringify(log)}; value after Ctrl+Z ${JSON.stringify(after)}`);
    // Exactly one step back: a webview panel must not also receive VS Code's own forwarded undo.
    assert.equal(after, `${before} plain word`, `${label}: Ctrl+Z must undo the last typed step once`);
    await workbench.keyboard.press('Control+Shift+z');
    await view.wait(`document.querySelector('${message}').value === ${JSON.stringify(`${before} plain words`)}`, 5_000);
    await workbench.keyboard.press('Control+z'); await workbench.keyboard.press('Control+y');
    await view.wait(`document.querySelector('${message}').value === ${JSON.stringify(`${before} plain words`)}`, 5_000);
  };

  const fixture = JSON.parse(await readFile(join(home, 'rich-chat-fixture.json'), 'utf8'));
  const items = JSON.parse(await readFile(join(home, 'rich-chat-items.json'), 'utf8'));
  const source = items.find(item => item.type === 'assistant_message' && item.text === 'Verification response 24');
  assert.ok(source, 'rich fixture assistant quote source');
  const quoteSelector = `.assistant-message [data-assistant-citation-source="${source.messageId}"]`;
  const failures = [];
  const value = view => view.evaluate(`document.querySelector('${message}').value`);
  const expected = async (view, text) => {
    try { await view.wait(`document.querySelector('${message}').value === ${JSON.stringify(text)}`, 5_000); }
    catch { throw new Error(`Expected ${JSON.stringify(text)}, got ${JSON.stringify(await value(view))}; ${JSON.stringify(await view.evaluate('window.__undoLog'))}`); }
  };
  const baseline = 'Before insertion after.';
  const openReferenceFile = async () => {
    const file = workbench.locator('.tab').filter({ has: workbench.locator('.label-name').filter({ hasText: /^undo-reference\.ts$/ }) }).first();
    if (await file.count()) await file.click();
    else {
      await runCommand('Go to File...');
      await workbench.locator('.quick-input-widget input').filter({ visible: true }).fill(join(home, 'workspace/undo-reference.ts'));
      await workbench.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'undo-reference.ts' }).first().waitFor();
      await workbench.keyboard.press('Enter');
    }
    await workbench.locator('.editor-instance .view-lines').filter({ visible: true }).first().click();
  };
  const reset = async (view, before = baseline) => {
    await view.evaluate(`document.querySelectorAll('.composer-attachment button[aria-label^="Remove "]').forEach(button => button.click())`);
    await view.wait('!document.querySelector(".composer-attachment")');
    await click(view, message);
    await view.wait(`document.activeElement === document.querySelector('${message}') && document.hasFocus()`, 5_000);
    // Start each scenario with an intentional clean history, then real typing.
    await view.evaluate(`(() => { const input=document.querySelector('${message}'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await workbench.keyboard.insertText(before);
    await expected(view, before);
    await view.evaluate(`document.querySelector('${message}').setSelectionRange(${before.length},${before.length})`);
  };
  const roundTrip = async (view, label, baseline) => {
    const inserted = await value(view);
    assert.notEqual(inserted, baseline, `${label}: insertion happened`);
    await view.wait(`document.activeElement === document.querySelector('${message}') && document.hasFocus()`, 5_000);
    // The editor-reference command reveals its tab asynchronously after posting the insertion.
    await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await view.wait(`document.activeElement === document.querySelector('${message}') && document.hasFocus()`, 5_000);
    // Check immediately, without a click that could mask an insertion's broken focus handoff.
    await workbench.keyboard.press('Control+z'); await expected(view, baseline);
    await workbench.keyboard.press('Control+y'); await expected(view, inserted);
    const title = await view.evaluate('document.querySelector(".chat-heading strong").textContent');
    // Hide the webview behind a real editor, then reveal it (including the host's latest state push).
    await openReferenceFile();
    await workbench.locator('.tab').filter({ has: workbench.locator('.label-name').filter({ hasText: title }) }).first().click();
    // A real sidebar click leaves the editor webview; returning must preserve its history.
    await click(sidebar, 'input[aria-label="Search threads"]');
    await click(view, message);
    try { await view.wait(`document.activeElement === document.querySelector('${message}') && document.hasFocus()`, 5_000); }
    catch { throw new Error(`${label}: composer focus after sidebar: ${await view.evaluate(`JSON.stringify({active:document.activeElement?.outerHTML.slice(0,300),focus:document.hasFocus(),log:window.__undoLog?.slice(-15)})`)}`); }
    for (const redo of ['Control+y', 'Control+Shift+z']) {
      await workbench.keyboard.press('Control+z');
      try { await expected(view, baseline); }
      catch { throw new Error(`${label}: one Ctrl+Z expected ${JSON.stringify(baseline)}, got ${JSON.stringify(await value(view))}; ${JSON.stringify(await view.evaluate('window.__undoLog'))}`); }
      await workbench.keyboard.press(redo); await expected(view, inserted);
    }
    // History must still reach typing from before the insertion.
    await workbench.keyboard.press('Control+z'); await expected(view, baseline);
    await workbench.keyboard.press('Control+z');
    const prior = await value(view);
    assert.ok(prior.length < baseline.length && baseline.startsWith(prior), `${label}: earlier typing remains undoable: ${JSON.stringify(prior)}`);
    await workbench.keyboard.press('Control+y'); await expected(view, baseline);
    await workbench.keyboard.press('Control+y'); await expected(view, inserted);
    console.log(`PASS: ${label}; one insertion step, both redo shortcuts, earlier typing and sidebar focus round-trip`);
    return inserted;
  };
  const scenario = async (view, label, insert, before = baseline) => {
    try { await reset(view, before); await insert(); return await roundTrip(view, label, before); }
    catch (error) { failures.push(error); console.error(error.message); }
  };
  const insertions = async (view, label) => {
    await writeFile(join(home, 'workspace/undo-reference.ts'), 'const undoReference = 1;\n');
    await scenario(view, `${label}: image paste/upload`, async () => {
      const png = (await readFile(join(home, 'clipboard-fixture.png'))).toString('base64');
      await view.evaluate(`(() => { const transfer=new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],'undo-paste.png',{type:'image/png'})); document.querySelector('${message}').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true})); })()`);
      await view.wait(`document.querySelector('button[aria-label="Remove undo-paste.png"]') && ![...document.querySelectorAll('.attachment-state')].some(node=>/Uploading|failed/.test(node.textContent))`, 30_000);
    });
    await scenario(view, `${label}: OS clipboard image paste/upload`, async () => {
      await view.evaluate(`window.__nativePasteSeen=false; document.querySelector('${message}').addEventListener('paste', event => { window.__nativePasteSeen=[...event.clipboardData.files].some(file=>file.type==='image/png'); }, {once:true})`);
      await workbench.keyboard.press('Control+v');
      await view.wait('window.__nativePasteSeen');
      await view.wait(`document.querySelector('.composer-attachment') && ![...document.querySelectorAll('.attachment-state')].some(node=>/Uploading|failed/.test(node.textContent))`, 30_000);
    });
    // A plain new-chat panel needs a transcript for the quote case. History keeps its panel type.
    if (await view.evaluate(`document.querySelector('.chat-main')?.dataset.threadId !== ${JSON.stringify(fixture.threadId)}`)) {
      await click(view, 'button[aria-label="History"]');
      await view.wait(`document.querySelector('#session-history .thread[data-thread-id="${fixture.threadId}"]')`);
      await click(view, `#session-history .thread[data-thread-id="${fixture.threadId}"]`);
      await view.wait(`document.querySelector('.chat-main')?.dataset.threadId === ${JSON.stringify(fixture.threadId)} && !document.querySelector('#session-history')`);
    }
    await view.wait(`document.querySelector(${JSON.stringify(quoteSelector)})`);
    const quote = async () => {
      const selector = quoteSelector;
      await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await click(view, selector);
      await view.evaluate(`(() => { const source=document.querySelector(${JSON.stringify(selector)}); const range=document.createRange(); range.selectNodeContents(source); const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`);
      await workbench.keyboard.press('Shift+F10');
      await view.wait('document.querySelector(".selection-context-menu")');
      await click(view, '.selection-context-menu button:last-of-type');
      await view.wait('document.querySelector(".citation-comment")');
      await click(view, '.citation-comment-actions .primary');
      await view.wait('!document.querySelector(".citation-comment")');
    };
    const quoted = await scenario(view, `${label}: assistant quote`, quote);
    if (quoted) await scenario(view, `${label}: repeated assistant quote`, quote, quoted);
    await scenario(view, `${label}: editor reference / hidden tab`, async () => {
      await writeFile(join(home, 'workspace/undo-reference.ts'), 'const undoReference = 1;\n');
      await openReferenceFile();
      await workbench.keyboard.press('Control+Home'); await workbench.keyboard.press('Shift+End');
      await workbench.keyboard.press('Control+k');
      await view.wait(`document.querySelector('${message}').value.includes('undo-reference.ts') && document.activeElement === document.querySelector('${message}')`);
    });
  };

  // Open the source editor once while the workbench owns focus; all later switches
  // use real tab clicks instead of forwarding unrelated shortcuts through a webview.
  await writeFile(join(home, 'workspace/undo-reference.ts'), 'const undoReference = 1;\n');
  await openReferenceFile();
  await click(sidebar, 'button[aria-label="New thread"]');
  const fresh = await findWebview('panel');
  await fresh.wait(`document.querySelector('${message}')`);
  await typeAndUndo(fresh, 'new chat tab');
  await insertions(fresh, 'new chat panel');

  // Close the plain panel so Sessions opens a distinct custom editor for the same fixture.
  const title = await fresh.evaluate('document.querySelector(".chat-heading strong").textContent');
  const tab = workbench.locator('.tab').filter({ has: workbench.locator('.label-name').filter({ hasText: title }) }).first();
  await tab.hover();
  await tab.locator('.tab-actions .action-label[aria-label^="Close"]').click();

  // An existing session with a long transcript, opened the way the user does: a single click in Sessions (preview tab).
  await sidebar.wait(`document.querySelector('.thread[data-thread-id="${fixture.threadId}"]')`, 60_000);
  await click(sidebar, `.thread[data-thread-id="${fixture.threadId}"]`);
  const existing = await findWebview('panel');
  await existing.wait(`document.querySelector('.chat-main')?.dataset.threadId === ${JSON.stringify(fixture.threadId)} && document.querySelector('${message}')`, 60_000);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await typeAndUndo(existing, 'existing session (preview tab)');
  await insertions(existing, 'session custom-editor tab');
  if (failures.length) throw new AggregateError(failures, 'Native insertion undo regressions');
}
