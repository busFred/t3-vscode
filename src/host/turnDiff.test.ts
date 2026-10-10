import test from "node:test";
import assert from "node:assert/strict";
import { CheckpointId, CheckpointScopeId } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";
import { turnFixture, publishTurn, turnPatch } from "./testing/turnFixture.js";
import { turnCheckpointRange, turnDiffFiles } from "./turnDiff.js";

test("Diffs compare consecutive saved turns, including the first turn's baseline, never HEAD", () => {
  const projection = turnFixture("first");
  const range = turnCheckpointRange(projection, "checkpoint-first-2");
  assert.equal(range.baseRef, "refs/t3/checkpoints/first/1"); assert.equal(range.headRef, "refs/t3/checkpoints/first/2"); assert.equal(range.turnNumber, 2);
  assert.equal(turnCheckpointRange(projection, "checkpoint-first-1").baseRef, "refs/t3/checkpoints/first/0");
  assert.throws(() => turnCheckpointRange({ ...projection, checkpoints: projection.checkpoints.filter((checkpoint) => checkpoint.appRunOrdinal !== 1) }, "checkpoint-first-2"), /previous turn/);
  assert.throws(() => turnCheckpointRange({ ...projection, runs: projection.runs.map((run) => ({ ...run, status: "running" })) }, "checkpoint-first-2"), /not ready/);
});
test("Diffs follow an unnumbered saved parent after a cancelled run without crossing checkpoint scopes", () => {
  const projection = turnFixture("first", 3);
  const checkpoints = projection.checkpoints.map((checkpoint) => checkpoint.ordinalWithinScope === 2
    ? { ...checkpoint, appRunOrdinal: null, runId: null }
    : checkpoint.ordinalWithinScope === 3 ? { ...checkpoint, parentCheckpointId: CheckpointId.make("checkpoint-first-2") } : checkpoint);
  const range = turnCheckpointRange({ ...projection, checkpoints }, "checkpoint-first-3");
  assert.equal(range.baseRef, "refs/t3/checkpoints/first/2");
  assert.equal(range.headRef, "refs/t3/checkpoints/first/3");
  assert.throws(() => turnCheckpointRange({ ...projection, checkpoints: checkpoints.filter((entry) => entry.ordinalWithinScope !== 2) }, "checkpoint-first-3"), /previous turn/);
  assert.throws(() => turnCheckpointRange({ ...projection, checkpoints: checkpoints.map((entry) => entry.ordinalWithinScope === 2 ? { ...entry, scopeId: CheckpointScopeId.make("unrelated") } : entry) }, "checkpoint-first-3"), /previous turn/);
});
test("Native diff contents use the persisted source turn after later working-file edits", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first"); publishTurn(client, "first");
  client.getSavedTurnDiff = async (range) => { client.savedDiffRequests.push(range); return turnPatch; };
  const diff = await host.prepareTurnDiff("first", "first", "changes-first");
  const contents = await host.loadTurnDiffFile(diff, diff.files[0]!);
  assert.equal(client.savedDiffRequests[0]?.baseRef, "refs/t3/test/baseline");
  assert.equal(client.savedDiffRequests[0]?.headRef, "refs/t3/checkpoints/first/2");
  assert.equal(client.diffRequests.length, 0); assert.equal(contents.newContents, "after\n");
  assert.deepEqual(client.diffFileRequests, [{ cwd: "/tmp/t3-vscode", sourceKind: "branch-range", baseRef: "refs/t3/test/baseline", headRef: "refs/t3/checkpoints/first/2", oldPath: "src/example.ts", newPath: "src/example.ts", changeType: "change" }]);
  await assert.rejects(host.prepareTurnDiff("first", "outside-thread", "changes-first"), /workspace/);
  await assert.rejects(host.prepareTurnDiff("first", "first", "invented"), /checkpoint/);
  await assert.rejects(host.loadTurnDiffFile(diff, { ...diff.files[0]! }), /selected turn/);
});
test("T3's diff parser preserves add, delete, rename, and quoted Git path metadata", () => {
  const patch = turnPatch + 'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n' + 'diff --git a/added.ts b/added.ts\nnew file mode 100644\n--- /dev/null\n+++ b/added.ts\n@@ -0,0 +1 @@\n+new\n' + 'diff --git a/deleted.ts b/deleted.ts\ndeleted file mode 100644\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n';
  assert.deepEqual(turnDiffFiles(patch).map(({ changeType }) => changeType), ["change", "rename-pure", "new", "deleted"]);
  assert.deepEqual(turnDiffFiles(patch)[1], { additions: 0, deletions: 0, changeType: "rename-pure", oldPath: "old.ts", newPath: "new.ts" });
  const quoted = 'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"\n--- "a/caf\\303\\251.ts"\n+++ "b/caf\\303\\251.ts"\n@@ -1 +1 @@\n-before\n+after\n';
  assert.deepEqual(turnDiffFiles(quoted), [{ additions: 1, deletions: 1, changeType: "change", oldPath: "café.ts", newPath: "café.ts" }]);
});

test("Missing turn-start snapshots never substitute the previous response or working tree", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first"); publishTurn(client, "first");
  client.findTurnBaseline = async () => null;
  await assert.rejects(host.prepareTurnDiff("first", "first", "changes-first"), /Agent-only diff unavailable/);
  assert.equal(client.savedDiffRequests.length, 0);
});
test("A manual-only interval returns no response files and never requests the manual diff", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first"); publishTurn(client, "first");
  client.getSavedTurnDiff = async (range) => { client.savedDiffRequests.push(range); return ""; };
  const diff = await host.prepareTurnDiff("first", "first", "changes-first");
  assert.equal(diff.files.length, 0);
  assert.equal(client.savedDiffRequests.length, 1);
  assert.equal(client.savedDiffRequests[0]?.baseRef, "refs/t3/test/baseline");
});
test("Idle auto sends capture before dispatch; failed capture still sends; queue and steer do not capture", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  const order: string[] = [];
  client.captureTurnBaseline = async (_cwd, threadId, messageId) => { assert.equal(threadId, "first"); assert.ok(messageId); order.push("capture"); throw new Error("Not a git repo"); };
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async (input) => { order.push("dispatch"); await dispatch(input); };
  await host.sendMessage("hello", "first");
  assert.deepEqual(order, ["capture", "dispatch"]);
  await host.sendMessage("queued", "first", undefined, "queue");
  await host.sendMessage("steered", "first", undefined, "steer");
  assert.deepEqual(order, ["capture", "dispatch", "dispatch", "dispatch"]);
});

test("Checkpoint readiness updates when only its run completes", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  const projection = turnFixture("first");
  client.threadHandlers.get("first")?.({ kind: "snapshot", snapshotSequence: 10, projection: {
    ...projection, runs: projection.runs.map(run => ({ ...run, status: "running" })),
  } });
  assert.equal(host.snapshot().transcript[0]?.checkpointRunStatus, "running");
  client.threadHandlers.get("first")?.({ kind: "snapshot", snapshotSequence: 11, projection });
  assert.equal(host.snapshot().transcript[0]?.checkpointRunStatus, "completed");
});
