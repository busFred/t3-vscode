import test from "node:test";
import assert from "node:assert/strict";
import { sessionTree, subagentStatus } from "./sessionTree.js";
import type { ThreadSummary, WireTurnItem } from "./bridge.js";

const thread = (id: string, fields: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, projectId: "project", title: id, status: "idle", modelSelection: { instanceId: "codex", model: "test" }, runtimeMode: "auto", interactionMode: "default", updatedAt: "2026-10-06T00:00:00Z", archived: false, pinned: false, activeRunId: null, ...fields });
const child = (id: string, parentThreadId: string, fields: Partial<ThreadSummary> = {}) => thread(id, { parentThreadId, relationshipToParent: "subagent", ...fields });
const ids = (nodes: ReturnType<typeof sessionTree>): unknown => nodes.map((node) => [node.thread.id, ids(node.children)]);

test("Sessions nest subagents beneath parents while ordinary forks and missing parents remain visible roots", () => {
  const threads = [thread("main"), child("child", "main"), child("grandchild", "child", { settled: true }), thread("other"), thread("fork", { relationshipToParent: "fork", parentThreadId: "main" }), child("orphan", "missing")];
  assert.deepEqual(ids(sessionTree(threads)), [["main", [["child", [["grandchild", []]]]]], ["other", []], ["fork", []], ["orphan", []]]);
  assert.deepEqual(ids(sessionTree(threads, [threads[2]!])), [["main", [["child", [["grandchild", []]]]]]]);
});

test("Cyclic and cross-project subagent lineage cannot hide sessions or recurse forever", () => {
  const threads = [child("first", "second"), child("second", "first"), child("outside", "first", { projectId: "other" }), child("self", "self")];
  assert.deepEqual(ids(sessionTree(threads)), threads.map((entry) => [entry.id, []]));
});

test("Each session shelf retains ancestor context without mixing active, settled and archived children", () => {
  const threads = [thread("parent"), child("active", "parent"), child("settled", "parent", { settled: true }), child("archived", "parent", { archived: true })];
  assert.deepEqual(ids(sessionTree(threads, threads.filter((entry) => !entry.archived && !entry.settled))), [["parent", [["active", []]]]]);
  assert.deepEqual(ids(sessionTree(threads, threads.filter((entry) => !entry.archived && entry.settled))), [["parent", [["settled", []]]]]);
  assert.deepEqual(ids(sessionTree(threads, threads.filter((entry) => entry.archived))), [["parent", [["archived", []]]]]);
});

test("Subagent hover status follows current child activity and input requests ahead of a settled parent result", () => {
  const item = { type: "subagent", status: "completed" } as Extract<WireTurnItem, { type: "subagent" }>;
  assert.equal(subagentStatus(item, thread("child", { activityRunStatus: "running" })), "running");
  assert.equal(subagentStatus(item, thread("child", { pendingRuntimeRequest: { id: "request", kind: "user_input", createdAt: "2026-10-06T00:00:00Z" } })), "input");
  assert.equal(subagentStatus(item), "completed");
});
