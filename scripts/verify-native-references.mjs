/** Native keyboard references, using only the caller's isolated server/profile. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyNativeReferences({ home, evidence, workbench, sidebar, findWebview, runCommand }) {
  await writeFile(join(home, 'workspace/example.ts'), 'const first = 1;\nconst second = 2;\nconst third = 3;\n');
  await sidebar.wait('document.querySelector(".dedicated-sessions")');
  const selectFileLine = async line => {
    const fileTab = workbench.locator('.tab').filter({ has: workbench.locator('.label-name').filter({ hasText: /^example\.ts$/ }) }).first();
    if (await fileTab.count()) await fileTab.click();
    else {
      await workbench.keyboard.press('Control+p');
      await workbench.locator('.quick-input-widget input').filter({ visible: true }).fill(join(home, 'workspace/example.ts'));
      await workbench.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'example.ts' }).first().click();
    }
    await workbench.locator('.editor-instance .view-lines').filter({ visible: true }).first().waitFor();
    await workbench.keyboard.press('Control+Home');
    for (let index = 1; index < line; index++) await workbench.keyboard.press('ArrowDown');
    await workbench.keyboard.press('Home'); await workbench.keyboard.press('Shift+End');
  };
  const text = view => view.evaluate('document.querySelector("textarea[aria-label=Message]").value');
  const setText = async (view, value) => {
    await view.evaluate(`(() => {const input=document.querySelector('textarea[aria-label=Message]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`);
    await view.wait(`document.querySelector('textarea[aria-label=Message]').value === ${JSON.stringify(value)}`);
  };
  await selectFileLine(1); await workbench.keyboard.press('Control+k');
  const chat = await findWebview('panel');
  await chat.wait('document.querySelectorAll(".context-chip").length === 1');
  await chat.wait('document.querySelector("textarea[aria-label=Message]").value === "@example.ts:1 " && document.activeElement === document.querySelector("textarea[aria-label=Message]")');
  assert.equal(await chat.evaluate('document.querySelector("textarea[aria-label=Message]").selectionStart'), '@example.ts:1 '.length);
  assert.equal(await sidebar.evaluate('document.querySelectorAll("textarea,.context-chip").length'), 0);
  await setText(chat, 'Before replace after. @example.ts:1 ');
  await workbench.keyboard.press('Control+Home');
  for (let index = 0; index < 7; index++) await workbench.keyboard.press('ArrowRight');
  for (let index = 0; index < 7; index++) await workbench.keyboard.press('Shift+ArrowRight');
  await runCommand('T3 VSCode: Account & Usage'); await sidebar.wait('document.querySelector(".account-usage").open');
  await selectFileLine(2);
  await workbench.keyboard.insertText('const second = 200; // unsaved');
  await workbench.keyboard.press('Home'); await workbench.keyboard.press('Shift+End');
  await workbench.keyboard.press('Control+k');
  await chat.wait('document.querySelectorAll(".context-chip").length === 2');
  assert.equal(await text(chat), 'Before @example.ts:2  after. @example.ts:1 ');
  assert.equal(await chat.evaluate('[...document.querySelectorAll(".context-label")].find(x=>x.textContent.includes(":2")).title'), 'const second = 200; // unsaved');
  assert.equal(await sidebar.evaluate('document.querySelectorAll("textarea,.context-chip").length'), 0);
  const title = await chat.evaluate('document.querySelector(".chat-heading strong").textContent');
  // Composer focus is restored on the next frame after reference insertion.
  await chat.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await runCommand('T3 VSCode: New Thread');
  const other = await findWebview('panel');
  await other.wait('document.querySelector("textarea[aria-label=Message]")');
  await setText(other, 'Independent second chat draft');
  await workbench.locator('.tab').filter({ has: workbench.locator('.label-name').filter({ hasText: title }) }).first().click();
  await selectFileLine(3); await workbench.keyboard.press('Alt+k');
  await chat.wait('document.querySelectorAll(".context-chip").length === 3');
  assert.ok((await text(chat)).includes('@example.ts:3'));
  assert.equal(await text(other), 'Independent second chat draft');
  assert.equal(await other.evaluate('document.querySelectorAll(".context-chip").length'), 0);
  await sidebar.evaluate('document.querySelector(".account-usage").open=false');
  await workbench.screenshot({ path: join(evidence, 'edh-usage-reference-routing.png') });
  console.log('PASS: native Ctrl+K inserts inline ranges at the saved cursor, replaces prompt selections and preserves unsaved source text; Alt+K, cold startup, sidebar usage and independent last-used chat routing remain intact');
}
