import test from "node:test";
import assert from "node:assert/strict";
import { NodeId, ProviderInstanceId, ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";
import { v2Now, v2Projection } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";

test("Subagent lineage remains scoped and native children are read-only while app-owned children can receive messages", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("editor");
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, lineage: { ...entry.lineage, parentThreadId: ThreadId.make("first"), relationshipToParent: "subagent" as const }, creationSource: "provider" as const, activityRunStatus: "running" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.selectThread("second", "editor");
  const child = host.snapshot("editor").threads.find((entry) => entry.id === "second")!;
  assert.equal(child.parentThreadId, "first"); assert.equal(child.providerNativeSubagent, true); assert.equal(child.activityRunStatus, "running");
  const sidebarId = host.snapshot().activeThreadId;
  await assert.rejects(host.sendMessage("Cannot send to native child", "second", "editor"), /controlled by its provider/);
  await host.selectThread("first", "editor"); assert.equal(host.snapshot().activeThreadId, sidebarId);
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, creationSource: "mcp" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.selectThread("second", "editor"); await host.sendMessage("App-owned follow-up", "second", "editor");
  assert.ok(client.commands.some((command) => command.type === "message.dispatch" && command.threadId === "second"));
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, lineage: { ...entry.lineage, parentThreadId: ThreadId.make("outside-thread") } } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.equal(host.snapshot("editor").threads.find((entry) => entry.id === "second")!.parentThreadId, null);
});

test("A parent thread reads as waiting on subagents while its delegated child is still running, and stops once the child settles", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, lineage: { ...entry.lineage, parentThreadId: ThreadId.make("first"), relationshipToParent: "subagent" as const }, creationSource: "provider" as const, activityRunStatus: "running" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const parent = host.snapshot().threads.find((entry) => entry.id === "first")!;
  assert.equal(parent.waitingOnSubagents, true, "an idle parent must still read as working while its delegated child runs");
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, activityRunStatus: null, status: "completed" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const settledParent = host.snapshot().threads.find((entry) => entry.id === "first")!;
  assert.equal(settledParent.waitingOnSubagents, undefined, "once the child settles the parent must stop reading as working");
});

test("A parent reads as waiting when the server's background roster holds completion, even though its own run and its child thread have both settled", async (t) => {
  // #13625-style scenario: the delegated child's own thread record settles after its first run,
  // so the descendant-scan fallback finds nothing, but the server's pendingBackgroundTasks roster
  // still names a subagent task — that roster is the primary signal.
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "first" ? { ...entry, status: "completed" as const, activityRunStatus: null, pendingBackgroundTasks: [{ taskId: "task-1", kind: "subagent" as const, childThreadId: ThreadId.make("second"), description: "Investigate flaky test" }] } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const parent = host.snapshot().threads.find((entry) => entry.id === "first")!;
  assert.deepEqual(parent.backgroundWork, { subagents: 1, monitors: 0, tasks: 0, commands: 0, holdsCompletion: true, startedAt: null });
  assert.equal(parent.waitingOnSubagents, undefined, "the descendant-scan fallback found nothing; the roster is a separate signal");
});

test("A command left running in the background roster does not hold the thread's completion", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "first" ? { ...entry, status: "completed" as const, activityRunStatus: null, pendingBackgroundTasks: [{ taskId: "task-1", kind: "command" as const, description: "dev server" }] } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const parent = host.snapshot().threads.find((entry) => entry.id === "first")!;
  assert.equal(parent.backgroundWork?.holdsCompletion, false, "a long-lived command the agent left running must not hold the thread as waiting");
});

test("A parent's own transcript still showing a running subagent turn item is a fallback waiting signal for servers without a roster", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  const item: Extract<OrchestrationV2TurnItem, { type: "subagent" }> = { id: TurnItemId.make("subagent-1"), threadId: ThreadId.make("first"), type: "subagent", title: "Investigate flaky test",
    subagentId: NodeId.make("subagent-node-1"), origin: "app_owned", driver: "acp" as Extract<OrchestrationV2TurnItem, { type: "subagent" }>["driver"], providerInstanceId: ProviderInstanceId.make("codex"),
    childThreadId: ThreadId.make("second"), prompt: "Investigate flaky test", progress: undefined, result: null, status: "running", ordinal: 0, runId: null, nodeId: null,
    providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null, startedAt: v2Now, completedAt: null, updatedAt: v2Now };
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 1,
    projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make("first") }, turnItems: [item],
      visibleTurnItems: [{ sourceThreadId: ThreadId.make("first"), sourceItemId: item.id, position: 0, visibility: "local", item }] } });
  const parent = host.snapshot().threads.find((entry) => entry.id === "first")!;
  assert.equal(parent.waitingOnSubagents, true, "a running subagent turn item in the thread's own transcript must read as waiting");
});
