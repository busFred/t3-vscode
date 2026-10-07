import test from "node:test";
import assert from "node:assert/strict";
import { ThreadId, ProjectId, RuntimeRequestId, NodeId, ProviderSessionId } from "@t3tools/contracts";
import { v2Now, v2Project, v2Projection } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { HostState, SIDEBAR_VIEW_ID, type HostTransport } from "./hostState.js";
import { FakeTransport, harness, provider, server, credentials, viewsHarness, publishText } from "./testing/fakeTransport.js";
import type { HostStateSnapshot } from "../shared/bridge.js";

function waitFor(host: HostState, viewId: string, predicate: (state: HostStateSnapshot) => boolean) {
  return new Promise<void>((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error("View state transition timed out.")); }, 3000);
    off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(); } }, viewId);
  });
}
test("Three conversation views select and stream independently on one connection", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab-one"); host.registerView("tab-two");
  assert.equal(host.snapshot("tab-one").activeThreadId, undefined);
  assert.deepEqual(host.snapshot("tab-one").transcript, []);
  await host.selectThread("second", "tab-one"); await host.selectThread("third", "tab-two");
  publishText(client, "first", "sidebar reply"); publishText(client, "second", "first tab reply"); publishText(client, "third", "second tab reply");
  const states = [host.snapshot(), host.snapshot("tab-one"), host.snapshot("tab-two")];
  assert.deepEqual(states.map((state) => state.activeThreadId), ["first", "second", "third"]);
  assert.deepEqual(states.map((state) => state.transcript[0]?.item).map((item) => item?.type === "assistant_message" ? item.text : null), ["sidebar reply", "first tab reply", "second tab reply"]);
  assert.ok(states.every((state) => state.projects.length === 1 && state.threads.length === 3));
  await host.selectThread("first", "tab-one");
  assert.equal(host.snapshot("tab-two").activeThreadId, "third");
  assert.equal(host.snapshot("tab-two").transcript[0]?.sourceThreadId, "third");
  assert.equal(client.connections, 1); assert.equal(client.shellStarts, 1);
  await assert.rejects(host.selectThread("outside-thread", "tab-two"), /current workspace/);
});
test("An editor handoff copies the current session once and keeps future selections independent", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("second");
  publishText(client, "second", "existing conversation");
  host.registerView("handoff", SIDEBAR_VIEW_ID);
  assert.equal(host.snapshot("handoff").activeThreadId, "second");
  assert.equal(host.snapshot("handoff").transcript[0]?.sourceThreadId, "second");
  assert.equal(client.threadStarts, 2, "Copying a session reuses its subscription");
  await host.selectThread("third");
  assert.equal(host.snapshot("handoff").activeThreadId, "second");
  await host.selectThread("first", "handoff");
  assert.equal(host.snapshot().activeThreadId, "third");
  await host.removeView("handoff");
  assert.throws(() => host.registerView("orphan", "handoff"), /closed/);
  assert.throws(() => host.snapshot("orphan"), /closed/);
});
test("The browser action opens the current session on the discovered local UI without credentials", async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  assert.equal(host.webUiUrl(), "http://audit.invalid/audit/first");
  host.registerView("second-view"); await host.selectThread("second", "second-view");
  assert.equal(host.webUiUrl("second-view"), "http://audit.invalid/audit/second");
  assert.equal(host.webUiUrl().includes("fake"), false);
});
test("The browser action uses localhost cookies for loopback servers without changing the transport origin", async (t) => {
  for (const origin of ["http://127.0.0.1:3773", "http://[::1]:3773", "https://t3.example.test:8443"]) {
    const discovered = { ...server, origin };
    const client = new FakeTransport();
    const host = new HostState({ home: "/tmp/fake-t3-browser", credentials: { ...credentials, get: async () => ({ ...(await credentials.get()), origin }) }, discover: async () => ({ ok: true, server: discovered }) }, client);
    t.after(() => host.dispose());
    await host.start();
    const id = host.snapshot().threads[0]!.id;
    await host.selectThread(id);
    const url = new URL(host.webUiUrl());
    assert.equal(url.hostname, origin.includes('example.test') ? 't3.example.test' : 'localhost');
    assert.equal(url.port, origin.includes('example.test') ? '8443' : '3773');
    assert.equal(url.pathname, `/audit/${encodeURIComponent(id)}`);
    assert.equal(discovered.origin, origin);
    assert.equal(url.search, '');
  }
});
test("Views of the same conversation share one subscription until its last view leaves", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab-one"); host.registerView("tab-two");
  await host.selectThread("first", "tab-one"); await host.selectThread("first", "tab-two");
  assert.equal(client.threadStarts, 1);
  await host.selectThread("second");
  await host.removeView("tab-one");
  assert.equal(client.threadStops, 0);
  publishText(client, "first", "still live");
  assert.equal(host.snapshot("tab-two").transcript.length, 1);
  const stale = client.threadHandlers.get("first")!;
  await host.removeView("tab-two");
  assert.equal(client.threadStops, 1);
  assert.deepEqual([...client.threadHandlers.keys()], ["second"]);
  stale({ kind: "snapshot", snapshotSequence: 50, projection: v2Projection });
  assert.equal(host.snapshot().activeThreadId, "second");
  assert.deepEqual(host.snapshot().transcript, []);
});
test("Draft model, modes, project choice and first-message selection belong to the originating tab", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, threads: [], projects: [v2Project, { ...v2Project, id: ProjectId.make("other"), workspaceRoot: "/tmp/other" }] };
  client.config = { providers: [{ ...provider, models: [...provider.models, { slug: "custom", name: "Custom", isCustom: true, capabilities: null }] }] };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  host.registerView("tab-one"); host.registerView("tab-two");
  const untouched = host.snapshot("tab-two").draft;
  await host.chooseProject("other", "tab-one");
  await host.setModel(undefined, { instanceId: "kimi", model: "custom" }, "tab-one");
  await host.setModes(undefined, { runtimeMode: "full-access", interactionMode: "plan" }, "tab-one");
  assert.deepEqual(host.snapshot("tab-two").draft, untouched);
  assert.deepEqual(host.snapshot().draft, untouched);
  await host.sendMessage("first message from tab one", undefined, "tab-one");
  const created = client.commands.find((command) => command.type === "thread.create")!;
  assert.equal(created.projectId, "other"); assert.equal(created.modelSelection.model, "custom");
  assert.equal(created.interactionMode, "plan"); assert.equal(created.runtimeMode, "full-access");
  assert.equal(host.snapshot("tab-one").activeThreadId, created.threadId);
  assert.equal(host.snapshot("tab-two").activeThreadId, undefined);
  assert.equal(host.snapshot().activeThreadId, undefined);
  const second = await host.newThread(v2Project.id, "tab-two");
  assert.equal(host.snapshot("tab-one").activeThreadId, created.threadId);
  assert.equal(host.snapshot("tab-two").activeThreadId, second);
});
test("Sending in one tab does not put other tabs into a sending state", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab-one"); await host.selectThread("second", "tab-one");
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async (command) => { await dispatch(command); await blocked; };
  const sending = host.sendMessage("message for second", "second", "tab-one");
  await waitFor(host, "tab-one", (state) => state.sending);
  assert.equal(host.snapshot().sending, false);
  finish(); await sending;
  assert.equal(host.snapshot("tab-one").sending, false);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, "second");
});
test("Reconnect preserves all tab selections and drafts and recreates each distinct subscription once", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab-one"); host.registerView("tab-two"); host.registerView("blank-tab");
  await host.selectThread("second", "tab-one"); await host.selectThread("third", "tab-two");
  await host.setModes(undefined, { interactionMode: "plan" }, "blank-tab");
  const ready = waitFor(host, SIDEBAR_VIEW_ID, (state) => state.phase === "ready" && client.connections === 2);
  client.connected = false; client.onClose?.(); await ready;
  assert.deepEqual([host.snapshot().activeThreadId, host.snapshot("tab-one").activeThreadId, host.snapshot("tab-two").activeThreadId], ["first", "second", "third"]);
  assert.equal(host.snapshot("blank-tab").activeThreadId, undefined);
  assert.equal(host.snapshot("blank-tab").draft.interactionMode, "plan");
  assert.equal(client.shellStarts, 2); assert.equal(client.threadStarts, 6); assert.equal(client.threadStops, 3);
});
test("A temporary server outage preserves open conversations and allows a tab to close while disconnected", async (t) => {
  const client = new FakeTransport(); let running = true;
  const host = new HostState({ home: "/tmp/fake-t3-test", credentials,
    discover: async () => running ? { ok: true, server } : { ok: false, reason: "Isolated server stopped." },
  }, client); t.after(() => host.dispose());
  await host.start();
  const original = host.snapshot().activeThreadId;
  host.registerView("tab-one"); host.registerView("blank-tab"); host.registerView("closing-tab");
  const id = await host.newThread(v2Project.id, "tab-one");
  await host.setModes(undefined, { interactionMode: "plan" }, "blank-tab");
  running = false; await host.reconnect();
  assert.equal(host.snapshot().phase, "no-server");
  await host.removeView("closing-tab");
  assert.equal(client.threadHandlers.size, 0);
  running = true; await host.reconnect();
  assert.equal(host.snapshot().phase, "ready");
  assert.equal(host.snapshot().activeThreadId, original);
  assert.equal(host.snapshot("tab-one").activeThreadId, id);
  assert.equal(host.snapshot("blank-tab").draft.interactionMode, "plan");
  assert.equal(host.snapshot("blank-tab").activeThreadId, undefined);
  assert.equal(client.threadHandlers.size, 2);
});
test("Open tab subscriptions are retained even with more than five distinct conversations", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const tabs = Array.from({ length: 6 }, (_, index) => `tab-${index}`);
  for (const id of tabs) { host.registerView(id); await host.newThread(v2Project.id, id); }
  assert.equal(client.threadHandlers.size, 7); assert.equal(client.threadStops, 0);
  for (const id of tabs) {
    const selected = host.snapshot(id).activeThreadId!;
    publishText(client, selected, `reply for ${id}`);
    assert.equal(host.snapshot(id).transcript[0]?.sourceThreadId, selected);
  }
  await host.removeView(tabs[0]!);
  assert.equal(client.threadHandlers.size, 6);
  assert.equal(host.snapshot(tabs[1]!).transcript.length, 1);
});
test("Closed tabs reject queued actions without reviving selection or creating server state", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab-one");
  const create = host.newThread(undefined, "tab-one");
  const closed = host.removeView("tab-one");
  await assert.rejects(create, /tab has been closed/); await closed;
  assert.throws(() => host.snapshot("tab-one"), /tab has been closed/);
  assert.equal(client.commands.length, 0); assert.equal(host.snapshot().activeThreadId, "first");
});
test("Approvals and an in-flight history page stay with their conversation when another tab switches", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab-one"); await host.selectThread("second", "tab-one");
  client.threadHandlers.get("second")!({ kind: "snapshot", snapshotSequence: 1, historyCursor: "older", hasMoreHistory: true,
    projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make("second") }, runtimeRequests: [{
      id: RuntimeRequestId.make("approval"), nodeId: NodeId.make("node"), providerTurnId: null, nativeRequestRef: null,
      kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session") }, createdAt: v2Now, resolvedAt: null,
    }] } });
  assert.equal(host.snapshot("tab-one").pending.approvals.length, 1);
  assert.equal(host.snapshot().pending.approvals.length, 0);
  let finish!: (page: Awaited<ReturnType<HostTransport["getHistory"]>>) => void;
  client.getHistory = async () => new Promise((resolve) => { finish = resolve; });
  const loading = host.loadHistory("second");
  await host.selectThread("third");
  assert.equal(host.snapshot("tab-one").history.loading, true);
  assert.equal(host.snapshot().history.loading, false);
  finish({ snapshotSequence: 1, items: [], nextCursor: null, hasMoreHistory: false }); await loading;
  assert.equal(host.snapshot("tab-one").pending.approvals.length, 1);
  assert.equal(host.snapshot("tab-one").history.loading, false);
  assert.equal(host.snapshot().activeThreadId, "third");
});
