/** Native Ctrl+Z in the editor-tab composer: real workbench clicks and keystrokes, so VS Code's own undo routing is exercised. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const message = 'textarea[aria-label="Message"]';

export async function verifyNativeUndo({ home, workbench, sidebar, findWebview, runCommand }) {
  await sidebar.wait('document.querySelector(".dedicated-sessions")', 60_000);
  // Click a webview element for real; the target frame is found by matching its on-screen size.
  const click = async (view, selector) => {
    const inner = await view.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth, h: innerHeight }; })()`);
    const frames = await workbench.locator('iframe.webview').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0).map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.height })));
    const frame = frames.find((box) => Math.abs(box.width - inner.w) < 2 && Math.abs(box.height - inner.h) < 2); assert.ok(frame, `webview frame for ${selector}`);
    await workbench.mouse.click(frame.x + inner.x, frame.y + inner.y);
  };
  const instrument = (view) => view.evaluate(`(() => { window.__undoLog = [];
    for (const type of ['keydown', 'beforeinput']) window.addEventListener(type, (event) => { const entry = type + ':' + (event.key ?? event.inputType); if (!/^(keydown|beforeinput):([a-zA-Z ]|insertText)$/.test(entry)) window.__undoLog.push(entry); }, true);
    window.addEventListener('keydown', (event) => { if (event.ctrlKey) window.__undoLog.push('bubble-keydown:' + event.key + (event.defaultPrevented ? ':prevented' : '')); });
    window.addEventListener('focus', () => window.__undoLog.push('window-focus')); window.addEventListener('blur', () => window.__undoLog.push('window-blur'));
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

  await runCommand('T3 VSCode: Open New Chat in Editor Tab');
  const fresh = await findWebview('panel');
  await fresh.wait(`document.querySelector('${message}')`);
  await typeAndUndo(fresh, 'new chat tab');

  // An existing session with a long transcript, opened the way the user does: a single click in Sessions (preview tab).
  const fixture = JSON.parse(await readFile(join(home, 'rich-chat-fixture.json'), 'utf8'));
  await sidebar.wait(`document.querySelector('.thread[data-thread-id="${fixture.threadId}"]')`, 60_000);
  await click(sidebar, `.thread[data-thread-id="${fixture.threadId}"]`);
  const existing = await findWebview('panel');
  await existing.wait(`document.querySelector('.chat-main')?.dataset.threadId === ${JSON.stringify(fixture.threadId)} && document.querySelector('${message}')`, 60_000);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await typeAndUndo(existing, 'existing session (preview tab)');
}
