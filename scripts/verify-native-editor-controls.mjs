/** Native tab/group behavior in verify-edh's disposable profile and T3 home; no provider turn. */
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifyNativeEditorControls({ evidence, workbench, sidebar, findWebview, chooseLiveTestModel, runCommand }) {
  await sidebar.wait('document.querySelector(".dedicated-sessions")');
  const setDraft = async (view, value) => {
    await view.evaluate(`(() => { const input=document.querySelector('textarea[aria-label="Message"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await view.wait(`document.querySelector('textarea[aria-label="Message"]').value === ${JSON.stringify(value)}`);
  };
  const rename = async (view, title) => {
    await view.evaluate(`document.querySelector('.chat-heading strong').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
    const input = workbench.locator('.quick-input-widget input').filter({ visible: true });
    await input.waitFor(); await input.fill(title); await input.press('Enter');
    await view.wait(`document.querySelector('.chat-heading strong').textContent === ${JSON.stringify(title)}`);
    await workbench.locator('.tab').filter({ hasText: title }).waitFor();
  };
  await runCommand('T3 VSCode: Open New Chat in Editor Tab');
  const first = await findWebview('panel');
  await first.wait('document.querySelector("textarea")');
  await chooseLiveTestModel(first);
  await setDraft(first, 'First editor draft must survive');
  await rename(first, 'Keep this conversation');
  const firstId = await first.evaluate('document.querySelector(".chat-main").dataset.threadId');

  // The active group is now empty, while the last focused chat is still on the left.
  await runCommand('View: New Editor Group to the Right');
  await runCommand('T3 VSCode: Open New Chat in Editor Tab');
  const second = await findWebview('panel');
  await second.wait('document.querySelector("textarea")');
  await chooseLiveTestModel(second);
  await setDraft(second, 'Second editor draft must survive');
  await rename(second, 'Other editor group');
  const secondId = await second.evaluate('document.querySelector(".chat-main").dataset.threadId');
  assert.notEqual(secondId, firstId);
  const groups = workbench.locator('.editor-group-container');
  assert.equal(await groups.count(), 2);
  assert.equal(await groups.nth(0).locator('.tab').filter({ hasText: 'Keep this conversation' }).count(), 1);
  assert.equal(await groups.nth(1).locator('.tab').filter({ hasText: 'Other editor group' }).count(), 1);

  // Invoke a header in the left group while the last-focused chat belongs to the right group.
  await first.evaluate(`document.querySelector('[aria-label="Open New Chat in Editor Tab"]').click()`);
  const fresh = await findWebview('panel');
  await fresh.wait('document.querySelector(".chat-heading strong")?.textContent === "New thread"');
  const freshId = await fresh.evaluate('document.querySelector(".chat-main").dataset.threadId');
  assert.notEqual(freshId, firstId); assert.notEqual(freshId, secondId);
  assert.equal(await groups.nth(0).locator('.tab').count(), 2);
  assert.equal(await groups.nth(1).locator('.tab').count(), 1);
  assert.equal(await first.evaluate('document.querySelector("textarea").value'), 'First editor draft must survive');
  assert.equal(await second.evaluate('document.querySelector("textarea").value'), 'Second editor draft must survive');
  const emptyTab = groups.nth(0).locator('.tab').filter({ hasText: 'New thread' });
  await emptyTab.hover(); await emptyTab.locator('.tab-actions [aria-label^="Close"]').click();
  await emptyTab.waitFor({ state: 'detached' });
  await sidebar.wait(`!document.querySelector('.thread[data-thread-id="${freshId}"]')`);

  await first.evaluate(`document.querySelector('[aria-label="History"]').click()`);
  await first.wait('document.querySelector(".session-history-picker")');
  await first.evaluate(`document.querySelector('.session-history-picker [data-thread-id="${secondId}"]').click()`);
  await first.wait(`document.querySelector('.chat-main').dataset.threadId === ${JSON.stringify(secondId)}`);
  assert.equal(await groups.nth(0).locator('.tab').count(), 1);
  assert.equal(await groups.nth(1).locator('.tab').count(), 1);
  assert.equal(await first.evaluate('document.querySelector("textarea").value'), '');
  assert.equal(await second.evaluate('document.querySelector("textarea").value'), 'Second editor draft must survive');
  await first.evaluate(`document.querySelector('[aria-label="History"]').click()`);
  await first.wait('document.querySelector(".session-history-picker")');
  await first.evaluate(`document.querySelector('.session-history-picker [data-thread-id="${firstId}"]').click()`);
  await first.wait('document.querySelector("textarea").value === "First editor draft must survive"');
  await first.wait('document.querySelector(".composer-formatting")');
  // Persist a real image paste, then destroy and recreate the webview through Sessions.
  await first.evaluate(`(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const clipboardData = new DataTransfer(); clipboardData.items.add(new File([bytes], 'recovery.png', {type:'image/png'}));
    document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', {bubbles:true, clipboardData}));
  })()`);
  await first.wait('document.querySelector(".composer-attachment img") && !document.querySelector(".attachment-state")?.textContent.includes("Uploading")');
  const draftBeforeClose = await first.evaluate('document.querySelector("textarea").value');
  const savedTab = groups.nth(0).locator('.tab').filter({ hasText: 'Keep this conversation' });
  await savedTab.hover(); await savedTab.locator('.tab-actions [aria-label^="Close"]').click(); await savedTab.waitFor({state:'detached'});
  await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${firstId}"]').click()`);
  const recovered = await findWebview('panel');
  await recovered.wait(`document.querySelector('textarea')?.value === ${JSON.stringify(draftBeforeClose)}`);
  await recovered.wait('document.querySelector(".composer-attachment img")');
  assert.equal(await second.evaluate('document.querySelector("textarea").value'), 'Second editor draft must survive');
  // Native chat-to-sidebar task routing must retain the chat and its attachment draft.
  await recovered.evaluate(`document.querySelector('[aria-label="Scheduled tasks"]').click()`);
  await recovered.wait('document.querySelector(".chat-scheduled-drawer")');
  await recovered.evaluate(`document.querySelector('[aria-label="New task for this session"]').click()`);
  await sidebar.wait('document.querySelector(".scheduled-task-editor")');
  const setTaskField = async (label, value, textarea = false) => sidebar.evaluate(`(() => {
    const input = document.querySelector('[aria-label="${label}"]');
    Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const taskTitle = `Native task ${Date.now()}`;
  await setTaskField('Task name', taskTitle);
  await setTaskField('Task prompt', 'Read the training log and report progress.', true);
  assert.equal(await sidebar.evaluate(`document.querySelector('[aria-label="Task effort"]').value`), 'low');
  await sidebar.evaluate(`document.querySelector('[aria-label="Task enabled"]').click()`);
  await sidebar.evaluate(`document.querySelector('.scheduled-task-editor').requestSubmit()`);
  await sidebar.wait('!document.querySelector(".scheduled-task-editor")');
  await recovered.wait(`[...document.querySelectorAll('.scheduled-task-open')].some(button=>button.textContent.includes(${JSON.stringify(taskTitle)}))`);
  await recovered.evaluate(`[...document.querySelectorAll('.scheduled-task-open')].find(button=>button.textContent.includes(${JSON.stringify(taskTitle)})).click()`);
  await sidebar.wait('document.querySelector(".scheduled-task-editor")');
  await setTaskField('Task name', taskTitle + ' draft');
  await runCommand('T3 VSCode: Sessions');
  await sidebar.wait(`!document.querySelector('.scheduled-task-editor') && document.querySelector('#sessions-tab')?.getAttribute('aria-selected') === 'true'`);
  await recovered.evaluate(`[...document.querySelectorAll('.scheduled-task-open')].find(button=>button.textContent.includes(${JSON.stringify(taskTitle)})).click()`);
  await sidebar.wait(`document.querySelector('[aria-label="Task name"]')?.value === ${JSON.stringify(taskTitle + ' draft')}`);
  await runCommand('T3 VSCode: Account & Usage');
  await sidebar.wait(`!document.querySelector('.scheduled-task-editor') && document.querySelector('.account-usage')?.open`);
  assert.equal(await recovered.evaluate('document.querySelector("textarea").value'), draftBeforeClose);
  assert.equal(await recovered.evaluate('!!document.querySelector(".composer-attachment img")'), true);
  await sidebar.evaluate(`document.querySelector('#tasks-tab').click()`);
  await sidebar.evaluate(`document.querySelector('[aria-label="New task"]').click()`);
  await sidebar.wait('document.querySelector(".scheduled-task-editor")');
  assert.equal(await sidebar.evaluate(`document.querySelector('[aria-label="Task result destination"]').value`), '');
  await setTaskField('Task name', taskTitle + ' independent');
  await setTaskField('Task prompt', 'Report progress without a parent conversation.', true);
  await sidebar.evaluate(`document.querySelector('[aria-label="Task enabled"]').click()`);
  await sidebar.evaluate(`document.querySelector('.scheduled-task-editor').requestSubmit()`);
  await sidebar.wait('!document.querySelector(".scheduled-task-editor")');
  await sidebar.wait(`[...document.querySelectorAll('.scheduled-task-open')].some(button=>button.textContent.includes(${JSON.stringify(taskTitle + ' independent')}))`);
  console.log('PASS: native chat task entry opens the sidebar editor, disabled session/independent tasks save, Sessions and Usage commands retain task drafts, and the chat text/image draft remains intact; no task runs.');
  await workbench.screenshot({ path: join(evidence, 'edh-editor-controls.png') });
  console.log('PASS: native New Chat command uses the active group, header + uses the originating group, closed tabs recover text and images, existing drafts survive, History switches only its tab, titles follow selection and untouched tabs are cleaned up; no provider messages sent.');
}
