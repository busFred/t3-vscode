/** Copy/cut/paste of composer references between two tabs and out to other apps, with the real clipboard of a headless Chromium. */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import type { FakeTransport } from "../src/host/testing/fakeTransport.js";

export async function verifyComposerClipboard(page: Page, other: Page, client: FakeTransport) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const message = (target: Page) => target.getByRole("textbox", { name: "Message", exact: true });
  const refs = /!\[([^\]]*)\]\(t3-context:\/\/v1\/image\/(image_[a-z0-9_-]+)\)/g;
  const read = async (target: Page) => [...(await message(target).inputValue()).matchAll(refs)].map((match) => ({ label: match[1]!, id: match[2]! }));
  const settled = (target: Page, count: number) => target.waitForFunction((expected) => document.querySelectorAll(".composer-attachment").length === expected && ![...document.querySelectorAll(".attachment-state")].some((state) => state.textContent === "Uploading…"), count);
  const select = (target: Page, start: number, end: number) => message(target).evaluate((element: HTMLTextAreaElement, [from, to]) => { element.focus(); element.setSelectionRange(from!, to!); }, [start, end]);
  const clipboard = async (target: Page): Promise<Record<string, string>> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await target.evaluate(async () => {
          const out: Record<string, string> = {};
          for (const item of await navigator.clipboard.read()) for (const type of item.types) { const blob = await item.getType(type); out[type] = type.startsWith("image/") ? `${blob.size}` : await blob.text(); }
          return out;
        });
      } catch (cause) { if (attempt > 20 || !String(cause).includes("Clipboard data has changed")) throw cause; await target.waitForTimeout(100); }
    }
  };
  const baseline = client.uploads.length, drafts = [await message(page).inputValue(), await message(other).inputValue()];

  // One image between words, pasted the way a browser hands over a screenshot.
  await message(page).fill("Look  here."); await message(page).focus(); await select(page, 5, 5);
  // A decodable bitmap: Chromium refuses to put an undecodable PNG on the clipboard.
  await message(page).evaluate(async (element) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8; const context = canvas.getContext("2d")!; context.fillStyle = "#c33"; context.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], "shot.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await settled(page, 1);
  const source = await message(page).inputValue(), [original] = await read(page);
  assert.ok(original); assert.match(source, /^Look !\[shot\.png\]\(t3-context:\/\/v1\/image\/image_[a-z0-9_-]+\) here\.$/);

  // Text and image together: HTML carries both, plain text is readable, no bitmap.
  await select(page, 0, source.length); await page.keyboard.press("Control+c");
  const mixed = await clipboard(page);
  assert.equal(mixed["text/plain"], "Look shot.png here.");
  assert.ok(mixed["text/html"]!.includes("<img") && mixed["text/html"]!.includes("data:image/png;base64,") && !mixed["text/html"]!.includes("t3-context://"), mixed["text/html"]);
  assert.equal(mixed["image/png"], undefined);
  await other.bringToFront(); await message(other).fill("Start | end"); await select(other, 6, 6);
  await other.keyboard.press("Control+v");
  await other.waitForFunction(() => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement).value.includes("t3-context://"));
  await settled(other, 1);
  const pasted = await message(other).inputValue(), [moved] = await read(other);
  assert.match(pasted, /^Start Look !\[shot\.png\]\(t3-context:\/\/v1\/image\/image_[a-z0-9_-]+\) here\.\| end$/, pasted);
  assert.notEqual(moved!.id, original.id);
  await other.getByRole("button", { name: "Preview shot.png", exact: true }).waitFor();
  assert.equal(client.uploads.length, baseline + 2, "the paste re-uploads the image for the receiving conversation");
  await message(other).fill(""); await other.getByRole("button", { name: "Remove shot.png", exact: true }).click(); await settled(other, 0);

  // Only the image selected: the bitmap goes out as well, and a paste still recreates the reference.
  const at = source.indexOf("!["), end = source.indexOf(")", at) + 1;
  await page.bringToFront(); await select(page, at, end); await page.keyboard.press("Control+c");
  // The bitmap arrives through the async clipboard API, a moment after the synchronous formats.
  let single = await clipboard(page);
  for (let attempt = 0; attempt < 30 && !single["image/png"]; attempt++) { await page.waitForTimeout(100); single = await clipboard(page); }
  assert.equal(single["text/plain"], "shot.png"); assert.ok(Number(single["image/png"]) > 0); assert.ok(single["text/html"]!.includes("<img"));
  await other.bringToFront(); await message(other).focus(); await other.keyboard.press("Control+v");
  await other.getByRole("button", { name: "Preview shot.png", exact: true }).waitFor(); await settled(other, 1);
  assert.match(await message(other).inputValue(), /^!\[shot\.png\]\(t3-context:\/\/v1\/image\/image_/);
  await message(other).fill(""); await other.getByRole("button", { name: "Remove shot.png", exact: true }).click(); await settled(other, 0);

  // Cut then paste in the same tab takes the original attachment back instead of uploading another.
  await page.bringToFront(); await select(page, at, end); await page.keyboard.press("Control+x");
  assert.equal(await message(page).inputValue(), "Look  here.");
  await settled(page, 1);
  const uploads = client.uploads.length;
  await select(page, 5, 5); await page.keyboard.press("Control+v");
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement).value.includes("t3-context://"));
  assert.deepEqual(await read(page), [original]); await settled(page, 1); assert.equal(client.uploads.length, uploads);
  // Copy then paste adds a second, independent attachment.
  await select(page, at, end); await page.keyboard.press("Control+c"); await select(page, source.length, source.length); await page.keyboard.press("Control+v");
  await settled(page, 2);
  const twice = await read(page); assert.equal(twice.length, 2); assert.notEqual(twice[0]!.id, twice[1]!.id);

  // Plain text from outside still pastes natively, and so does a pasted file.
  await message(page).fill(""); await message(page).focus();
  await page.evaluate(() => navigator.clipboard.writeText("from **elsewhere**\nline two"));
  await page.keyboard.press("Control+v");
  assert.equal(await message(page).inputValue(), "from **elsewhere**\nline two");
  for (const label of ["shot.png", "shot.png"]) await page.getByRole("button", { name: `Remove ${label}`, exact: true }).first().click();
  await settled(page, 0);
  await message(page).fill(drafts[0]!); await message(other).fill(drafts[1]!);
  console.log("PASS: copying references puts readable text, HTML with embedded images and (for a lone image) a PNG on the clipboard; another tab recreates the attachment with a fresh id, cut/paste reuses it, and plain text still pastes natively.");
}
