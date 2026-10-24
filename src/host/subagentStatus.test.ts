import test from "node:test";
import assert from "node:assert/strict";
import * as DateTime from "effect/DateTime";
import { NodeId, ProviderInstanceId, ThreadId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { v2Now, v2Projection } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { viewsHarness, FakeTransport } from "./testing/fakeTransport.js";
import { HostState } from "./hostState.js";

type Subagent = OrchestrationV2ThreadProjection["subagents"][number];
type Harness = Awaited<ReturnType<typeof viewsHarness>>;
/** The default sidebar selection is "first", so the watched parent is "third" and its provider subagent is "second". */
const PARENT = "third", CHILD = "second";
const STARTED = "2026-10-06T01:02:03.000Z";

function subagent(childThreadId: string | null, status: Subagent["status"], startedAt: string | null = STARTED): Subagent {
  return { id: NodeId.make(`node-${childThreadId ?? "none"}`), threadId: ThreadId.make(PARENT), runId: null, parentNodeId: NodeId.make("parent-node"),
    origin: "provider_native", createdBy: "agent",
    driver: "acp" as Subagent["driver"], providerInstanceId: ProviderInstanceId.make("codex"), providerThreadId: null,
    childThreadId: childThreadId ? ThreadId.make(childThreadId) : null, nativeTaskRef: null, prompt: "Investigate", title: "Investigate", model: null,
    status, result: null, startedAt: startedAt ? DateTime.makeUnsafe(startedAt) : null, completedAt: null, updatedAt: v2Now };
}
/** Makes CHILD a provider-native subagent of PARENT; both stay idle. */
function linkChild({ client }: Harness) {
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second"
    ? { ...entry, lineage: { ...entry.lineage, parentThreadId: ThreadId.make(PARENT), relationshipToParent: "subagent" as const }, creationSource: "provider" as const, status: "idle" as const, activityRunStatus: null } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
}
function publishSubagents(client: FakeTransport, parent: string, subagents: Subagent[], sequence = 1) {
  client.threadHandlers.get(parent)!({ kind: "snapshot", snapshotSequence: sequence,
    projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(parent) }, subagents } });
}
const row = (host: HostState, id: string) => host.snapshot().threads.find((entry) => entry.id === id)!;

test("watchSessions subscribes to an expanded parent, skips identical lists, unsubscribes when emptied and when the view is removed", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const base = client.threadStarts;
  assert.equal(client.threadHandlers.has("second"), false);
  await host.watchSessions(["second"]);
  assert.equal(client.threadHandlers.has("second"), true);
  assert.equal(client.threadStarts, base + 1);
  await host.watchSessions(["second"]);
  await host.watchSessions(["second"]);
  assert.equal(client.threadStarts, base + 1, "an identical list must not resubscribe");
  assert.equal(client.threadStops, 0);
  await host.watchSessions([]);
  assert.equal(client.threadHandlers.has("second"), false);
  assert.equal(client.threadStops, 1);
  assert.equal(client.threadHandlers.has("first"), true, "the active thread keeps its subscription");

  host.registerView("editor");
  await host.watchSessions(["second", "third"], "editor");
  assert.equal(client.threadHandlers.has("second") && client.threadHandlers.has("third"), true);
  await host.watchSessions(["third"], "editor");
  assert.equal(client.threadHandlers.has("second"), false, "a session no longer expanded is dropped");
  assert.equal(client.threadHandlers.has("third"), true);
  await host.removeView("editor");
  await host.watchSessions([]);
  assert.equal(client.threadHandlers.has("third"), false, "removeView drops the view's watched set");
});

test("A watched session stays subscribed while another view still watches it, and removeView forgets the closed view", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("editor");
  const base = client.threadStarts;
  await host.watchSessions(["second"]);
  await host.watchSessions(["second"], "editor");
  assert.equal(client.threadStarts, base + 1, "two views watching one thread share one subscription");
  await host.watchSessions([]);
  assert.equal(client.threadHandlers.has("second"), true, "the other view still watches it");
  await host.removeView("editor");
  await host.watchSessions([]);
  assert.equal(client.threadHandlers.has("second"), false);
});

test("An unknown view cannot watch sessions", async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  assert.throws(() => host.watchSessions(["second"], "missing"));
});

test("A running child in the parent's projection shows as running with the subagent's start time, and its idle parent reads as waiting on subagents", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  const { host, client } = h;
  linkChild(h);
  assert.equal(row(host, CHILD).activityRunStatus ?? null, null);
  assert.equal(row(host, PARENT).waitingOnSubagents, undefined);
  await host.watchSessions([PARENT]);
  publishSubagents(client, PARENT, [subagent(CHILD, "running")]);
  const child = row(host, CHILD);
  assert.equal(child.activityRunStatus, "running");
  assert.equal(child.workingStartedAt, STARTED);
  assert.equal(child.subagentOutcome, undefined);
  const parent = row(host, PARENT);
  assert.equal(parent.waitingOnSubagents, true);
  assert.equal(parent.workingStartedAt, STARTED, "the parent inherits the earliest child start");
});

test("Every working subagent status marks the child running; a missing startedAt yields a null start time", async (t) => {
  for (const status of ["pending", "waiting", "running"] as const) {
    const h = await viewsHarness(); t.after(() => h.host.dispose());
    linkChild(h);
    await h.host.watchSessions([PARENT]);
    publishSubagents(h.client, PARENT, [subagent(CHILD, status, null)]);
    const child = row(h.host, CHILD);
    assert.equal(child.activityRunStatus, "running", status);
    assert.equal(child.workingStartedAt, null, status);
  }
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  linkChild(h);
  await h.host.watchSessions([PARENT]);
  publishSubagents(h.client, PARENT, [subagent(CHILD, "idle")]);
  assert.equal(row(h.host, CHILD).activityRunStatus ?? null, null, "an idle subagent is not working");
});

test("A child that is itself working keeps its own status and start time", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  const { host, client } = h;
  linkChild(h);
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === CHILD ? { ...entry, activityRunStatus: "running" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const own = row(host, CHILD).workingStartedAt;
  await host.watchSessions([PARENT]);
  publishSubagents(client, PARENT, [subagent(CHILD, "running", STARTED)]);
  assert.equal(row(host, CHILD).workingStartedAt, own);
  assert.notEqual(row(host, CHILD).workingStartedAt, STARTED);
});

test("A subagent without a child thread, or for a different child, does not affect other rows", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  linkChild(h);
  await h.host.watchSessions([PARENT]);
  publishSubagents(h.client, PARENT, [subagent(null, "running"), subagent("first", "running")]);
  assert.equal(row(h.host, CHILD).activityRunStatus ?? null, null);
  assert.equal(row(h.host, "first").activityRunStatus, "running", "only the listed child changes");
});

test("A child named in a parent's background roster shows as working although no projection is loaded", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  const { host, client } = h;
  linkChild(h);
  assert.deepEqual([...client.threadHandlers.keys()], ["first"], "only the active thread is subscribed");
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === PARENT
    ? { ...entry, status: "completed" as const, activityRunStatus: null, pendingBackgroundTasks: [{ taskId: "task-1", kind: "subagent" as const, childThreadId: ThreadId.make(CHILD), description: "Investigate" }] } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const child = row(host, CHILD);
  assert.equal(child.activityRunStatus, "running");
  assert.equal(child.workingStartedAt, null);
  assert.equal(row(host, PARENT).waitingOnSubagents, true);
  assert.equal(client.threadHandlers.has(PARENT), false);
});

test("Background roster entries of other kinds, or without a child thread, do not mark any child working", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  const { host, client } = h;
  linkChild(h);
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === PARENT
    ? { ...entry, status: "completed" as const, activityRunStatus: null, pendingBackgroundTasks: [{ taskId: "task-1", kind: "command" as const, description: "dev server" }, { taskId: "task-2", kind: "subagent" as const, description: "no child" }] as typeof entry.pendingBackgroundTasks } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.equal(row(host, CHILD).activityRunStatus ?? null, null);
});

test("The projection's subagent status wins over a background roster entry for the same child", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  const { host, client } = h;
  linkChild(h);
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === PARENT
    ? { ...entry, status: "completed" as const, activityRunStatus: null, pendingBackgroundTasks: [{ taskId: "task-1", kind: "subagent" as const, childThreadId: ThreadId.make(CHILD), description: "Investigate" }] } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.watchSessions([PARENT]);
  publishSubagents(client, PARENT, [subagent(CHILD, "completed")]);
  assert.equal(row(host, CHILD).activityRunStatus ?? null, null, "the transcript says it finished");
});

test("A finished subagent reports its outcome: failed, stopped for cancelled and interrupted, nothing for completed", async (t) => {
  const cases: Array<[Subagent["status"], "failed" | "stopped" | undefined]> = [["failed", "failed"], ["cancelled", "stopped"], ["interrupted", "stopped"], ["completed", undefined]];
  for (const [status, outcome] of cases) {
    const h = await viewsHarness(); t.after(() => h.host.dispose());
    linkChild(h);
    await h.host.watchSessions([PARENT]);
    publishSubagents(h.client, PARENT, [subagent(CHILD, status)]);
    const child = row(h.host, CHILD);
    assert.equal(child.subagentOutcome, outcome, status);
    assert.equal(child.activityRunStatus ?? null, null, `${status} child is not working`);
    assert.equal(row(h.host, PARENT).waitingOnSubagents, undefined, `${status}: parent is not waiting`);
  }
});

test("A working subagent has no outcome, and a non-subagent thread never gets one", async (t) => {
  const h = await viewsHarness(); t.after(() => h.host.dispose());
  linkChild(h);
  await h.host.watchSessions([PARENT]);
  publishSubagents(h.client, PARENT, [subagent(CHILD, "running")]);
  for (const entry of h.host.snapshot().threads) assert.equal(entry.subagentOutcome, undefined, entry.id);
});

test("A failing subscription of a watched-only thread does not reject watchSessions, but the active thread still rejects", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const subscribe = client.subscribeThread.bind(client);
  client.subscribeThread = async (id, handler) => { if (id === "second") throw new Error(`subscribe ${id} failed`); return subscribe(id, handler); };
  await host.watchSessions(["second"]);
  assert.equal(client.threadHandlers.has("second"), false);
  await host.watchSessions(["second", "third"]);
  assert.equal(client.threadHandlers.has("third"), true, "a healthy watched thread is still subscribed");
  await assert.rejects(host.selectThread("second"), /subscribe second failed/);
  assert.equal(host.snapshot().activeThreadId, "second", "selection is still recorded");
});

test("A thread that is both watched and active keeps its subscription when the watch ends, and a failed active subscription still rejects even when watched", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.watchSessions(["first"]);
  const starts = client.threadStarts;
  await host.watchSessions([]);
  assert.equal(client.threadHandlers.has("first"), true, "still the active thread");
  assert.equal(client.threadStarts, starts);
  assert.equal(client.threadStops, 0);

  const subscribe = client.subscribeThread.bind(client);
  client.subscribeThread = async (id, handler) => { if (id === "third") throw new Error("boom"); return subscribe(id, handler); };
  await host.watchSessions(["third"]);
  await assert.rejects(host.selectThread("third"), /boom/);
});
