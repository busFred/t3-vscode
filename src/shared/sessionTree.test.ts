import test from "node:test";
import assert from "node:assert/strict";
import { sessionTree, sessionShelves, statusIsWorking, subagentStatus, threadIsWorking, withSubagentWorkingState } from "./sessionTree.js";
import type { ThreadSummary, WireTurnItem } from "./bridge.js";

const thread = (id: string, fields: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, projectId: "project", title: id, status: "idle", modelSelection: { instanceId: "codex", model: "test" }, runtimeMode: "auto", interactionMode: "default", updatedAt: "2026-10-06T00:00:00Z", archived: false, pinned: false, activeRunId: null, ...fields });
const child = (id: string, parentThreadId: string, fields: Partial<ThreadSummary> = {}) => thread(id, { parentThreadId, relationshipToParent: "subagent", ...fields });
const ids = (nodes: ReturnType<typeof sessionTree>): unknown => nodes.map((node) => [node.thread.id, ids(node.children)]);

test("Sessions nest subagents beneath parents while ordinary forks remain roots and orphan subagents stay out of the main list", () => {
  const threads = [thread("main"), child("child", "main"), child("grandchild", "child", { settled: true }), thread("other"), thread("fork", { relationshipToParent: "fork", parentThreadId: "main" }), child("orphan", "missing")];
  assert.deepEqual(ids(sessionTree(threads)), [["main", [["child", [["grandchild", []]]]]], ["other", []], ["fork", []]]);
  assert.deepEqual(ids(sessionTree(threads, [threads[2]!])), [["main", [["child", [["grandchild", []]]]]]]);
});

test("Missing, cyclic, self and cross-project subagent lineage never becomes a root or hides an ordinary conversation", () => {
  const threads = [thread("parent"), child("first", "second"), child("second", "first"), child("outside", "parent", { projectId: "other" }), child("self", "self"), child("orphan", "missing")];
  assert.deepEqual(ids(sessionTree(threads)), [["parent", []]]);
});

test("Shelves count ordinary roots by their own state, with active/settled/archived children beneath the same parent", () => {
  for (const state of [{}, { settled: true }, { archived: true, settled: true }]) {
    const threads = [thread("parent", state), child("active", "parent"), child("settled", "parent", { settled: true }), child("archived", "parent", { archived: true }), child("grandchild", "settled", { settled: true })];
    const shelves = sessionShelves(threads);
    const shelf = state.archived ? "archived" : state.settled ? "settled" : "active";
    assert.deepEqual(ids(shelves[shelf]), [["parent", [["active", []], ["settled", [["grandchild", []]]], ["archived", []]]]]);
    assert.equal(shelves.active.length + shelves.settled.length + shelves.archived.length, 1, "Children never contribute to shelf counts or duplicate the parent");
  }
});

test("A child search match retains its ancestors in the ordinary root's own shelf, never the child's shelf", () => {
  const threads = [thread("parent"), child("settled", "parent", { settled: true }), child("grandchild", "settled", { archived: true }), thread("other", { settled: true })];
  const shelves = sessionShelves(threads, [threads[2]!]);
  assert.deepEqual(ids(shelves.active), [["parent", [["settled", [["grandchild", []]]]]]]);
  assert.deepEqual(shelves.settled, []); assert.deepEqual(shelves.archived, []);
  const archivedParent = threads.map(t => t.id === "parent" ? { ...t, archived: true } : t);
  assert.deepEqual(ids(sessionShelves(archivedParent, [threads[1]!]).archived), [["parent", [["settled", []]]]]);
});

test("Ordinary forks of subagents remain independent conversations", () => {
  const threads = [thread("parent"), child("agent", "parent"), thread("fork", { parentThreadId: "agent", relationshipToParent: "fork", settled: true })];
  const shelves = sessionShelves(threads);
  assert.deepEqual(ids(shelves.active), [["parent", [["agent", []]]]]);
  assert.deepEqual(ids(shelves.settled), [["fork", []]]);
});

test("Subagent hover status follows current child activity and input requests ahead of a settled parent result", () => {
  const item = { type: "subagent", status: "completed" } as Extract<WireTurnItem, { type: "subagent" }>;
  assert.equal(subagentStatus(item, thread("child", { activityRunStatus: "running" })), "running");
  assert.equal(subagentStatus(item, thread("child", { pendingRuntimeRequest: { id: "request", kind: "user_input", createdAt: "2026-10-06T00:00:00Z" } })), "input");
  assert.equal(subagentStatus(item), "completed");
});

test("A subagent whose parent drives the run reads as working in the sidebar, not just in its card", () => {
  const running = { status: "idle", activityRunStatus: "running" } as const;
  // The child's own status lags the parent-driven run, which is why the sidebar showed no badge.
  assert.equal(threadIsWorking(running), true);
  assert.equal(subagentStatus({ type: "subagent", status: "completed" } as never, thread("child", running)), "running");
  for (const status of ["preparing", "running", "starting", "waiting"]) {
    assert.equal(threadIsWorking({ status, activityRunStatus: null }), true, `${status} must read as working`);
    assert.equal(threadIsWorking({ status: "idle", activityRunStatus: status }), true, `activity ${status} must read as working`);
  }
  for (const idle of ["idle", "completed", "failed", "cancelled"]) {
    assert.equal(threadIsWorking({ status: idle, activityRunStatus: null }), false, `${idle} must not read as working`);
    assert.equal(threadIsWorking({ status: idle, activityRunStatus: idle }), false, `activity ${idle} must not read as working`);
  }
});

test("The sidebar and the subagent card call the same statuses working", () => {
  // The card treated in_progress and pending as running while the sidebar did not, so a subagent in
  // either state showed Running in its card and no badge in the list — the bug this release closes.
  for (const status of ["preparing", "running", "starting", "waiting", "in_progress", "pending"]) {
    assert.equal(statusIsWorking(status), true, `${status} must read as working`);
    assert.equal(threadIsWorking({ status: "idle", activityRunStatus: status }), true, `activity ${status} must read as working`);
  }
  for (const done of ["idle", "completed", "failed", "error", "cancelled"]) assert.equal(statusIsWorking(done), false, `${done} must not read as working`);
});

test("A parent whose own run already completed still reads as working while a delegated subagent runs", () => {
  const threads = [thread("parent", { status: "completed", activityRunStatus: null }), child("agent", "parent", { status: "idle", activityRunStatus: "running", workingStartedAt: "2026-10-06T00:05:00Z" })];
  const [parent, agent] = withSubagentWorkingState(threads);
  assert.equal(threadIsWorking(parent!), true, "parent must keep reading as working while its subagent runs");
  assert.equal(parent!.waitingOnSubagents, true);
  assert.equal(parent!.workingStartedAt, "2026-10-06T00:05:00Z", "elapsed timer should use the subagent's start, not reset");
  assert.equal(agent!.waitingOnSubagents, undefined, "the subagent itself is working on its own, not waiting on anything");
});

test("A steer run completing while the delegated subagent is still running leaves the parent working", () => {
  // The steer message's own run finished, which used to overwrite activityRunStatus even though
  // the run that spawned the subagent was still logically open.
  const threads = [thread("parent", { status: "idle", activityRunStatus: "completed" }), child("agent", "parent", { status: "running", activityRunStatus: null })];
  const [parent] = withSubagentWorkingState(threads);
  assert.equal(threadIsWorking(parent!), true);
});

test("Once every subagent finishes, the parent stops reading as working", () => {
  const threads = [thread("parent", { status: "completed", activityRunStatus: null }), child("agent", "parent", { status: "completed", activityRunStatus: null })];
  const [parent, agent] = withSubagentWorkingState(threads);
  assert.equal(threadIsWorking(parent!), false);
  assert.equal(parent!.waitingOnSubagents, undefined);
  assert.equal(threadIsWorking(agent!), false);
});

test("Working state climbs through grandchildren but ignores archived or settled descendants", () => {
  const threads = [
    thread("parent", { status: "completed" }),
    child("agent", "parent", { status: "completed" }),
    child("grandchild", "agent", { status: "running" }),
    child("archivedAgent", "parent", { status: "running", archived: true }),
    child("settledAgent", "parent", { status: "running", settled: true }),
  ];
  const [parent, agent] = withSubagentWorkingState(threads);
  assert.equal(threadIsWorking(parent!), true, "a working grandchild must bubble up through an idle child");
  assert.equal(threadIsWorking(agent!), true, "the idle child between parent and the working grandchild must also read as working");
});

test("A self-referencing subagent lineage cannot make withSubagentWorkingState loop forever", () => {
  const threads = [thread("parent", { status: "completed" }), child("loop", "loop", { status: "running" })];
  assert.doesNotThrow(() => withSubagentWorkingState(threads));
  const [parent] = withSubagentWorkingState(threads);
  assert.equal(threadIsWorking(parent!), false, "the unrelated self-referencing thread must not bleed into the parent's state");
});

test("Session sorting uses last activity, natural titles, pinned precedence and sibling-only ordering", () => {
  const threads = [thread("z", { title: "Task 10", lastActiveAt: "2026-10-01T00:00:00Z" }), thread("a", { title: "Task 2", lastActiveAt: "2026-10-08T00:00:00Z" }), child("child", "z", { title: "AAA", lastActiveAt: "2026-10-09T00:00:00Z" }), thread("pin", { pinned: true, title: "ZZZ" })];
  const roots = (order: Parameters<typeof sessionTree>[2]) => sessionTree(threads, threads, order).map(node => node.thread.id);
  assert.deepEqual(roots("date-desc"), ["pin", "a", "z"]);
  assert.deepEqual(roots("date-asc"), ["pin", "z", "a"]);
  assert.deepEqual(roots("title-asc"), ["pin", "a", "z"]);
  assert.deepEqual(roots("title-desc"), ["pin", "z", "a"]);
  assert.deepEqual(sessionTree(threads, threads, "title-asc")[2]!.children.map(node => node.thread.id), ["child"]);
  const invalid = thread("invalid", { lastActiveAt: "bad", updatedAt: "bad" });
  for (const order of ["date-asc", "date-desc"] as const) assert.equal(sessionTree([...threads, invalid], [...threads, invalid], order).at(-1)!.thread.id, "invalid");
});
