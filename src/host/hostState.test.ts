import test from "node:test";
import assert from "node:assert/strict";
import { OrchestrationV2Command, ProviderInstanceId, ThreadId, ProjectId, TurnItemId, EventId, type OrchestrationV2ShellStreamItem, type OrchestrationV2ThreadStreamItem, type OrchestrationV2TurnItem, type ServerProvider } from "@t3tools/contracts";
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
  shellHandler: ((item: OrchestrationV2ShellStreamItem) => void) | null = null;
  threadHandlers = new Map<string, (item: OrchestrationV2ThreadStreamItem) => void>();
  commands: OrchestrationV2Command[] = [];
  async connect() { this.connected = true; this.connections += 1; }
  async disconnect() { this.connected = false; }
  async snapshotShell() { return this.shell; }
  async subscribeShell(handler: (item: OrchestrationV2ShellStreamItem) => void) { this.shellStarts += 1; this.shellHandler = handler; return async () => { this.shellHandler = null; }; }
  async subscribeThread(id: string, handler: (item: OrchestrationV2ThreadStreamItem) => void) {
    this.threadHandlers.set(id, handler);
    handler({ kind: "snapshot", snapshotSequence: 0, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id) } } });
    return async () => { this.threadStops += 1; };
  }
  async dispatch(raw: unknown) {
    const command = Schema.decodeUnknownSync(OrchestrationV2Command)(raw); this.commands.push(command);
    if (command.type === "thread.create") this.shell = { ...this.shell, threads: [...this.shell.threads, { ...v2ThreadShell, id: command.threadId, projectId: command.projectId, modelSelection: command.modelSelection }] };
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
