import test from "node:test";
import assert from "node:assert/strict";
import { OrchestrationV2Command, ProviderInstanceId, ThreadId, ProjectId, TurnItemId, EventId, RuntimeRequestId, NodeId, ProviderSessionId, type OrchestrationV2ShellStreamItem, type OrchestrationV2ThreadStreamItem, type OrchestrationV2TurnItem, type OrchestrationV2ArchivedShellSnapshot, type OrchestrationV2ArchivedShellStreamItem, type OrchestrationV2ProjectedTurnItem, type OrchestrationV2RuntimeRequest, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { v2Now, v2Project, v2ThreadShell, v2Projection, v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { HostState, type HostTransport } from "./hostState.js";
import type { DiscoveredServer } from "./serverDiscovery.js";
import type { HostStateSnapshot } from "../shared/bridge.js";

const provider: ServerProvider = { instanceId: ProviderInstanceId.make("kimi"), driver: "acp" as ServerProvider["driver"], displayName: "Kimi", enabled: true, installed: true, version: null, status: "ready", auth: { status: "authenticated" }, checkedAt: "2026-10-06T00:00:00Z", models: [{ slug: "kimi-for-coding", name: "Kimi", isCustom: false, capabilities: null }], slashCommands: [], skills: [] };
const server = { origin: "http://audit.invalid", descriptor: { environmentId: "audit", label: "Audit" } } as DiscoveredServer;
const credentials = { get: async () => ({ origin: server.origin, environmentId: server.descriptor.environmentId, accessToken: "fake", expiresAt: Date.now() + 100_000, scopes: [] }), save: async () => {}, clear: async () => {} };
class FakeTransport implements HostTransport {
  connected = false;
  config = { providers: [provider] };
  onClose: HostTransport["onClose"] = null;
  onConfig: HostTransport["onConfig"] = null;
  connections = 0; shellStarts = 0; threadStops = 0;
  shell = structuredCloneShell();
  archive: OrchestrationV2ArchivedShellSnapshot = { ...v2ShellSnapshot, threads: [] };
  archiveHandler: ((item: OrchestrationV2ArchivedShellStreamItem) => void) | null = null;
  archiveStarts = 0;
  shellHandler: ((item: OrchestrationV2ShellStreamItem) => void) | null = null;
  threadHandlers = new Map<string, (item: OrchestrationV2ThreadStreamItem) => void>();
  commands: OrchestrationV2Command[] = [];
  async connect() { this.connected = true; this.connections += 1; }
  async disconnect() { this.connected = false; }
  async snapshotShell() { return this.shell; }
  async snapshotArchive() { return this.archive; }
  subscribeArchive: HostTransport["subscribeArchive"] = async (handler) => {
    this.archiveStarts += 1; this.archiveHandler = handler;
    return async () => { this.archiveHandler = null; };
  };
  async subscribeShell(handler: (item: OrchestrationV2ShellStreamItem) => void) { this.shellStarts += 1; this.shellHandler = handler; return async () => { this.shellHandler = null; }; }
  async subscribeThread(id: string, handler: (item: OrchestrationV2ThreadStreamItem) => void) {
    this.threadHandlers.set(id, handler);
    handler({ kind: "snapshot", snapshotSequence: 0, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id) } } });
    return async () => { this.threadStops += 1; };
  }
  async dispatch(raw: unknown) {
    const command = Schema.decodeUnknownSync(OrchestrationV2Command)(raw); this.commands.push(command);
    if (command.type === "thread.create") this.shell = { ...this.shell, threads: [...this.shell.threads, { ...v2ThreadShell, id: command.threadId, projectId: command.projectId, modelSelection: command.modelSelection }] };
    if (command.type === "thread.archive") {
      const thread = this.shell.threads.find((thread) => thread.id === command.threadId)!;
      this.shell = { ...this.shell, threads: this.shell.threads.filter((thread) => thread.id !== command.threadId) };
      this.archive = { ...this.archive, threads: [...this.archive.threads, { ...thread, archivedAt: v2Now }] };
    }
    if (command.type === "thread.unarchive") {
      const thread = this.archive.threads.find((thread) => thread.id === command.threadId)!;
      this.archive = { ...this.archive, threads: this.archive.threads.filter((thread) => thread.id !== command.threadId) };
      this.shell = { ...this.shell, threads: [...this.shell.threads, { ...thread, archivedAt: null }] };
    }
  }
  async createProject(workspaceRoot: string, title: string) {
    const id = ProjectId.make("workspace-project");
    this.shell = { ...this.shell, projects: [...this.shell.projects, { ...v2Project, id, workspaceRoot, title }] }; return id;
  }
  async ensureScratchProject() { return v2Project.id; }
  getHistory: HostTransport["getHistory"] = async () => ({ snapshotSequence: 0, items: [], nextCursor: null, hasMoreHistory: false });
  getTurnItem: HostTransport["getTurnItem"] = async () => ({ item: null });
}
function structuredCloneShell() { return { ...v2ShellSnapshot, projects: [...v2ShellSnapshot.projects], threads: [...v2ShellSnapshot.threads], archivedThreads: [] }; }
async function harness(options: { workspaceRoot?: () => string | null } = {}) {
  const client = new FakeTransport();
  const host = new HostState({ home: "/tmp/fake-t3-test", credentials, discover: async () => ({ ok: true, server }), reconnectDelayMs: 0, ...options }, client);
  await host.start(); return { host, client };
}
function waitFor(host: HostState, predicate: (state: HostStateSnapshot) => boolean) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error("State transition timed out")); }, 3000);
    let off = () => {};
    off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(); } });
  });
}
function message(id: string, text: string, ordinal = 0): OrchestrationV2TurnItem {
  return { id: TurnItemId.make(id), threadId: v2ThreadShell.id, type: "assistant_message", messageId: "message" as Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>["messageId"], text, streaming: false, title: null, status: "completed", ordinal, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null, startedAt: v2Now, completedAt: v2Now, updatedAt: v2Now };
}

test("Missing server retries preserve credentials and recover after the server is started externally", async (t) => {
  const client = new FakeTransport();
  let running = false;
  let credentialReads = 0;
  let credentialWrites = 0;
  let pairingAttempts = 0;
  const host = new HostState({
    home: "/tmp/fake-t3-test",
    credentials: {
      get: async () => { credentialReads += 1; return credentials.get(); },
      save: async () => { credentialWrites += 1; },
      clear: async () => { credentialWrites += 1; },
    },
    discover: async () => running ? { ok: true, server } : { ok: false, reason: "Start the isolated server first." },
    pair: async () => { pairingAttempts += 1; throw new Error("Pairing requires a running server."); },
  }, client);
  t.after(() => host.dispose());
  await host.start();
  await host.reconnect();
  await host.pairNow();
  assert.equal(host.snapshot().phase, "no-server");
  assert.equal(host.snapshot().notice, "Start the isolated server first.");
  assert.equal(credentialReads, 0);
  assert.equal(pairingAttempts, 0);
  assert.equal(client.connections, 0);

  running = true;
  await host.reconnect();
  assert.equal(host.snapshot().phase, "ready");
  assert.equal(host.snapshot().notice, undefined);
  assert.equal(client.connections, 1);
  assert.equal(credentialReads, 1);
  assert.equal(credentialWrites, 0);
  assert.equal(pairingAttempts, 0);
  assert.ok(host.snapshot().threads.length > 0);
});

test("New Thread focuses the created thread and uses the server's ACP model catalog", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const id = await host.newThread();
  assert.equal(host.snapshot().activeThreadId, id);
  const created = client.commands.find((command) => command.type === "thread.create");
  assert.equal(created?.modelSelection.instanceId, "kimi");
  await host.sendMessage("hello", id);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, id);
});
test("A queued send keeps its explicit thread target when another view changes selection", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const old = host.snapshot().activeThreadId!;
  await host.newThread(); await host.sendMessage("for the original conversation", old);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, old);
});
test("New threads default to the open workspace without filtering other projects", async (t) => {
  const { host, client } = await harness({ workspaceRoot: () => "/tmp/another-workspace" }); t.after(() => host.dispose());
  await host.newThread();
  assert.equal(host.snapshot().projects.length, 2);
  assert.equal(client.commands.find((command) => command.type === "thread.create")?.projectId, "workspace-project");
});
test("Automatic reconnect recreates shell and thread subscriptions", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const ready = waitFor(host, (state) => state.phase === "ready" && client.connections === 2);
  client.connected = false; client.onClose?.(); await ready;
  assert.equal(client.shellStarts, 2); assert.ok(client.threadStops >= 1);
});
test("Direct thread.updated shell deltas update the shared list", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  client.shellHandler?.({ kind: "thread.updated", sequence: 1, location: "active", thread: { ...v2ThreadShell, title: "Updated elsewhere" } });
  assert.equal(host.snapshot().threads[0]?.title, "Updated elsewhere");
});
test("Stream projection retains rich items and rejects duplicate or stale sequences", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const event = (sequence: number, text: string): OrchestrationV2ThreadStreamItem => ({ kind: "event", sequence, event: { id: EventId.make(`event-${sequence}`), type: "turn-item.updated", threadId: v2ThreadShell.id, occurredAt: v2Now, payload: message("assistant", text) } as Extract<OrchestrationV2ThreadStreamItem, { kind: "event" }>["event"] });
  handler(event(2, "new content")); handler(event(1, "stale"));
  const item = host.snapshot().transcript[0]?.item;
  assert.ok(item?.type === "assistant_message"); assert.equal(item.text, "new content");
  assert.equal(typeof item.updatedAt, "string");
});
test("A switched-away thread cannot overwrite the current view through a late callback", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const oldHandler = client.threadHandlers.get(v2ThreadShell.id)!;
  const id = await host.newThread();
  oldHandler({ kind: "snapshot", snapshotSequence: 99, projection: { ...v2Projection, turnItems: [message("late", "old conversation")] } });
  assert.equal(host.snapshot().activeThreadId, id); assert.equal(host.snapshot().transcript.length, 0);
});
test("Model selection rejects unavailable providers before sending a command", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  await assert.rejects(host.setModel(v2ThreadShell.id, { instanceId: "missing", model: "invented" }), /unavailable/);
  assert.equal(client.commands.length, 0);
});

test("Archiving keeps a thread discoverable and restorable outside the active shell", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const id = host.snapshot().activeThreadId!;
  await host.threadAction(id, "archive");
  assert.equal(client.shell.threads.length, 0);
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.archived, true);
  await assert.rejects(host.sendMessage("should not send", id), /Restore this thread/);
  await host.reconnect();
  assert.equal(client.archiveStarts, 2);
  assert.equal(host.snapshot().activeThreadId, id);
  await host.threadAction(id, "unarchive");
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.archived, false);
  await host.sendMessage("restored", id);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, id);
});

test("Archive updates from other clients appear on demand and reject stale deltas", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const archived = { ...v2ThreadShell, id: ThreadId.make("archived"), archivedAt: v2Now };
  client.archive = { ...client.archive, threads: [archived] };
  assert.equal(host.snapshot().threads.length, 1);
  await host.loadArchive();
  assert.equal(host.snapshot().threads.length, 2);
  client.archiveHandler?.({ kind: "thread.updated", sequence: 5, thread: { ...archived, title: "Renamed in T3" } });
  client.archiveHandler?.({ kind: "thread.updated", sequence: 4, thread: { ...archived, title: "Stale" } });
  assert.equal(host.snapshot().threads.find((thread) => thread.id === archived.id)?.title, "Renamed in T3");
  client.archiveHandler?.({ kind: "thread.removed", sequence: 6, threadId: archived.id });
  assert.equal(host.snapshot().threads.length, 1);
});

const projected = (item: OrchestrationV2TurnItem, position: number): OrchestrationV2ProjectedTurnItem => ({
  item, position, sourceItemId: item.id, sourceThreadId: item.threadId, visibility: "local",
});
test("An older history response preserves newer live text while the page is in flight", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const recent = message("recent", "streaming text", 1);
  handler({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, turnItems: [recent], visibleTurnItems: [projected(recent, 0)] }, historyCursor: "older-page", hasMoreHistory: true });
  let finish!: (page: Awaited<ReturnType<HostTransport["getHistory"]>>) => void;
  client.getHistory = async () => new Promise((resolve) => { finish = resolve; });
  const loading = host.loadHistory(v2ThreadShell.id);
  assert.equal(host.snapshot().history.loading, true);
  handler({ kind: "event", sequence: 2, event: { id: EventId.make("newer"), type: "turn-item.updated", threadId: v2ThreadShell.id, occurredAt: v2Now, payload: message("recent", "final live text", 1) } });
  finish({ snapshotSequence: 1, items: [projected(message("old", "earlier message"), 0), projected(recent, 1)], nextCursor: null, hasMoreHistory: false });
  await loading;
  assert.deepEqual(host.snapshot().transcript.map(({ item }) => item.type === "assistant_message" ? item.text : null), ["earlier message", "final live text"]);
  assert.equal(host.snapshot().history.hasMore, false);
  assert.equal(host.snapshot().history.loading, false);
});

test("Approvals validate pending and resumable state before dispatching a response", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const request: OrchestrationV2RuntimeRequest = { id: RuntimeRequestId.make("approval"), nodeId: NodeId.make("node"), providerTurnId: null, nativeRequestRef: null, kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session") }, createdAt: v2Now, resolvedAt: null };
  handler({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, runtimeRequests: [request] } });
  assert.equal(host.snapshot().pending.approvals[0]?.responseCapability, "live");
  await host.respondToRequest({ threadId: v2ThreadShell.id, requestId: request.id, decision: "accept" });
  assert.equal(client.commands.findLast((command) => command.type === "runtime-request.respond")?.decision, "accept");
  handler({ kind: "snapshot", snapshotSequence: 2, projection: { ...v2Projection, runtimeRequests: [{ ...request, responseCapability: { type: "not_resumable", reason: "Provider ended" } }] } });
  await assert.rejects(host.respondToRequest({ threadId: v2ThreadShell.id, requestId: request.id, decision: "accept" }), /provider process has ended/i);
  handler({ kind: "snapshot", snapshotSequence: 3, projection: { ...v2Projection, runtimeRequests: [{ ...request, status: "resolved" }] } });
  assert.equal(host.snapshot().pending.approvals.length, 0);
  await assert.rejects(host.respondToRequest({ threadId: v2ThreadShell.id, requestId: request.id, decision: "accept" }), /no longer pending/);
});
