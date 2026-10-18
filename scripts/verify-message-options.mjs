import assert from 'node:assert/strict';

export async function verifyMessageOptions(page) {
  const original = await page.evaluate(() => window.__state);
  for (const format of ['24-hour', '12-hour', 'automatic']) {
    await page.evaluate(timeFormat => window.__replace({ timeFormat }), format);
    await page.waitForFunction(format => {
      const options = format === '24-hour' ? { hourCycle: 'h23' } : format === '12-hour' ? { hourCycle: 'h12' } : {};
      return [...document.querySelectorAll('time.message-timestamp')].every(element => {
        const date = new Date(element.dateTime);
        return element.textContent.includes(date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', ...options }))
          && element.title === element.textContent;
      });
    }, format);
  }
  for (const [dateFormat, pattern] of [['yyyy-MM-dd', /^\d{4}-\d{2}-\d{2}/], ['MM/dd/yyyy', /^\d{2}\/\d{2}\/\d{4}/], ['dd-MMM-yy', /^\d{2}-[A-Z][a-z]{2}-\d{2}/]]) {
    await page.evaluate(dateFormat => window.__replace({ dateFormat }), dateFormat);
    await page.waitForFunction(source => [...document.querySelectorAll('time.message-timestamp')].every(time => new RegExp(source).test(time.textContent)), pattern.source);
  }
  await page.evaluate(() => window.__replace({ transcript: window.__state.transcript.map(row => row.item.type === 'user_message' ? { ...row, item: { ...row.item, text: 'My **own** message.' } } : row) }));
  const source = page.locator('.user-message .markdown p').first();
  await source.waitFor();
  await source.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await page.waitForFunction(() => window.getSelection()?.toString() === 'My own message.');
  assert.equal(await page.locator('.citation-selection-button').count(), 0);
  await source.click({ button: 'right' });
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Copy as plain text', 'Copy as Markdown', 'Quote']);
  await page.getByRole('menuitem', { name: 'Copy as plain text', exact: true }).click();
  await page.waitForFunction(() => window.__requests.findLast(request => request.method === 'copyText')?.params.text === 'My own message.');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy as Markdown', exact: true }).click();
  assert.match(await page.evaluate(() => window.__requests.findLast(request => request.method === 'copyText').params.text), /My \*\*own\*\* message\\?\./);
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Quote', exact: true }).click();
  await page.getByRole('dialog', { name: 'Comment on quote', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.locator('.context-chip').count(), 0);
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Quote', exact: true }).click();
  await page.getByRole('textbox', { name: 'Comment on selected text', exact: true }).fill('Clarify my wording');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: '❝1 Clarify my wording', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.context-chip').length === 0);
  const text = await page.evaluate(() => window.__requests.findLast(request => request.method === 'sendMessage').params.text);
  assert.match(text, /\[User quote\]/); assert.match(text, /> User quote:/); assert.doesNotMatch(text, /Assistant quote/);
  await page.evaluate(text => window.__replace({ transcript: [...window.__state.transcript, { ...window.__fixtures.user, key: 'quoted-user', item: { ...window.__fixtures.user.item, id: 'quoted-user', messageId: 'quoted-user-message', text } }] }), text);
  await page.locator('.citation-card').waitFor();
  assert.equal(await page.locator('.citation-card').count(), 1);
  await page.getByRole('button', { name: 'Open quote source', exact: true }).click();
  await page.waitForFunction(() => CSS.highlights.has('t3-assistant-citation'));
  assert.equal(await page.locator('.citation-source-notice').count(), 0);
  await page.getByRole("textbox", { name: "Message", exact: true }).click();
  await page.evaluate(original => window.__replace(original), original);
  console.log('PASS: live automatic/12/24-hour timestamps and tooltips; user selection copy/Markdown, recoverable context menu, optional-comment cancellation/save, attribution and source navigation.');
}
