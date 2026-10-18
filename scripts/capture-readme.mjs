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
  const select = async (key) => {
    const id = fixture.threads[key];
    await sidebar.wait(`document.querySelector('.thread[data-thread-id="${id}"]')`);
    await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${id}"]').click()`);
    return id;
  };
  const open = async (key, condition) => {
    const id = await select(key);
    const view = await findWebview('panel');
    await view.wait(`document.querySelector('.chat-main')?.dataset.threadId === '${id}' && (${condition})`);
    return view;
  };
  /** Reveal a conversation that already owns a tab; its webview session stays the same. */
  const reveal = async (key, view, condition) => {
    const id = await select(key);
    await view.wait(`document.querySelector('.chat-main')?.dataset.threadId === '${id}' && (${condition})`);
  };
  const capture = async (view, filename) => {
    await view.evaluate('document.fonts.ready');
    await workbench.mouse.move(8, 30);
    // Let native layout, lazy graphics and fonts settle before taking the actual window image.
    await view.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await workbench.screenshot({ path: join(output, filename) });
  };
  const click = (view, selector) => view.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  /** Pick a native menu item with the mouse; a focused webview swallows Command Palette keystrokes. */
  const menu = async (...path) => {
    await workbench.bringToFront();
    await workbench.locator('.menubar-menu-button').filter({ hasText: path[0] }).first().click();
    for (const label of path.slice(1)) {
      const item = workbench.locator('.monaco-menu .action-item', { hasText: new RegExp(`^${label}$`) }).first();
      if (!await item.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
        await writeFile(join(process.env.T3_VSCODE_UI_EVIDENCE ?? '/tmp/t3-vscode-ui', 'menu-debug.html'), await workbench.evaluate('[...document.querySelectorAll(".context-view")].map((node) => node.outerHTML).join("\\n")'));
        throw new Error(`No native menu item "${label}"; see menu-debug.html`);
      }
      // VS Code menus act on the hovered item, so move the pointer onto it before pressing.
      await item.hover();
      await item.click();
    }
  };
  // React keeps its own value state, so drive the native setter the way a keystroke would.
  const type = (view, selector, value) => view.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const choose = (view, selector, value) => view.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const math = await open('math', 'document.querySelectorAll(".katex-display").length === 2');
  await math.wait('document.fonts.check("16px KaTeX_Main") && document.fonts.check("16px KaTeX_Math")');
  assert.equal(await math.evaluate('document.querySelectorAll(".katex-error").length'), 0);
  await math.evaluate('document.querySelector(".transcript-list").scrollTop=0');
  await capture(math, 'math-and-sessions.png');

  const visuals = await open('visuals', 'document.querySelector(".mermaid-svg svg") && document.querySelector(".html-visual-frame")');
  await visuals.evaluate('document.querySelector(".transcript-list").scrollTop=0');
  await capture(visuals, 'diagrams-and-graphics.png');

  // Full-history occurrence search, back in the equation conversation.
  const mathReady = 'document.querySelectorAll(".katex-display").length === 2';
  await reveal('math', math, mathReady);
  await click(math, '[aria-label="Find in session"]');
  await math.wait('document.querySelector(\'input[aria-label="Find in this session"]\')');
  await type(math, 'input[aria-label="Find in this session"]', 'gradient');
  await math.wait('document.querySelectorAll(".find-result").length >= 4 && /\\d+\\/\\d+/.test(document.querySelector(".find-count")?.textContent ?? "")');
  assert.match(await math.evaluate('document.querySelector(".find-disclosure span").textContent'), /\d+ results/);
  await capture(math, 'find-in-session.png');
  await click(math, '[aria-label="Close session search"]');
  await math.wait('!document.querySelector(".session-find")');

  // The server's model catalog, its search and the effort/permission controls beside Send.
  assert.ok(await math.evaluate('!!document.querySelector(\'select[aria-label="Permission mode"]\')'), 'The composer keeps a permission control');
  await click(math, '[aria-label="Choose model"]');
  await math.wait('document.querySelector(".model-picker")');
  await type(math, 'input[aria-label="Search models"]', 'gpt');
  await math.wait('document.querySelectorAll(".model-row").length >= 1 && document.querySelector(".model-choice")');
  await click(math, '.model-row .model-favorite');
  await math.wait('document.querySelector(".model-row .model-favorite").getAttribute("aria-pressed") === "true"');
  await capture(math, 'models-and-effort.png');
  await click(math, '.model-row .model-favorite');
  await math.evaluate('document.querySelector(".model-picker").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await math.wait('!document.querySelector(".model-picker")');

  // One agent-only response diff, opened in VS Code's own read-only diff editor beside the chat.
  const changes = await open('diff', 'document.querySelector(".turn-changes")');
  await click(changes, '.turn-changes summary');
  await changes.wait('document.querySelectorAll(".change-file").length === 2');
  assert.equal(await changes.evaluate('document.querySelector(".turn-changes details").open'), true);
  await changes.evaluate('document.querySelectorAll(".turn-changes .change-directory").forEach((node) => { node.open = true; })');
  await changes.wait('[...document.querySelectorAll(".turn-changes .change-directory")].every((node) => node.open)');
  // Keep the conversation and its changed-file summary visible beside the native diff: the empty
  // group on the right stays active, so the diff opens there instead of over the conversation.
  await menu('View', 'Editor Layout', 'Two Columns');
  const right = workbench.locator('.editor-group-container').nth(1);
  await right.waitFor();
  // Make the empty group active with a real pointer press; a scripted click inside the webview
  // never moves native focus, so the diff lands here instead of on top of the conversation.
  await right.click({ position: { x: 120, y: 320 } });
  await changes.evaluate(`[...document.querySelectorAll('.change-file')].find((button) => button.getAttribute('aria-label').endsWith('trainer/metrics.py')).click()`);
  await workbench.locator('.monaco-diff-editor').first().waitFor();
  const diffTab = workbench.locator('.tab', { hasText: 'metrics.py · Turn 1' }).first();
  await diffTab.waitFor();
  assert.equal(await right.locator('.tab').count(), 1, 'The diff opens beside the conversation');
  // Drag the sash on the group boundary so both diff panes stay readable.
  const narrow = await right.boundingBox();
  await workbench.mouse.move(narrow.x, narrow.y + 300);
  await workbench.mouse.down();
  await workbench.mouse.move(narrow.x - 170, narrow.y + 300, { steps: 10 });
  await workbench.mouse.up();
  await workbench.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.ok((await right.boundingBox()).width > narrow.width + 120, 'The diff group keeps room for both file panes');
  await changes.wait('document.querySelector(".turn-changes")');
  await capture(changes, 'response-diff.png');
  await diffTab.click({ button: 'middle' });
  await workbench.locator('.monaco-diff-editor').waitFor({ state: 'detached' });
  // Closing the only editor in the group restores the single-group layout the other captures use.
  await workbench.locator('.editor-group-container').nth(1).waitFor({ state: 'detached' });

  // Scheduled work: the Tasks tab and its own model, effort and schedule.
  await click(sidebar, '#tasks-tab');
  await sidebar.wait('document.querySelector("#tasks-manager .scheduled-task-list")');
  await click(sidebar, '[aria-label="New task"]');
  const taskEditor = await findWebview('task');
  await taskEditor.wait('document.querySelector(".scheduled-task-editor")');
  await type(taskEditor, 'input[aria-label="Task name"]', 'Morning dependency audit');
  await type(taskEditor, 'textarea[aria-label="Task prompt"]', 'Check the lockfile for new advisories, then summarize anything that needs an upgrade.');
  await choose(taskEditor, 'select[aria-label="Task schedule"]', 'fixed_time');
  await taskEditor.wait('document.querySelector(\'input[aria-label="Task time"]\')');
  await type(taskEditor, 'input[aria-label="Task time"]', '07:30');
  // Leave the demonstration task disabled so no schedule can reach a provider.
  await taskEditor.evaluate('(() => { const box = document.querySelector(\'input[aria-label="Task enabled"]\'); if (box.checked) box.click(); })()');
  await taskEditor.wait('document.querySelector(\'input[aria-label="Task enabled"]\').checked === false');
  await capture(taskEditor, 'scheduled-tasks.png');
  await taskEditor.evaluate('document.querySelector(".scheduled-task-editor button[type=submit]").click()');
  await sidebar.wait('document.querySelector(".scheduled-task-row")');
  assert.match(await sidebar.evaluate('document.querySelector(".scheduled-task-row").textContent'), /Morning dependency audit/);
  await click(sidebar, '#sessions-tab');
  await sidebar.wait('document.querySelector(".dedicated-sessions")');

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
  assert.ok(prompt.startsWith('About this: [❝1 Does this also apply when using label '));
  assert.ok(prompt.endsWith(' Could you expand on it?'));
  assert.ok(prompt.includes('t3-context://v1/assistant-quote/'));
  console.log('PASS: native README screenshots, themes, math/diagrams/HTML, session search, model catalog, saved-turn diff in the native diff editor, a disabled scheduled task, collapsed commands and citation insertion at the saved composer cursor; no provider turns');
}
