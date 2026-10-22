/** Regression guard for the composer's native undo stack: plain typing, a picked-file reference (the
 * file-picker dialog disables the textarea while open, the gap this script was written to cover), a
 * quoted citation, and an unrelated host-state snapshot (contextUsage) arriving mid-typing. */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import type { HostState } from "../src/host/hostState.js";
import { publishText, type FakeTransport } from "../src/host/testing/fakeTransport.js";

export async function verifyComposerUndo(page: Page, host: HostState, client: FakeTransport, viewId: string, selectAssistantText: (page: Page, text: string) => Promise<unknown>) {
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const threadId = host.snapshot(viewId).activeThreadId;
  assert.ok(threadId, "verifyComposerUndo requires an active thread");
  const original = await message.inputValue();
  const expected = async (value: string) => { await page.waitForFunction(value => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value === value, value); };
  const focused = () => page.waitForFunction(() => document.activeElement === document.querySelector('textarea[aria-label="Message"]'));
  const caretAt = (position: number) => page.waitForFunction(at => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.selectionStart === at, position);
  // Unlike `fill()`, a raw `.value` assignment genuinely clears the browser's native undo history, giving each
  // scenario below a clean, predictable floor instead of reaching back into whatever an earlier scenario left behind.
  const reset = (value: string) => message.evaluate((element: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

  // Plain typed text, with no programmatic edit anywhere in its history, stays in the textarea's own undo stack.
  await reset(""); await message.focus();
  await message.pressSequentially("plain typed text");
  await expected("plain typed text");
  await message.press("Control+z");
  const afterPlainUndo = await message.inputValue();
  assert.ok(afterPlainUndo.length < "plain typed text".length && "plain typed text".startsWith(afterPlainUndo), `plain typing must stay undoable, not ${JSON.stringify(afterPlainUndo)}`);
  await message.press("Control+y");
  await expected("plain typed text");

  // A file picked through the native dialog lands while the textarea is still disabled (`picking`), so its
  // reference must be replayed once the textarea re-enables rather than falling back to a plain draft write.
  await reset(""); await message.focus();
  await message.pressSequentially("Before attach.");
  await expected("Before attach.");
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a53sAAAAASUVORK5CYII=";
  const picked = { key: "picked-key-1", name: "picked.png", mimeType: "image/png", sizeBytes: 68, previewUrl: `data:image/png;base64,${png}`,
    attachment: { id: "attach-picked-1", type: "image", name: "picked.png", mimeType: "image/png", sizeBytes: 68 } };
  // The native file-picker dialog (`vscode.window.showOpenDialog`) is unavailable outside real VS Code; stub only
  // that one RPC and let every other request reach the real bridge, so the rest of the pick-files code path —
  // disabling the textarea while picking, then inserting and re-enabling it — runs for real.
  await page.route("**/rpc*", async (route) => {
    const payload = route.request().postDataJSON() as { id: number; method: string };
    if (payload.method !== "pickAttachments") { await route.fallback(); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: payload.id, result: { attachments: [picked], errors: [] } }) });
  });
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await page.getByRole("button", { name: "Preview picked.png", exact: true }).waitFor();
  await page.unroute("**/rpc*");
  const attached = await message.inputValue();
  assert.match(attached, /^Before !\[picked\.png\]\(t3-context:\/\/v1\/image\/image_[a-z0-9_-]+\)attach\.$/, attached);
  await focused(); await caretAt(attached.indexOf(")") + 1);
  // Undoing the text leaves the chip itself orphaned (it tracks `attachments`, not the textarea's undo stack),
  // same as an existing pasted image; removing it explicitly below is the user's own cleanup step, not implied by undo.
  await message.press("Control+z"); await expected("Before attach.");
  await message.press("Control+y"); await expected(attached);
  await message.press("Control+z"); await expected("Before attach.");
  await message.press("Control+z");
  const afterAttachUndo = await message.inputValue();
  assert.ok(afterAttachUndo.length < "Before attach.".length && "Before attach.".startsWith(afterAttachUndo), `undo must continue into the typing before a picked-file attach, not ${JSON.stringify(afterAttachUndo)}`);
  await message.press("Control+y"); await expected("Before attach.");
  await message.press("Control+y"); await expected(attached);
  await page.getByRole("button", { name: "Remove picked.png", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".composer-attachment"));

  // A quoted citation stays a single undo step, same as the picked-file reference above.
  await reset(""); await message.focus();
  await message.pressSequentially("Before quote after.");
  await expected("Before quote after.");
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 12));
  await selectAssistantText(page, "reply in first conversation");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const quoted = await message.inputValue();
  assert.ok(quoted.startsWith("Before ") && quoted.endsWith(" after."), quoted);
  await focused(); await caretAt(quoted.indexOf(")") + 1);
  await message.press("Control+z"); await expected("Before quote after.");
  await message.press("Control+z");
  const afterQuoteUndo = await message.inputValue();
  assert.ok(afterQuoteUndo.length < "Before quote after.".length && "Before quote after.".startsWith(afterQuoteUndo), `undo must continue into the typing before a quote, not ${JSON.stringify(afterQuoteUndo)}`);
  await message.press("Control+y"); await expected("Before quote after.");
  await message.press("Control+y"); await expected(quoted);
  await page.getByRole("button", { name: "Remove reference 1", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".composer-chip"));

  // An unrelated host-state snapshot (a live turn's token usage, surfaced as the composer's context meter) must
  // not disturb the undo stack of text the user is typing at the same time.
  await reset(""); await message.focus();
  await message.pressSequentially("typed before a snapshot arrives");
  await expected("typed before a snapshot arrives");
  const now = () => new Date().toISOString();
  publishText(client, threadId, "First streamed chunk.", 101, {}, { providerTurns: [{ id: "undo-turn", providerThreadId: "pt", nodeId: "node", runAttemptId: null, nativeTurnRef: null, ordinal: 1, status: "running", startedAt: null, completedAt: null, tokenUsage: { usedTokens: 1_000, maxTokens: 200_000, updatedAt: now() } }] } as never);
  await page.waitForFunction(() => !!document.querySelector(".context-meter"));
  await message.pressSequentially(" more");
  await expected("typed before a snapshot arrives more");
  publishText(client, threadId, "Second streamed chunk.", 102, {}, { providerTurns: [{ id: "undo-turn", providerThreadId: "pt", nodeId: "node", runAttemptId: null, nativeTurnRef: null, ordinal: 1, status: "completed", startedAt: null, completedAt: null, tokenUsage: { usedTokens: 5_000, maxTokens: 200_000, updatedAt: now() } }] } as never);
  await page.waitForFunction(() => document.querySelector(".context-meter-percent")?.textContent === "3%");
  await message.press("Control+z");
  const afterSnapshotUndo = await message.inputValue();
  assert.ok(afterSnapshotUndo.length < "typed before a snapshot arrives more".length && "typed before a snapshot arrives more".startsWith(afterSnapshotUndo), `a host-state snapshot mid-typing must not discard undo history, not ${JSON.stringify(afterSnapshotUndo)}`);
  // Restore the fixture thread's transcript and draft to what the rest of the suite expects.
  publishText(client, threadId, `Live **reply** in ${threadId} conversation\n\nInline \`value\`.\n\n\`\`\`ts\nconst value = 42;\n\`\`\``, 103);
  // "Live reply in" is already on screen, so wait for the streamed chunks to go: a late snapshot would otherwise re-render later checks mid-step.
  await page.waitForFunction(() => document.body.textContent?.includes("Live reply in") && !document.body.textContent.includes("streamed chunk"));
  await reset(original);
  console.log("PASS: native undo for plain typing, a picked-file reference, a quote and an unrelated mid-typing host-state snapshot.");
}
