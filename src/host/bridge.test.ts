import test from "node:test";
import assert from "node:assert/strict";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { Events, type HostStateSnapshot } from "../shared/bridge.js";

test("Editor handoff and account usage actions retain their originating view despite a different focused tab", async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  const registry = new WebviewRegistry(); const received: unknown[] = [];
  const bridge = new BridgeHandler(host, registry, undefined, undefined, undefined, {
    openInTab: (id, transfer) => { received.push({ id, transfer }); host.registerView("copied", id); },
    showUsage: (id, key) => { received.push({ id, key }); },
  });
  const sidebar = new FakeWebview(); const other = new FakeWebview();
  host.registerView("other"); await host.selectThread("third", "other");
  for (const [id, view] of [[SIDEBAR_VIEW_ID, sidebar], ["other", other]] as const) { registry.add(id, view.webview); bridge.attach(view.webview, id); }
  registry.focus("other");
  await sidebar.request("showUsage", { accountKey: "personal" });
  await sidebar.request("openInTab", { draftKey: "first", draft: { text: "Unsent message", contexts: [] } });
  assert.deepEqual(received, [{ id: SIDEBAR_VIEW_ID, key: "personal" }, { id: SIDEBAR_VIEW_ID, transfer: { draftKey: "first", draft: { text: "Unsent message", contexts: [] } } }]);
  assert.equal(host.snapshot("copied").activeThreadId, "first");
  assert.equal(host.snapshot("other").activeThreadId, "third");
  await assert.rejects(sidebar.request("openInTab", { draftKey: "third", draft: { text: "Stale session", contexts: [] } }), /changed/);
});

test("Bridge replies and state pushes are scoped to each originating webview", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry);
  const sidebar = new FakeWebview(); const first = new FakeWebview(); const second = new FakeWebview();
  host.registerView("tab-one"); host.registerView("tab-two");
  for (const [id, view] of [[SIDEBAR_VIEW_ID, sidebar], ["tab-one", first], ["tab-two", second]] as const) {
    registry.add(id, view.webview); bridge.attach(view.webview, id);
  }
  host.onDidChangeState(() => bridge.pushState());
  assert.equal((await first.request("getState")).activeThreadId, undefined);
  assert.equal((await first.request("selectThread", { threadId: "second" })).activeThreadId, "second");
  assert.equal((await second.request("selectThread", { threadId: "third" })).activeThreadId, "third");
  publishText(client, "second", "first tab's transcript"); publishText(client, "third", "second tab's transcript");
  await first.request("setModes", { interactionMode: "plan" });
  for (const [id, view] of [[SIDEBAR_VIEW_ID, sidebar], ["tab-one", first], ["tab-two", second]] as const) {
    const message = view.messages.findLast((raw) => (raw as { event?: string }).event === Events.stateChanged) as { data: HostStateSnapshot };
    assert.equal(message.data.activeThreadId, host.snapshot(id).activeThreadId);
    assert.deepEqual(message.data.transcript, host.snapshot(id).transcript);
    assert.equal(message.data.projects.length, 1);
  }
  assert.equal(host.snapshot("tab-one").draft.interactionMode, "plan");
  assert.equal(host.snapshot("tab-two").draft.interactionMode, "default");
  // A renderer cannot borrow another tab's identity by adding it to params.
  await first.request("selectThread", { threadId: "first", viewId: "tab-two" });
  assert.equal(host.snapshot("tab-two").activeThreadId, "third");
  const created = await first.request("newThread");
  assert.ok(created.activeThreadId);
  assert.equal(host.snapshot().activeThreadId, "first");
  assert.equal(host.snapshot("tab-two").activeThreadId, "third");
  await assert.rejects(second.request("selectThread", { threadId: "outside-thread" }), /current workspace/);
  registry.remove("tab-one"); await host.removeView("tab-one");
  await assert.rejects(first.request("newThread"), /tab has been closed/);
});
