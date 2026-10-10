/** Typed fixture turns exercise display grouping without contacting a provider. */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { MessageId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { HostState } from "../src/host/hostState.js";
import type { FakeTransport } from "../src/host/testing/fakeTransport.js";
import { activityFixture } from "../src/host/testing/activityFixture.js";

export async function verifyResponseLayout(page: Page, host: HostState, client: FakeTransport, evidence: string) {
  const id = await host.newThread(undefined, "tab-two");
  await page.waitForFunction(id => document.querySelector('.chat-main')?.getAttribute('data-thread-id') === id, id);
  await host.sendMessage("Compare the loss and check the configuration", id, "tab-two");
  await page.locator('.timeline-footer .working-label').waitFor();
  await page.getByRole('button', { name: 'Stop generation', exact: true }).waitFor();
  const sendBefore = (await page.locator('.send-button').boundingBox())?.x;
  const fixture = activityFixture(id), active = fixture.runs.find(run => run.status === "running")!;
  const startedAt = DateTime.makeUnsafe(Date.now() - 45_000), completedAt = DateTime.makeUnsafe(Date.now() - 15_000);
  const seed = fixture.turnItems[0]!;
  const make = (key: string, type: string, extra: Record<string, unknown>) => ({ ...seed, id: TurnItemId.make(key), runId: active.id, status: "completed", createdBy: "user", creationSource: "web", startedAt, completedAt, type, ...extra } as unknown as OrchestrationV2TurnItem);
  let items = [
    make('response-question', 'user_message', { text: 'Compare the loss and check the configuration', messageId: active.userMessageId, attachments: [], context: { version: 1, records: [] }, inputIntent: 'turn_start' }),
    make('thought-before', 'reasoning', { text: 'Checking the initial configuration', streaming: false }),
    make('command-before', 'command_execution', { input: 'cat config.json', status: 'running', completedAt: null }),
    make('early-answer', 'assistant_message', { text: 'The validation loss begins to rise at epoch 12. I am still checking the configuration.', messageId: MessageId.make('early-answer'), streaming: false }),
    make('thought-middle', 'reasoning', { text: 'Checking the learning rate schedule', streaming: false }),
    make('response-steer', 'user_message', { text: 'Keep the seed fixed while you check.', messageId: MessageId.make('response-steer'), inputIntent: 'steer', attachments: [], context: { version: 1, records: [] } }),
    make('thought-after', 'reasoning', { text: 'Applying the steer to the remaining checks', streaming: false }),
    make('command-after', 'command_execution', { input: 'cat seed.txt' }),
    make('second-answer', 'assistant_message', { text: 'The seed is fixed; the learning rate stays constant through the final epochs.', messageId: MessageId.make('second-answer'), streaming: false }),
  ];
  const publish = (settled = false) => client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: 200, projection: {
    ...fixture, plans: [], messages: [], runs: [{ ...active, status: settled ? "completed" : "running", completedAt: settled ? completedAt : null }],
    turnItems: items, visibleTurnItems: items.map((item, position) => ({ sourceThreadId: fixture.thread.id, sourceItemId: item.id, position, visibility: "local", item })),
  } });
  publish();
  await page.locator('.assistant-message').filter({ hasText: 'The seed is fixed' }).waitFor();
  assert.equal(await page.locator('.work-group-toggle').count(), 3);
  assert.equal(await page.locator('.work-group-toggle[aria-expanded="false"]').count(), 3);
  assert.equal(await page.locator('.assistant-message').count(), 2, 'Both partial answers remain visible while work is collapsed');
  assert.equal(await page.locator('.steer-label').textContent(), '↪ Steer');
  assert.equal(await page.locator('[data-run-header]').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Fork from this response' }).count(), 0);
  await page.locator('.work-group-toggle').first().click();
  await page.getByText('cat config.json', { exact: true }).waitFor();
  items = items.map(item => item.id === 'command-before' ? { ...item, status: 'completed', completedAt } : item); publish();
  assert.equal(await page.locator('.work-group').first().getByText('cat config.json', { exact: true }).count(), 1, 'Late completion stays before the steer');
  assert.equal(await page.locator('.work-group').last().getByText('cat config.json', { exact: true }).count(), 0);
  await page.locator('.work-group-toggle').first().click();
  await page.screenshot({ path: `${evidence}/responses-around-steer.png` });
  // Grow one visible answer so its working header has to pin, without adding artificial message headers.
  items = items.map(item => item.id === 'second-answer' ? { ...item, text: Array.from({ length: 35 }, (_, i) => `Check ${i + 1}: keep the seed fixed and compare validation loss.`).join('\n\n') } as OrchestrationV2TurnItem : item); publish();
  await page.locator('.assistant-message').last().getByText('Check 35: keep the seed fixed and compare validation loss.', { exact: true }).waitFor();
  await page.locator('.transcript-list').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await page.locator('.sticky-working').waitFor();
  assert.equal(await page.locator('.sticky-working button').count(), 0, 'Pinned status must not carry Copy/Fork actions');
  await page.screenshot({ path: `${evidence}/working-sticky-status.png` });
  publish(true);
  await page.locator('.sticky-working').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Stop generation', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await page.locator('.send-button').boundingBox())?.x, sendBefore, 'Send stays in place when Stop appears/disappears');
  assert.equal(host.snapshot('tab-two').transcript.filter(row => row.canFork).length, 1);
  assert.equal(await page.locator('.working-label').count(), 0);
  const originalViewport = page.viewportSize()!;
  // Fractional line heights exercise CSSOM rounding in the virtualizer's temporary
  // scroll-adjustment padding. It must be removed after reflow, not accumulate.
  const expectNoTrailingSpace = async () => {
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.transcript-list')!;
      const content = viewport.firstElementChild as HTMLElement;
      const footer = viewport.querySelector('.timeline-footer')!;
      const footerBottom = footer.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top + viewport.scrollTop;
      return parseFloat(getComputedStyle(content).paddingBottom) === 0 && Math.abs(viewport.scrollHeight - footerBottom) <= 2;
    }, undefined, { timeout: 3000 });
  };
  for (const width of [380, 1000, 420, 1280, 380, 760]) {
    await page.setViewportSize({ width, height: 1100 });
    await expectNoTrailingSpace();
  }
  // Also cover continuous editor-divider dragging, with no settling between steps.
  for (let width = 360; width <= 1000; width += 20) await page.setViewportSize({ width, height: 1100 });
  for (let width = 1000; width >= 360; width -= 20) await page.setViewportSize({ width, height: 1100 });
  await expectNoTrailingSpace();
  await page.locator('.transcript-list').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.work-group-toggle').first().click();
  await page.getByText('cat config.json', { exact: true }).waitFor();
  await page.setViewportSize({ width: 760, height: 1100 });
  await expectNoTrailingSpace();
  await page.getByText('cat config.json', { exact: true }).waitFor();
  assert.ok(await page.locator('.transcript-list').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight > 100), 'Resizing while reading history does not force a jump to the end');
  await page.getByRole('button', { name: 'Jump to latest message', exact: true }).click();
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.transcript-list')!;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 2;
  });
  await expectNoTrailingSpace();
  await page.screenshot({ path: `${evidence}/resized-transcript-end.png` });
  await page.setViewportSize(originalViewport);
  console.log('PASS: repeated and continuous width changes clear temporary padding; history reading and expanded work survive resizing; Latest reaches the real end.');
  console.log('PASS: accepted-send Working and Stop before output; all early answers visible; three independent thought/tool folds around answers and a steer; late completion stays in its original group; status-only sticky header; stationary Send and one settled-run fork.');
}
