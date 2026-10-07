/** Native editor workflow; all writes belong to the caller's disposable profile/home. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyEditorChat({ home, evidence, profile, workbench, sidebar, findWebview, chooseLiveTestModel, runCommand, preferenceWritten }) {
  await sidebar.wait('document.querySelector(".dedicated-sessions")');
  assert.equal(await sidebar.evaluate('document.querySelector(".account-usage").open'), false);
  assert.equal(await sidebar.evaluate('document.querySelectorAll(".project-heading,.sidebar-modes,.chat-header,textarea").length'), 0);
  const title = workbench.locator('.part.sidebar .composite.title h2').filter({ visible: true }).first();
  assert.equal((await title.textContent()).trim().toLowerCase(), 't3 vscode');
  for (const mark of ['history', 'add', 'graph', 'link-external']) assert.equal(await workbench.locator(`.part.sidebar .composite.title .codicon-${mark}`).count(), 0);
  assert.ok(await workbench.locator('.part.sidebar .codicon-globe').count());
  await runCommand('T3 VSCode: Account & Usage');
  await sidebar.wait('document.querySelector(".account-usage").open && document.querySelector(".account-usage time[datetime]")');
  await sidebar.evaluate(`document.querySelector('.account-usage [aria-label="Refresh usage"]').click()`);
  await sidebar.wait(`!document.querySelector('.account-usage [aria-label="Refresh usage"]').disabled`);
  assert.equal(await sidebar.evaluate('document.querySelector(".account-usage > summary").textContent'), 'ACCOUNT & USAGE');
  await workbench.screenshot({ path: join(evidence, 'edh-sidebar-usage-refresh.png') });
  await sidebar.evaluate('document.querySelector(".account-usage > summary").click()');

  const newChat = async () => {
    await sidebar.evaluate(`document.querySelector('.history-heading [aria-label="New thread"]').click()`);
    const panel = await findWebview('panel');
    await panel.wait('document.querySelector(".chat-empty") && document.querySelector(".chat-main").dataset.threadId');
    return panel;
  };
  const setText = async (panel, text) => {
    await panel.evaluate(`(() => { const input=document.querySelector('textarea[aria-label="Message"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await panel.wait(`document.querySelector('textarea[aria-label="Message"]').value === ${JSON.stringify(text)}`);
  };
  const empty = await newChat();
  const emptyId = await empty.evaluate('document.querySelector(".chat-main").dataset.threadId');
  await workbench.keyboard.press('Control+w');
  await sidebar.wait(`!document.querySelector('.thread[data-thread-id="${emptyId}"]')`);
  const panel = await newChat();
  await chooseLiveTestModel(panel, true);
  await setText(panel, 'Reply with exactly this markdown and no other text:\nNATIVE-EDITOR-OK\n\n[Open selected file](example.ts#L2-L3)');
  await panel.wait('!document.querySelector(".send-button").disabled');
  await panel.evaluate('document.querySelector(".send-button").click()');
  await panel.wait(`[...document.querySelectorAll('.assistant-message')].some(node => node.textContent.includes('NATIVE-EDITOR-OK') && !node.querySelector('.streaming-label'))`, 150_000);
  const selectedId = await panel.evaluate('document.querySelector(".chat-main").dataset.threadId');
  await setText(panel, 'Independent draft in the first editor');
  const second = await newChat();
  const secondId = await second.evaluate('document.querySelector(".chat-main").dataset.threadId');
  await setText(second, 'Independent draft in the second editor');
  assert.equal(await panel.evaluate('document.querySelector("textarea").value'), 'Independent draft in the first editor');
  await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${selectedId}"]').click()`);
  assert.equal(await second.evaluate('document.querySelector(".chat-main").dataset.threadId'), secondId);
  assert.equal(await second.evaluate('document.querySelector("textarea").value'), 'Independent draft in the second editor');
  console.log('PASS: sessions-only native sidebar, one New control, collapsed/refreshed usage, untouched deletion, inexpensive real editor reply and independent editor drafts');

  const settingsPath = join(home, 'workspace/.vscode/settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  await writeFile(settingsPath, JSON.stringify({ ...settings, 'workbench.colorCustomizations': { 'editor.background': '#2e3440', 'sideBar.background': '#242933', 'input.background': '#3b4252', 'input.foreground': '#eceff4', 'textLink.foreground': '#88c0d0' } }));
  await panel.wait('getComputedStyle(document.body).backgroundColor === "rgb(46, 52, 64)" && getComputedStyle(document.querySelector(".composer-box")).backgroundColor === "rgb(59, 66, 82)"');
  await sidebar.wait('getComputedStyle(document.querySelector(".sidebar-view")).backgroundColor === "rgb(36, 41, 51)"');
  await workbench.screenshot({ path: join(evidence, 'edh-custom-theme.png') });
  await writeFile(settingsPath, JSON.stringify(settings));
  await panel.wait('getComputedStyle(document.body).backgroundColor !== "rgb(46, 52, 64)"');
  assert.ok(await workbench.locator('.statusbar-item .codicon-t3-vscode-codex').count());
  assert.equal(await workbench.locator('[id="t3-vscode.configureUsage"]').count(), 0);
  await runCommand('T3 VSCode: Account & Usage');
  await sidebar.wait('document.querySelector(".account-usage").open');
  assert.equal(await sidebar.evaluate('document.querySelectorAll(".account-limit").length >= 3'), true);
  await sidebar.evaluate(`document.querySelector('.account-usage-actions button').click()`);
  await workbench.locator('.quick-input-title').filter({ hasText: 'T3 VSCode: Configure Status Meters' }).waitFor();
  await workbench.keyboard.press('Escape');
  await sidebar.evaluate(`document.querySelector('[aria-label="T3 VSCode settings"]').click()`);
  await workbench.locator('.settings-editor').waitFor();
  const categories = await workbench.locator('.settings-toc-container').textContent();
  for (const category of ['Appearance', 'Reading', 'Usage', 'Connection']) assert.ok(categories.includes(category), `Missing native settings category: ${category}`);
  for (const [index, key] of ['fontSizeInterface', 'fontSizePrompt', 'fontSizeCode'].entries()) {
    const row = workbench.locator('.setting-item-contents').filter({ hasText: ['Font Size Interface', 'Font Size Prompt', 'Font Size Code'][index] });
    await row.waitFor(); const input = row.locator('input[type="number"],input[type="text"]').first();
    const value = [18, 17, 16][index]; const saved = preferenceWritten(`t3-vscode.${key}`, value);
    await input.focus(); await input.press('Control+a'); await input.pressSequentially(String(value)); await input.press('Tab'); await saved;
  }
  await panel.wait('getComputedStyle(document.documentElement).fontSize === "18px" && getComputedStyle(document.querySelector("textarea")).fontSize === "17px"');
  await second.wait('getComputedStyle(document.documentElement).fontSize === "18px"');
  assert.equal(await workbench.getByText('Unable to write to User Settings', { exact: false }).count(), 0);
  await workbench.screenshot({ path: join(evidence, 'edh-native-settings.png') });
  await workbench.keyboard.press('Control+w');
  console.log('PASS: custom VS Code theme colors, provider meter icon, sidebar usage without a separate tab and live native font settings in an isolated Default profile');

  await panel.evaluate(`document.querySelector('.assistant-message a[href="example.ts#L2-L3"]').click()`);
  await workbench.locator('.monaco-editor').filter({ visible: true }).first().waitFor();
  await workbench.keyboard.press('Alt+k');
  await panel.wait('document.querySelector(".context-label")?.textContent === "@example.ts:2-3"');
  assert.ok((await panel.evaluate('document.querySelector(".context-label").title')).includes('export const final = 3;'));
  assert.equal(await second.evaluate('document.querySelectorAll(".context-chip").length'), 0);
  await workbench.locator('.tab').filter({ hasText: 'example.ts' }).first().click();
  await workbench.keyboard.press('Control+Home'); await workbench.keyboard.press('ArrowDown'); await workbench.keyboard.press('End');
  await workbench.keyboard.insertText(' // unsaved verification'); await workbench.keyboard.press('Home'); await workbench.keyboard.press('Shift+End'); await workbench.keyboard.press('Alt+k');
  await panel.wait('document.querySelectorAll(".context-chip").length === 2');
  assert.ok(!(await readFile(join(home, 'workspace/example.ts'), 'utf8')).includes('unsaved verification'));
  assert.equal(await second.evaluate('document.querySelector("textarea").value'), 'Independent draft in the second editor');
  console.log('PASS: native file links retain exact ranges; Alt+K captures unsaved editor text in the last focused chat without changing the other editor draft');
  if (process.argv.includes('--deep')) {
    const { verifyNativeTurns } = await import('./verify-native-turns.mjs');
    await verifyNativeTurns({ home, evidence, workbench, panel, sidebar, runCommand });
  }
  await workbench.screenshot({ path: join(evidence, 'edh-both.png') });
}
