import test from "node:test";
import assert from "node:assert/strict";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { HostState, SIDEBAR_VIEW_ID } from "./hostState.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { credentials, FakeTransport, publishText, viewsHarness } from "./testing/fakeTransport.js";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "../shared/appearance.js";
import { Events, type HostStateSnapshot } from "../shared/bridge.js";

test("Font edits persist and reach every view without changing their conversations or drafts", async (t) => {
  let preferences = DEFAULT_APPEARANCE;
  const writes: Partial<AppearanceSettings>[] = [];
  const { host, client } = await viewsHarness({ appearance: () => preferences, saveAppearance: async (update) => {
    writes.push(update); preferences = { ...preferences, ...update };
  } });
  t.after(() => host.dispose());
  host.registerView("tab-one"); host.registerView("tab-two"); host.registerView("draft-tab");
  await host.selectThread("second", "tab-one"); await host.selectThread("third", "tab-two");
  await host.setModes(undefined, { interactionMode: "plan", runtimeMode: "full-access" }, "draft-tab");
  for (const name of ["first", "second", "third"]) publishText(client, name, `Reply in ${name}`);
  const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry);
  const views = new Map<string, FakeWebview>();
  for (const id of [SIDEBAR_VIEW_ID, "tab-one", "tab-two", "draft-tab"]) {
    const view = new FakeWebview(); views.set(id, view); registry.add(id, view.webview); bridge.attach(view.webview, id);
  }
  host.onDidChangeState(() => bridge.pushState());
  const before = new Map([...views.keys()].map((id) => [id, host.snapshot(id)]));
  const result = await views.get("tab-one")!.request("setAppearance", { fontSizeInterface: 20, fontSizePrompt: 18, fontSizeCode: 17 });
  assert.equal(result.activeThreadId, "second");
  assert.deepEqual(preferences, { fontSizeInterface: 20, fontSizePrompt: 18, fontSizeCode: 17 });
  assert.equal(writes.length, 1);
  for (const [id, view] of views) {
    const state = host.snapshot(id); const previous = before.get(id)!;
    assert.deepEqual(state.appearance, preferences);
    assert.equal(state.activeThreadId, previous.activeThreadId);
    assert.deepEqual(state.draft, previous.draft); assert.deepEqual(state.transcript, previous.transcript);
    const push = view.messages.findLast((raw) => (raw as { event?: string }).event === Events.stateChanged) as { data: HostStateSnapshot };
    assert.deepEqual(push.data.appearance, preferences); assert.equal(push.data.activeThreadId, state.activeThreadId);
  }
  assert.equal(client.commands.length, 0); assert.equal(client.connections, 1); assert.equal(client.threadStarts, 3);
  await views.get("tab-two")!.request("setAppearance", { fontSizeCode: 10 });
  assert.deepEqual(preferences, { fontSizeInterface: 20, fontSizePrompt: 18, fontSizeCode: 10 });
  await views.get("tab-two")!.request("setAppearance", DEFAULT_APPEARANCE);
  assert.deepEqual(host.snapshot().appearance, DEFAULT_APPEARANCE);
});

test("The font bridge rejects invalid sizes and arbitrary VS Code settings before writing", async (t) => {
  let writes = 0;
  const { host, client } = await viewsHarness({ saveAppearance: async () => { writes += 1; } }); t.after(() => host.dispose());
  const view = new FakeWebview(); const bridge = new BridgeHandler(host, new WebviewRegistry()); bridge.attach(view.webview, SIDEBAR_VIEW_ID);
  for (const patch of [
    {}, null, [], { fontSizeInterface: 11 }, { fontSizeInterface: 21 }, { fontSizeInterface: 16.5 },
    { fontSizePrompt: 11 }, { fontSizePrompt: 21 }, { fontSizeCode: 9 }, { fontSizeCode: 19 },
    { fontSizeCode: "14" }, { fontSizeCode: NaN }, { fontSizeCode: Infinity }, { fontSizeCode: undefined },
    { fontSizeCode: 14, t3Home: "/tmp/unrelated" }, { "editor.fontSize": 20 },
  ]) await assert.rejects(view.request("setAppearance", patch), (cause: unknown) => cause instanceof Error, JSON.stringify(patch));
  assert.equal(writes, 0); assert.deepEqual(host.snapshot().appearance, DEFAULT_APPEARANCE); assert.equal(client.commands.length, 0);
});

test("Font settings remain available offline, survive host restart and reflect external settings edits", async (t) => {
  let preferences = DEFAULT_APPEARANCE;
  const options = { home: "/tmp/fake-t3-test", credentials, discover: async () => ({ ok: false as const, reason: "Server stopped." }),
    appearance: () => preferences, saveAppearance: async (update: Partial<AppearanceSettings>) => { preferences = { ...preferences, ...update }; } };
  const client = new FakeTransport(); const host = new HostState(options, client); t.after(() => host.dispose()); await host.start();
  const view = new FakeWebview(); new BridgeHandler(host, new WebviewRegistry()).attach(view.webview, SIDEBAR_VIEW_ID);
  const result = await view.request("setAppearance", { fontSizeInterface: 12, fontSizePrompt: 20, fontSizeCode: 18 });
  assert.equal(result.phase, "no-server"); assert.deepEqual(result.appearance, preferences);
  assert.equal(client.connections, 0); assert.equal(client.commands.length, 0);
  await host.dispose();
  const restarted = new HostState(options, new FakeTransport()); t.after(() => restarted.dispose()); await restarted.start();
  assert.deepEqual(restarted.snapshot().appearance, preferences);
  let latest = restarted.snapshot(); restarted.onDidChangeState((state) => { latest = state; });
  preferences = { fontSizeInterface: 17, fontSizePrompt: 14, fontSizeCode: 15 }; restarted.refreshAppearance();
  assert.deepEqual(latest.appearance, preferences);
});

test("Failed persistence reports an error and allows a subsequent font edit", async (t) => {
  let preferences = DEFAULT_APPEARANCE; let fail = true;
  const { host } = await viewsHarness({ appearance: () => preferences, saveAppearance: async (update) => {
    if (fail) throw new Error("Settings file is read-only.");
    preferences = { ...preferences, ...update };
  } }); t.after(() => host.dispose());
  const view = new FakeWebview(); new BridgeHandler(host, new WebviewRegistry()).attach(view.webview, SIDEBAR_VIEW_ID);
  await assert.rejects(view.request("setAppearance", { fontSizeCode: 18 }), /Settings file is read-only/);
  assert.deepEqual(host.snapshot().appearance, DEFAULT_APPEARANCE);
  fail = false; assert.equal((await view.request("setAppearance", { fontSizeCode: 18 })).appearance.fontSizeCode, 18);
});
