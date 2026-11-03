import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThreadSummary } from "../shared/bridge";

// The bridge registers a window listener at import; these render checks never send an RPC.
const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
const { GuestPendingMessages, GuestShareIndicator } = await import("./components/GuestShareControls");
if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
const thread = { id: "thread", guestShare: { id: "share", host: "guest.invalid", guestName: "Visitor", createdAt: "2026-11-01T00:00:00Z", expiresAt: "2099-11-02T00:00:00Z", messages: [
  { id: "pending", text: "Owner approval needed", status: "pending", submittedAt: "2026-11-01T00:00:00Z" },
  { id: "sent", text: "Already sent", status: "sent", submittedAt: "2026-11-01T00:00:00Z" },
] } } as unknown as ThreadSummary;

test("Pending guest UI exposes the count, author, Send and Dismiss, excluding resolved messages", () => {
  const html = renderToStaticMarkup(createElement(GuestPendingMessages, { thread }));
  assert.match(html, /1 guest message waiting/);
  assert.match(html, /Owner approval needed/);
  assert.match(html, /Send message from Visitor/);
  assert.match(html, /Dismiss message from Visitor/);
  assert.doesNotMatch(html, /Already sent/);
  assert.equal(renderToStaticMarkup(createElement(GuestPendingMessages, { thread: { ...thread, guestShare: null } })), "");
});

test("Header reflects active, redeemed and expired guest links with Stop sharing", () => {
  const html = renderToStaticMarkup(createElement(GuestShareIndicator, { thread }));
  assert.match(html, /Visitor is a guest/); assert.match(html, /Stop sharing/);
  assert.match(renderToStaticMarkup(createElement(GuestShareIndicator, { thread: { ...thread, guestShare: { ...thread.guestShare!, guestName: null } } })), /Guest link active/);
  assert.match(renderToStaticMarkup(createElement(GuestShareIndicator, { thread: { ...thread, guestShare: { ...thread.guestShare!, expiresAt: "2000-01-01T00:00:00Z" } } })), /Guest link expired/);
  assert.equal(renderToStaticMarkup(createElement(GuestShareIndicator, { thread: { ...thread, guestShare: null } })), "");
});
