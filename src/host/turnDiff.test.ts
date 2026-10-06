import test from "node:test";
import assert from "node:assert/strict";
import { ThreadId } from "@t3tools/contracts";
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
test("Native diff contents use the persisted source turn after later working-file edits", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first"); publishTurn(client, "first");
  client.getTurnDiff = async (id, from, to) => { client.diffRequests.push({ id, from, to }); return { threadId: ThreadId.make(id), fromTurnCount: from, toTurnCount: to, diff: turnPatch }; };
  const diff = await host.prepareTurnDiff("first", "first", "changes-first");
  const contents = await host.loadTurnDiffFile(diff, diff.files[0]!);
  assert.deepEqual(client.diffRequests, [{ id: "first", from: 1, to: 2 }]); assert.equal(contents.newContents, "after\n");
  assert.deepEqual(client.diffFileRequests, [{ cwd: "/tmp/t3-vscode", sourceKind: "branch-range", baseRef: "refs/t3/checkpoints/first/1", headRef: "refs/t3/checkpoints/first/2", oldPath: "src/example.ts", newPath: "src/example.ts", changeType: "change" }]);
  await assert.rejects(host.prepareTurnDiff("first", "outside-thread", "changes-first"), /workspace/);
  await assert.rejects(host.prepareTurnDiff("first", "first", "invented"), /checkpoint/);
  await assert.rejects(host.loadTurnDiffFile(diff, { ...diff.files[0]! }), /selected turn/);
});
test("T3's diff parser preserves add, delete, rename, and quoted Git path metadata", () => {
  const patch = turnPatch + 'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n' + 'diff --git a/added.ts b/added.ts\nnew file mode 100644\n--- /dev/null\n+++ b/added.ts\n@@ -0,0 +1 @@\n+new\n' + 'diff --git a/deleted.ts b/deleted.ts\ndeleted file mode 100644\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n';
  assert.deepEqual(turnDiffFiles(patch).map(({ changeType }) => changeType), ["change", "rename-pure", "new", "deleted"]);
  assert.deepEqual(turnDiffFiles(patch)[1], { changeType: "rename-pure", oldPath: "old.ts", newPath: "new.ts" });
  const quoted = 'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"\n--- "a/caf\\303\\251.ts"\n+++ "b/caf\\303\\251.ts"\n@@ -1 +1 @@\n-before\n+after\n';
  assert.deepEqual(turnDiffFiles(quoted), [{ changeType: "change", oldPath: "café.ts", newPath: "café.ts" }]);
});
