import assert from "node:assert/strict";
import type { Page } from "playwright-core";

export async function verifyModelReordering(page: Page) {
  const grip = page.getByRole("button", { name: "Reorder Legacy Kimi", exact: true });
  await grip.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Reorder Legacy Kimi");
  const order = () => page.locator(".model-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-model-slug")));
  const original = await order();
  const start = await grip.boundingBox(); const target = await page.locator(".model-row").last().boundingBox();
  assert.ok(start && target);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, target.y + target.height - 3, { steps: 5 });
  await page.locator(".model-drop-line").waitFor();
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.deepEqual(await order(), original, "Escape cancels without closing the picker");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, target.y + target.height - 3, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".model-row")?.getAttribute("data-model-slug") !== "old-kimi");
  // Native touch events exercise PointerEvent capture and prevent page scrolling.
  const touchStart = await grip.boundingBox(); const first = await page.locator(".model-row").first().boundingBox();
  assert.ok(touchStart && first);
  const cdp = await page.context().newCDPSession(page);
  const x = touchStart.x + touchStart.width / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: touchStart.y + touchStart.height / 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: first.y + 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach();
  await page.waitForFunction(() => document.querySelector(".model-row")?.getAttribute("data-model-slug") === "old-kimi");
  assert.equal(await page.getByRole("checkbox", { name: "Show Kimi", exact: true }).isChecked(), false);
  await page.getByRole("textbox", { name: "Search models" }).fill("Kimi");
  assert.equal(await grip.isDisabled(), true, "Search is a partial order");
  await page.getByRole("textbox", { name: "Search models" }).fill("");
  assert.deepEqual(await order(), original);
}
