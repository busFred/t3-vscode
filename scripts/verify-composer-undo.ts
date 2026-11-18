/** Regression guard for the composer's native undo stack: plain typing, a picked-file reference (the
 * file-picker dialog disables the textarea while open, the gap this script was written to cover), a
 * quoted citation, a reply to a response, a question answer carried over when Stop cancels its question, and an unrelated
 * host-state snapshot (contextUsage) arriving mid-typing. */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import type { HostState } from "../src/host/hostState.js";
import { publishText, type FakeTransport } from "../src/host/testing/fakeTransport.js";
import * as Schema from "effect/Schema";
import { OrchestrationV2RuntimeRequest, OrchestrationV2TurnItem, RunId } from "@t3tools/contracts";
import { v2Now } from "../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";

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

  // A suggested next prompt (T3 0.1.8) is an insertion path like any other: using one must cost
  // exactly one undo step, and must not reach back into the typing before it.
  await reset(""); await message.focus();
  await message.pressSequentially("typed before a suggestion");
  await expected("typed before a suggestion");
  client.promptSuggestionHandlers.get(threadId)?.({ runId: RunId.make("undo-suggestion-run"), text: "Add a regression test." });

  // The chip is offered only over an empty composer, so clear what was typed first.
  await reset(""); await message.focus();
  await page.getByRole("button", { name: "Use suggested prompt: Add a regression test." }).click();
  await expected("Add a regression test.");
  await focused();
  await message.press("Control+z");
  await expected("");
  await message.press("Control+y");
  await expected("Add a regression test.");
  client.promptSuggestionHandlers.get(threadId)?.(null);
  await page.waitForFunction(() => !document.querySelector(".prompt-suggestion"));

  // A send that fails must not cost the user their undo history. The composer is held read-only
  // while a send is in flight rather than disabled, because toggling `disabled` clears that stack.
  await reset(""); await message.focus();
  await message.pressSequentially("typed before a failed send");
  await expected("typed before a failed send");
  // Watch the attribute itself. Toggling `disabled` is what clears a textarea's native undo stack,
  // so a send must never set it — regression guard for the mechanism, not just the symptom.
  const watchDisabled = () => message.evaluate((element: HTMLTextAreaElement) => {
    (window as unknown as { __disabledSeen: boolean }).__disabledSeen = false;
    const observer = new MutationObserver(() => { if (element.disabled) (window as unknown as { __disabledSeen: boolean }).__disabledSeen = true; });
    observer.observe(element, { attributes: true, attributeFilter: ["disabled"] });
    (window as unknown as { __disabledObserver: MutationObserver }).__disabledObserver = observer;
  });
  const disabledSeen = () => page.evaluate(() => {
    const scope = window as unknown as { __disabledObserver?: MutationObserver; __disabledSeen?: boolean };
    scope.__disabledObserver?.disconnect(); return scope.__disabledSeen === true;
  });
  await watchDisabled();
  client.failNextDispatch = "fixture refused this dispatch";
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForFunction(() => !(document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.readOnly);
  await expected("typed before a failed send");
  await message.focus();
  await message.press("Control+z");
  const afterFailedSend = await message.inputValue();
  assert.ok(afterFailedSend.length < "typed before a failed send".length && "typed before a failed send".startsWith(afterFailedSend),
    `a failed send must leave typing undoable, not ${JSON.stringify(afterFailedSend)}`);
  assert.equal(await disabledSeen(), false, "a failed send must not toggle the textarea's disabled attribute, which would clear its undo stack");

  // The same guard across a send that succeeds and clears the draft.
  await reset(""); await message.focus();
  await message.pressSequentially("typed before a successful send");
  await expected("typed before a successful send");
  await watchDisabled();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expected("");
  assert.equal(await disabledSeen(), false, "a successful send must not toggle the textarea's disabled attribute either");
  // A sent message must not come back on undo: the clear is deliberately not a native edit.
  await message.focus(); await message.press("Control+z");
  assert.equal(await message.inputValue(), "", "undo must not resurrect a message that was already sent");

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

  // VS Code forwards native paste with execCommand('paste'). Model its nesting by
  // dispatching the clipboard event while another native edit is still on the stack.
  await reset(""); await message.focus();
  await message.pressSequentially("Before nested paste.");
  await message.evaluate((element: HTMLTextAreaElement, bytes: string) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], "nested-paste.png", { type: "image/png" }));
    window.addEventListener("input", () => element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })), { once: true });
    document.execCommand("insertText", false, " ");
  }, png);
  await page.getByRole("button", { name: "Preview nested-paste.png", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".attachment-state")?.textContent?.includes("Uploading"));
  const nestedPaste = await message.inputValue();
  assert.match(nestedPaste, /^Before nested paste\. !\[nested-paste\.png\]/);
  await message.press("Control+z"); await expected("Before nested paste. ");
  await message.press("Control+y"); await expected(nestedPaste);
  await message.press("Control+z"); await expected("Before nested paste. ");
  await page.getByRole("button", { name: "Remove nested-paste.png", exact: true }).click();
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
  // The same passage keeps the same citation number. Its final label must be part
  // of the insertion, rather than a second native edit during React's layout effects.
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await selectAssistantText(page, "reply in first conversation");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const repeatedQuote = await message.inputValue();
  await focused();
  await message.press("Control+z"); await expected(quoted);
  await message.press("Control+y"); await expected(repeatedQuote);
  await message.press("Control+z"); await expected(quoted);
  // A distinct quote inserted before the first one renumbers that older token in
  // the same edit, and undo restores both the old text and its old number.
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));
  await selectAssistantText(page, "reply in first");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const prependedQuote = await message.inputValue();
  assert.ok(prependedQuote.includes("❝2"), prependedQuote);
  await focused();
  await message.press("Control+z"); await expected(quoted);
  await message.press("Control+y"); await expected(prependedQuote);
  await message.press("Control+z"); await expected(quoted);
  await page.getByRole("button", { name: "Remove reference 1", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".composer-chip"));

  // Reply to a response (T3 0.1.10) is offered only by a server known to keep its record: hidden for an unknown
  // version and for 0.1.9, shown for a 0.1.10 preview. Inserting it is one native edit, like a quote.
  const replyButton = page.getByRole("button", { name: "Reply to this response", exact: true });
  const fixtureText = `Live **reply** in ${threadId} conversation\n\nInline \`value\`.\n\n\`\`\`ts\nconst value = 42;\n\`\`\``;
  const descriptor = (host as unknown as { server: { descriptor: { serverVersion?: string } } | null }).server?.descriptor;
  assert.ok(descriptor, "the fixture host must have a server descriptor");
  const fixtureVersion = descriptor.serverVersion;
  const fixtureEnvironment = (client.config as { environment?: unknown }).environment;
  const serveVersion = async (version: string | undefined, sequence: number) => {
    if (version === undefined) delete descriptor.serverVersion; else descriptor.serverVersion = version;
    // Reply follows the conversation's own machine (its server config), as a real server reports it, not the local descriptor.
    const config = client.config as { environment?: Record<string, unknown> };
    const { serverVersion: _previous, ...environment } = config.environment ?? { environmentId: (descriptor as { environmentId?: string }).environmentId ?? "audit", label: "Audit", capabilities: {} };
    config.environment = version === undefined ? environment : { ...environment, serverVersion: version };
    publishText(client, threadId, fixtureText, sequence);
    await page.waitForFunction(() => document.body.textContent?.includes("Live reply in"));
    await page.waitForTimeout(150);
  };
  await serveVersion(undefined, 80);
  assert.equal(await replyButton.count(), 0, "Reply must be hidden when the server version is unknown");
  await serveVersion("0.1.9", 81);
  assert.equal(await replyButton.count(), 0, "Reply must be hidden for a 0.1.9 server, which drops the reply's record");
  await serveVersion("0.1.10-nightly.20261112.1", 82);
  await replyButton.first().waitFor();
  const replyToken = /^\[Live reply in [^\]]*\]\(t3-context:\/\/v1\/response\/response_message\) /;
  // First reply, into an empty composer: one undo step empties it again.
  await reset(""); await message.focus();
  await replyButton.first().click();
  await page.waitForFunction(() => /^\[Live reply in /.test((document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value ?? ""));
  const firstReply = await message.inputValue();
  assert.match(firstReply, replyToken); assert.equal(firstReply.replace(replyToken, ""), "");
  assert.equal(await page.locator(".reply-chip").count(), 1, "a reply shows as a removable chip");
  await page.getByRole("button", { name: "Cancel reply", exact: true }).waitFor();
  await focused();
  await message.press("Control+z"); await expected("");
  await message.press("Control+y"); await expected(firstReply);
  // A reply after typing leads the message, undoes in one step and leaves the typing undoable.
  await reset(""); await message.focus();
  await message.pressSequentially("Before reply.");
  await expected("Before reply.");
  await replyButton.first().click();
  await page.waitForFunction(() => /^\[Live reply in /.test((document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value ?? ""));
  const typedReply = await message.inputValue();
  assert.match(typedReply, replyToken); assert.equal(typedReply.replace(replyToken, ""), "Before reply.");
  await focused();
  // Replying again to the same response changes nothing, so it adds no undo step.
  await replyButton.first().click(); await focused();
  assert.equal(await message.inputValue(), typedReply);
  await message.press("Control+z"); await expected("Before reply.");
  await message.press("Control+z");
  const afterReplyUndo = await message.inputValue();
  assert.ok(afterReplyUndo.length < "Before reply.".length && "Before reply.".startsWith(afterReplyUndo), `undo must continue into the typing before a reply, not ${JSON.stringify(afterReplyUndo)}`);
  await message.press("Control+y"); await expected("Before reply.");
  await message.press("Control+y"); await expected(typedReply);
  await page.getByRole("button", { name: "Cancel reply", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".composer-chip"));
  await expected("Before reply.");
  await serveVersion(fixtureVersion, 83);
  const restoredConfig = client.config as { environment?: unknown };
  if (fixtureEnvironment === undefined) delete restoredConfig.environment; else restoredConfig.environment = fixtureEnvironment;
  await page.waitForFunction(() => !document.querySelector(".reply-button"));

  // A question that closes without an answer (Stop cancels it, or the provider times it out) returns its typed
  // text to the composer. That insertion is one native edit, so it undoes in one step, leaves the typing before it
  // undoable, hands focus back, and is not repeated by later snapshots that still list the closed question.
  const question = Schema.decodeUnknownSync(OrchestrationV2TurnItem)({ id: "undo-question", threadId, type: "user_input_request", requestId: "undo-question-request",
    questions: [{ id: "q", header: "Carry", question: "Which database?", options: [] }], runId: null, nodeId: null, providerThreadId: null, providerTurnId: null,
    nativeItemRef: null, parentItemId: null, ordinal: 0, status: "pending", title: null, startedAt: v2Now, completedAt: null, updatedAt: v2Now });
  let questionSequence = 90;
  const publishQuestion = (status: "pending" | "cancelled" | "expired") => publishText(client, threadId, "unused", ++questionSequence, {}, {
    turnItems: [question], visibleTurnItems: [{ item: question, position: 0, sourceItemId: question.id, sourceThreadId: question.threadId, visibility: "local" }],
    runtimeRequests: [Schema.decodeUnknownSync(OrchestrationV2RuntimeRequest)({ id: "undo-question-request", nodeId: "node", providerTurnId: null, nativeRequestRef: null, kind: "user_input", status,
      responseCapability: { type: "live", providerSessionId: "session" }, createdAt: v2Now, resolvedAt: status === "pending" ? null : v2Now })] } as never);
  const answerField = page.getByRole("textbox", { name: "Answer: Carry", exact: true });
  const typeAnswer = async (text: string) => { publishQuestion("pending"); await answerField.waitFor(); await answerField.pressSequentially(text); };
  const closed = async (status: "cancelled" | "expired") => { publishQuestion(status); await page.waitForFunction(() => !document.querySelector(".question-card")); };
  await reset(""); await message.focus();
  await message.pressSequentially("Before stop.");
  await expected("Before stop.");
  await typeAnswer("use staging");
  await closed("cancelled");
  await expected("Before stop.\n\nuse staging");
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('textarea[aria-label="Message"]')), false, "the carried answer must not keep the focus it borrowed");
  await message.focus();
  await message.press("Control+z"); await expected("Before stop.");
  await message.press("Control+z");
  const afterCarryUndo = await message.inputValue();
  assert.ok(afterCarryUndo.length < "Before stop.".length && "Before stop.".startsWith(afterCarryUndo), `undo must continue into the typing before a carried answer, not ${JSON.stringify(afterCarryUndo)}`);
  await message.press("Control+y"); await expected("Before stop.");
  await message.press("Control+y"); await expected("Before stop.\n\nuse staging");
  // The same closed question stays in later snapshots; it must not be carried a second time.
  publishQuestion("cancelled"); publishQuestion("expired");
  await page.waitForTimeout(150);
  assert.equal(await message.inputValue(), "Before stop.\n\nuse staging", "a closed question must be carried only once");
  // Into an empty composer, from a provider timeout: one undo step empties it again.
  await reset("");
  await typeAnswer("second answer");
  await closed("expired");
  await expected("second answer");
  await message.focus();
  await message.press("Control+z"); await expected("");
  await message.press("Control+y"); await expected("second answer");

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
  console.log("PASS: native undo for typing, picked files, nested native paste, first/repeated quotes, a first reply and a reply after typing, a carried question answer, a mid-typing host snapshot, a suggested prompt and a failed send.");
}
