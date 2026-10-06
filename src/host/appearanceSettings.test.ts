import test from "node:test";
import assert from "node:assert/strict";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { HostState, SIDEBAR_VIEW_ID } from "./hostState.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { credentials, FakeTransport, publishText, viewsHarness } from "./testing/fakeTransport.js";
import { DEFAULT_APPEARANCE, resolveAppearance } from "../shared/appearance.js";
import { Events, type HostStateSnapshot } from "../shared/bridge.js";

test("Native settings opens without modifying preferences, and external font edits update independent views", async (t) => {
  let preferences = DEFAULT_APPEARANCE; let settingsOpened = 0;
  const { host, client } = await viewsHarness({ appearance: () => preferences }); t.after(() => host.dispose());
  host.registerView("tab-one"); host.registerView("tab-two");
  await host.selectThread("second", "tab-one"); await host.selectThread("third", "tab-two");
  for (const name of ["first", "second", "third"]) publishText(client, name, `Reply in ${name}`);
  const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry, async () => { settingsOpened += 1; });
  const views = new Map<string, FakeWebview>();
  for (const id of [SIDEBAR_VIEW_ID, "tab-one", "tab-two"]) {
    const view = new FakeWebview(); views.set(id, view); registry.add(id, view.webview); bridge.attach(view.webview, id);
  }
  host.onDidChangeState(() => bridge.pushState());
  const before = new Map([...views.keys()].map((id) => [id, host.snapshot(id)]));
  const result = await views.get("tab-one")!.request("openSettings");
  assert.equal(settingsOpened, 1); assert.equal(result.activeThreadId, "second");
  assert.deepEqual(preferences, DEFAULT_APPEARANCE);
  preferences = { fontSizeInterface: 20, fontSizePrompt: 18, fontSizeCode: 17 }; host.refreshAppearance();
  for (const [id, view] of views) {
    const state = host.snapshot(id); const previous = before.get(id)!;
    assert.deepEqual(state.appearance, preferences); assert.equal(state.activeThreadId, previous.activeThreadId);
    assert.deepEqual(state.draft, previous.draft); assert.deepEqual(state.transcript, previous.transcript);
    const push = view.messages.findLast((raw) => (raw as { event?: string }).event === Events.stateChanged) as { data: HostStateSnapshot };
    assert.deepEqual(push.data.appearance, preferences); assert.equal(push.data.activeThreadId, state.activeThreadId);
  }
  assert.equal(client.commands.length, 0); assert.equal(client.connections, 1); assert.equal(client.threadStarts, 3);
  preferences = DEFAULT_APPEARANCE; host.refreshAppearance(); assert.deepEqual(host.snapshot().appearance, DEFAULT_APPEARANCE);
  const invalid = await views.get("tab-one")!.receive({ id: "old-font-edit", method: "setAppearance" as never, params: { fontSizeInterface: 20 } });
  assert.equal(invalid.error, "Invalid bridge request.");
});

test("External font values are normalized to T3 bounds and defaults", async (t) => {
  const preferences = resolveAppearance({ fontSizeInterface: 200, fontSizePrompt: "18", fontSizeCode: 9 });
  assert.deepEqual(preferences, { fontSizeInterface: 20, fontSizePrompt: 14, fontSizeCode: 10 });
  assert.deepEqual(resolveAppearance({ fontSizeInterface: NaN, fontSizePrompt: Infinity, fontSizeCode: 12.6 }), { fontSizeInterface: 16, fontSizePrompt: 14, fontSizeCode: 13 });
  const { host } = await viewsHarness({ appearance: () => preferences }); t.after(() => host.dispose());
  assert.deepEqual(host.snapshot().appearance, preferences);
});

test("Native font settings remain available offline and are read again when the host starts", async (t) => {
  let preferences = { fontSizeInterface: 12, fontSizePrompt: 20, fontSizeCode: 18 }; let settingsOpened = 0;
  const options = { home: "/tmp/fake-t3-test", credentials, discover: async () => ({ ok: false as const, reason: "Server stopped." }), appearance: () => preferences };
  const client = new FakeTransport(); const host = new HostState(options, client); t.after(() => host.dispose()); await host.start();
  const view = new FakeWebview(); new BridgeHandler(host, new WebviewRegistry(), async () => { settingsOpened += 1; }).attach(view.webview, SIDEBAR_VIEW_ID);
  const result = await view.request("openSettings");
  assert.equal(result.phase, "no-server"); assert.deepEqual(result.appearance, preferences); assert.equal(settingsOpened, 1);
  assert.equal(client.connections, 0); assert.equal(client.commands.length, 0);
  await host.dispose();
  const restarted = new HostState(options, new FakeTransport()); t.after(() => restarted.dispose()); await restarted.start();
  assert.deepEqual(restarted.snapshot().appearance, preferences);
  let latest = restarted.snapshot(); restarted.onDidChangeState((state) => { latest = state; });
  preferences = { fontSizeInterface: 17, fontSizePrompt: 14, fontSizeCode: 15 }; restarted.refreshAppearance();
  assert.deepEqual(latest.appearance, preferences);
});

test("Native message rail placement changes preserve every view's session and draft", async (t) => {
  let placement: 'left' | 'right' | 'off' = 'left';
  const { host, client } = await viewsHarness({ messageNavigation: () => placement }); t.after(() => host.dispose());
  await host.selectThread('first'); host.registerView('tab'); await host.selectThread('second', 'tab');
  const connections = client.connections; const starts = client.threadStarts;
  for (const value of ['right', 'off', 'left'] as const) {
    placement = value; host.refreshAppearance();
    assert.equal(host.snapshot().messageNavigation, value); assert.equal(host.snapshot('tab').messageNavigation, value);
    assert.equal(host.snapshot().activeThreadId, 'first'); assert.equal(host.snapshot('tab').activeThreadId, 'second');
  }
  assert.equal(client.connections, connections); assert.equal(client.threadStarts, starts); assert.equal(client.commands.length, 0);
});
