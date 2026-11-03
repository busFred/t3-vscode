import test from "node:test";
import assert from "node:assert/strict";
import { sessionTree } from "./sessionTree.js";
import type { ThreadSummary } from "./bridge.js";

const parent = { id: "parent", projectId: "local-project", environmentId: "local", title: "Parent", status: "idle", modelSelection: {},
  archived: false, settled: false, pinned: false, activeRunId: null, updatedAt: "2026-01-01" } as ThreadSummary;
const task = { id: "task", environmentId: "remote", threadId: "child", label: "Studio", title: "Remote investigation", status: "running", startedAt: null };
const child = { ...parent, id: "child", projectId: "remote-project", environmentId: "remote", title: "Live title", activityRunStatus: "running" };

test("paired remote task uses the real child id and live state across projects", () => {
  const tree = sessionTree([{ ...parent, remoteSubagents: [task] }, child]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.children.length, 1);
  const remote = tree[0]!.children[0]!.thread;
  assert.equal(remote.id, child.id);
  assert.equal(remote.title, child.title);
  assert.equal(remote.activityRunStatus, "running");
  assert.equal(remote.environmentLabel, "Studio");
  assert.equal(remote.readOnlyHint, undefined);
});

test("unpaired remote task is read-only and cannot resolve to a same-id local thread", () => {
  const tree = sessionTree([{ ...parent, remoteSubagents: [task] }, { ...child, environmentId: "local" }]);
  const remote = tree.find(node => node.thread.id === parent.id)!.children[0]!.thread;
  assert.notEqual(remote.id, child.id);
  assert.equal(remote.title, task.title);
  assert.equal(remote.status, "running");
  assert.equal(remote.environmentLabel, "Studio");
  assert.match(remote.readOnlyHint!, /not paired/);
});

test("remote task never duplicates an existing local subagent relationship", () => {
  const tree = sessionTree([{ ...parent, remoteSubagents: [task, { ...task, id: "retry" }] },
    { ...child, projectId: parent.projectId, relationshipToParent: "subagent", parentThreadId: parent.id }]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.children.length, 1);
});

test("completed remote tasks stay as past agents until upstream removes them", () => {
  const tree = sessionTree([{ ...parent, remoteSubagents: [{ ...task, status: "completed" }] }]);
  assert.equal(tree[0]!.children[0]!.thread.status, "completed");
  assert.equal(sessionTree([parent])[0]!.children.length, 0);
});

test("a paired child's own local subagents remain nested across the remote project boundary", () => {
  const grandchild = { ...child, id: "grandchild", parentThreadId: child.id, relationshipToParent: "subagent" as const };
  const tree = sessionTree([{ ...parent, remoteSubagents: [task] }, child, grandchild]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.children[0]!.thread.projectId, child.projectId);
  assert.equal(tree[0]!.children[0]!.children[0]!.thread.id, grandchild.id);
});
