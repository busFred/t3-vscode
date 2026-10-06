import test from "node:test";
import assert from "node:assert/strict";
import { ProviderSessionId, ProviderThreadId, RunId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";

test("Deleting a conversation releases its subscriptions while unrelated tabs remain selected", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("same-thread"); host.registerView("other-thread");
  await host.selectThread("first", "same-thread"); await host.selectThread("second", "other-thread");
  await host.threadAction("first", "delete");
  assert.equal(host.snapshot().activeThreadId, "second"); assert.equal(host.snapshot("same-thread").activeThreadId, undefined);
  assert.equal(host.snapshot("other-thread").activeThreadId, "second");
  assert.equal(client.threadHandlers.has("first"), false); assert.equal(client.threadHandlers.has("second"), true);
  assert.equal(host.snapshot().threads.some((thread) => thread.id === "first"), false);
  await assert.rejects(host.threadAction("outside-thread", "delete"), /current workspace/);
  assert.deepEqual(client.commands.map((command) => command.type), ["thread.delete"]);
});

test("Native thread prompts can be cancelled and cannot act after the originating tab closes", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("tab"); await host.selectThread("second", "tab");
  const registry = new WebviewRegistry(); const view = new FakeWebview(); registry.add("tab", view.webview);
  let confirmed = false; let prompts = 0; let rename: string | undefined;
  let confirm = async (title: string) => { prompts += 1; assert.equal(title, "first conversation"); return confirmed; };
  const bridge = new BridgeHandler(host, registry, async () => {}, { rename: async () => rename, confirmDelete: (title) => confirm(title) });
  bridge.attach(view.webview, "tab");
  await view.request("threadAction", { threadId: "first", action: "delete" });
  await view.request("threadAction", { threadId: "first", action: "rename" });
  assert.equal(client.commands.length, 0); assert.equal(host.snapshot("tab").activeThreadId, "second");
  await assert.rejects(view.request("threadAction", { threadId: "outside-thread", action: "delete" }), /current workspace/);
  assert.equal(prompts, 1);
  rename = "Renamed from context menu";
  await view.request("threadAction", { threadId: "first", action: "rename" });
  assert.equal(host.snapshot().threads.find((thread) => thread.id === "first")?.title, rename);
  assert.equal(host.snapshot("tab").activeThreadId, "second");
  let opened!: () => void; let accept!: (value: boolean) => void;
  const promptOpened = new Promise<void>((resolve) => { opened = resolve; });
  confirm = async () => { opened(); return new Promise<boolean>((resolve) => { accept = resolve; }); };
  const pending = view.request("threadAction", { threadId: "first", action: "delete" });
  await promptOpened; await host.removeView("tab"); accept(true);
  await assert.rejects(pending, /tab has been closed/);
  assert.deepEqual(client.commands.map((command) => command.type), ["thread.metadata.update"]);
});

test("Archive, restore, pin, rename and confirmed delete operate on the context target without switching conversations", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const bridge = new BridgeHandler(host, new WebviewRegistry(), async () => {}, { rename: async () => "Changed title", confirmDelete: async () => true });
  for (const action of ["pin", "unpin", "rename", "archive", "unarchive", "archive"]) {
    await bridge.performThreadAction("second", action);
    assert.equal(host.snapshot().activeThreadId, "first");
    assert.equal(host.snapshot().threads.find((thread) => thread.id === "second")?.archived, action === "archive");
  }
  await bridge.performThreadAction("second", "delete");
  assert.equal(host.snapshot().threads.some((thread) => thread.id === "second"), false);
  assert.equal(client.archive.threads.length, 0);
  assert.equal(host.snapshot().activeThreadId, "first");
});

test("Forking uses the trusted response's run and opens the child only in its originating view", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("fork-tab"); host.registerView("other-tab");
  await host.selectThread("first", "fork-tab"); await host.selectThread("third", "other-tab");
  publishText(client, "first", "Fork this completed reply", 1, { runId: RunId.make("trusted-run") });
  assert.equal(host.snapshot("fork-tab").transcript[0]?.canFork, true);
  const id = await host.forkFromResponse("first", "first", "text-first", "fork-tab");
  assert.equal(host.snapshot("fork-tab").activeThreadId, id);
  assert.equal(host.snapshot().activeThreadId, "first"); assert.equal(host.snapshot("other-tab").activeThreadId, "third");
  assert.equal(host.snapshot("fork-tab").transcript[0]?.sourceThreadId, "first");
  assert.equal(host.snapshot("fork-tab").transcript[0]?.item.type, "assistant_message");
  const fork = client.commands.find((command) => command.type === "thread.fork")!;
  assert.deepEqual(fork.sourcePoint, { type: "run", runId: "trusted-run" });
  assert.equal(fork.sourceThreadId, "first"); assert.equal(fork.targetThreadId, id);
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.projectId, host.snapshot().threads.find((thread) => thread.id === "first")?.projectId);
  // Inherited responses still fork from the original persisted source/run.
  const secondId = await host.forkFromResponse(id, "first", "text-first", "fork-tab");
  assert.equal(client.commands.at(-1)?.type, "thread.fork"); assert.equal(host.snapshot("fork-tab").activeThreadId, secondId);
});

test("A forged response, a streamed response, or a known incapable provider cannot fork", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "Legacy text");
  assert.equal(host.snapshot().transcript[0]?.canFork, false);
  await assert.rejects(host.forkFromResponse("first", "first", "text-first"), /cannot be forked/);
  publishText(client, "first", "Streaming", 2, { runId: RunId.make("run"), status: "running", streaming: true });
  assert.equal(host.snapshot().transcript[0]?.canFork, false);
  await assert.rejects(host.forkFromResponse("first", "first", "text-first"), /cannot be forked/);
  publishText(client, "first", "Complete", 3, { runId: RunId.make("run") });
  await assert.rejects(host.forkFromResponse("first", "first", "invented-item"), /cannot be forked/);
  await assert.rejects(host.forkFromResponse("outside-thread", "outside-thread", "text-first"), /current workspace/);
  const providerThreadId = ProviderThreadId.make("incapable-thread"); const sessionId = ProviderSessionId.make("incapable-session");
  // This focused transport fixture only needs the capability evidence consumed by the vendored workflow.
  const evidence = { providerThreads: [{ id: providerThreadId, providerSessionId: sessionId }], providerSessions: [{ id: sessionId,
    capabilities: { threads: { canForkThread: false, canForkFromTurn: false }, identity: { nativeThreadIds: "none" }, context: { supportsFullThreadHandoff: false } } }] } as unknown as Partial<OrchestrationV2ThreadProjection>;
  publishText(client, "first", "Incapable", 4, { runId: RunId.make("run"), providerThreadId }, evidence);
  assert.equal(host.snapshot().transcript[0]?.canFork, false);
  await assert.rejects(host.forkFromResponse("first", "first", "text-first"), /cannot be forked/);
  assert.equal(client.commands.length, 0);
});
