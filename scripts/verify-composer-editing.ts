/** Exercise actual keyboard/undo behavior and tab-local History against the built webview. */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import type { HostState } from "../src/host/hostState.js";

export async function verifyComposerEditing(page: Page, other: Page, host: HostState, evidence: string, selectAssistantText: (page: Page, text: string) => Promise<unknown>) {
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const original = await message.inputValue(), otherDraft = await other.getByRole("textbox", { name: "Message", exact: true }).inputValue();
  const sidebarSelection = host.snapshot().activeThreadId;
  const expected = async (value: string) => { await page.waitForFunction(value => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value === value, value); };
  await message.press("Home"); for (let i = 0; i < 3; i++) await message.press("ArrowRight");
  assert.equal(await page.getByRole("dialog", { name: "History", exact: true }).count(), 0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "History", exact: true });
  await history.getByRole("button", { name: "second conversation", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.chat-main')?.getAttribute('data-thread-id') === 'second');
  await message.fill("A separate draft for the same conversation");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await history.getByRole("textbox", { name: "Search threads", exact: true }).fill("first conversation");
  await history.getByRole("textbox", { name: "Search threads", exact: true }).press("Enter");
  await expected(original);
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.selectionStart === 3);
  assert.equal(host.snapshot().activeThreadId, sidebarSelection);
  assert.equal(await other.getByRole("textbox", { name: "Message", exact: true }).inputValue(), otherDraft);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await history.press("Escape");
  assert.equal(await page.getByRole("button", { name: "History", exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await message.click(); await history.waitFor({ state: "detached" });

  assert.equal(await page.locator(".composer-formatting").count(), 1);
  await message.fill("selected text"); await message.press("Control+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click(); await expected("**selected text**");
  await message.press("Control+z"); await expected("selected text");
  await message.press("Control+Shift+z"); await expected("**selected text**");
  await message.fill("paper"); await message.press("Control+a");
  await page.getByRole("button", { name: "Insert Markdown link", exact: true }).click(); await expected("[paper](url)");
  await message.pressSequentially("https://example.com/paper"); await expected("[paper](https://example.com/paper)");
  await message.fill("1. First"); await message.press("End"); await message.press("Shift+Enter"); await expected("1. First\n2. ");
  await message.press("Control+z"); await expected("1. First");
  await message.fill("- [x] Done"); await message.press("End"); await message.press("Shift+Enter"); await expected("- [x] Done\n- [ ] ");
  await message.press("Shift+Enter"); await expected("- [x] Done\n");
  await message.fill("1. parent\n2. child"); await message.press("End"); await message.press("Tab"); await expected("1. parent\n   2. child");
  await message.press("Shift+Tab"); await expected("1. parent\n2. child");
  await page.getByRole("button", { name: "List assist", exact: true }).click();
  await message.fill("1. Plain"); await message.press("End"); await message.press("Shift+Enter"); await expected("1. Plain\n");
  await page.getByRole("button", { name: "History", exact: true }).click(); await history.getByRole("button", { name: "second conversation", exact: true }).click();
  await expected("A separate draft for the same conversation");
  assert.equal(await page.getByRole("button", { name: "List assist", exact: true }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "History", exact: true }).click(); await history.getByRole("button", { name: "first conversation", exact: true }).click();
  await expected("1. Plain\n");
  await page.getByRole("button", { name: "List assist", exact: true }).click();
  await message.fill("```ts\n1. literal"); await message.press("End"); await message.press("Shift+Enter"); await expected("```ts\n1. literal\n");
  await message.fill("plain"); await message.press("Tab"); assert.equal(await message.evaluate(el => el === document.activeElement), false);
  await message.focus(); await message.press("End"); await message.pressSequentially(" `literal` [text](url)"); await expected("plain `literal` [text](url)");
  await message.evaluate(el => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
  await expected("plain `literal` [text](url)");

  await message.fill("1. first\n2. second\n3. third");
  await message.press("Control+Home"); await message.press("End"); await message.press("Shift+Enter");
  await expected("1. first\n2. \n3. second\n4. third");
  await message.press("Control+z"); await expected("1. first\n2. \n2. second\n3. third");
  await message.pressSequentially("inserted"); await expected("1. first\n2. inserted\n2. second\n3. third");
  await message.fill("term"); await message.press("Control+a"); await message.press("$"); await expected("$term$");
  await message.press("Control+z"); await expected("term");
  await message.press("Control+a"); await message.press(":"); await expected(":");
  await message.fill("term"); await message.press("Control+a"); await page.getByRole("button", { name: "Underline", exact: true }).click(); await expected("<u>term</u>");
  // Programmatic insertions must stay in the same undo stack as typing: a draft write React applies by assigning
  // `value` would silently discard the history, which is how a paste or a quote used to make undo and redo unavailable.
  const focused = () => page.waitForFunction(() => document.activeElement === document.querySelector('textarea[aria-label="Message"]'));
  const caretAt = (position: number) => page.waitForFunction(at => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.selectionStart === at, position);
  await message.fill(""); await message.focus();
  await message.pressSequentially("Compare here then explain.");
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(12, 12));
  // The bytes a browser hands over for a pasted screenshot.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a53sAAAAASUVORK5CYII=";
  await message.evaluate((element, bytes) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(bytes), character => character.charCodeAt(0))], "clipboard.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await page.getByRole("button", { name: "Preview clipboard.png", exact: true }).waitFor();
  const pasted = await message.inputValue();
  assert.match(pasted, /^Compare here!\[clipboard\.png\]\(t3-context:\/\/v1\/image\/image_[a-z0-9_-]+\) then explain\.$/);
  await caretAt(pasted.indexOf(")") + 1);
  await message.press("Control+z"); await expected("Compare here then explain.");
  await message.press("Control+y"); await expected(pasted);
  await message.press("Control+z"); await expected("Compare here then explain.");
  await message.press("Control+z");
  const typing = await message.inputValue();
  assert.ok(typing.length < 26 && "Compare here then explain.".startsWith(typing), `undo continues into the typing before the paste, not ${JSON.stringify(typing)}`);
  await page.getByRole("button", { name: "Remove clipboard.png", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".composer-attachment"));

  // A quote replaces the selection it was cited from, and its label is rewritten in place when the comment changes.
  await message.fill("Before replace after."); await message.focus();
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 14));
  await selectAssistantText(page, "reply in first conversation");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saving a quote without a comment remains one undo step.
  const inserted = await message.inputValue();
  assert.ok(inserted.startsWith("Before ") && inserted.endsWith(" after."), inserted);
  await focused(); await caretAt(inserted.indexOf(")") + 1);
  await message.press("Control+z"); await expected("Before replace after.");
  assert.equal(await page.locator(".composer-chip.context-chip").count(), 0, "a chip follows its token out of the draft");
  await message.press("Control+y"); await expected(inserted);
  await page.getByRole("button", { name: "❝1 “reply in first conversation”", exact: true }).click();
  await page.getByRole("textbox", { name: "Comment on selected text" }).fill("Explain this");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "❝1 Explain this", exact: true }).waitFor();
  const quoted = await message.inputValue();
  assert.equal(quoted, inserted.replace("❝1 “reply in first conversation”", "❝1 Explain this"));
  await page.getByRole("button", { name: "❝1 Explain this", exact: true }).click();
  await page.getByRole("textbox", { name: "Comment on selected text" }).fill("Updated comment");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "\u275d1 Updated comment", exact: true }).waitFor();
  const relabelled = await message.inputValue();
  assert.equal(relabelled, quoted.replace("\u275d1 Explain this", "\u275d1 Updated comment"));
  await focused(); await caretAt(relabelled.indexOf(")") + 1);
  // The label sync leaves undone text alone, so history reaches the insertion rather than rewriting the label forever.
  await message.press("Control+z"); await expected(quoted);
  await message.press("Control+z"); await expected(inserted);
  await message.press("Control+z"); await expected("Before replace after.");
  await message.press("Control+y"); await expected(inserted);
  await message.press("Control+y"); await expected(quoted);
  await message.press("Control+y"); await expected(relabelled);
  await page.getByRole("button", { name: "Remove reference 1", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".composer-chip"));
  await expected("Before  after.");

  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 360, height: 720 });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await history.waitFor();
  const bounds = await history.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 720);
  await page.screenshot({ path: `${evidence}/tab-history-360.png` });
  await history.press("Escape");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${evidence}/composer-markdown-360.png` });
  await page.setViewportSize(viewport);
  assert.equal(await page.locator(".message-author .response-actions").count(), 0);
  assert.ok(await page.locator(".assistant-message .copy-button, .response-end .copy-button").count());
  assert.equal(await page.locator(".message").first().evaluate(el => getComputedStyle(el).marginBottom), "8px");
  await page.screenshot({ path: `${evidence}/dense-conversation.png` });
  await message.fill(original);
  console.log("PASS: tab-local History, independent drafts, formatting and native undo, undo and redo across a pasted image, an inserted quote and a rewritten quote label, list continuation/indentation, helper preference, IME, literal Markdown, dense spacing and narrow layouts.");
}
