import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachMergesToTurns, extractFilePatch, MergeRecordStore, parsePatchNumstat, resolveThreadForCheckout, type MergeRecord } from "./mergeRecords";

function merge(appliedAt: string, overrides: Partial<MergeRecord> = {}): MergeRecord {
  return { destinationThreadId: "dest", sourceThreadId: "src", sourceTitle: "Subagent", sourceBranch: "agent/feature", destinationBranch: "main",
    cwd: "/repo", appliedAt, files: [{ path: "a.txt", additions: 1, deletions: 0 }], patchFile: "memory:dest:x", ...overrides };
}
test("attachMergesToTurns attaches to the latest preceding turn when no run is active", () => {
  const turns = [{ id: "turn-1", capturedAtMs: 1000 }, { id: "turn-2", capturedAtMs: 2000 }];
  const result = attachMergesToTurns([merge(new Date(2500).toISOString())], turns, null);
  assert.deepEqual([...result.keys()], ["turn-2"]);
});
test("attachMergesToTurns prefers the running turn over any completed checkpoint", () => {
  const turns = [{ id: "turn-1", capturedAtMs: 1000 }, { id: "turn-2", capturedAtMs: 2000 }];
  const result = attachMergesToTurns([merge(new Date(2500).toISOString())], turns, "turn-running");
  assert.deepEqual([...result.keys()], ["turn-running"]);
});
test("attachMergesToTurns drops a merge with no preceding turn and no running turn", () => {
  const result = attachMergesToTurns([merge(new Date(500).toISOString())], [{ id: "turn-1", capturedAtMs: 1000 }], null);
  assert.equal(result.size, 0);
});
test("attachMergesToTurns is a no-op with no turns at all", () => {
  const result = attachMergesToTurns([merge(new Date().toISOString())], [], null);
  assert.equal(result.size, 0);
});
test("attachMergesToTurns groups multiple merges onto the same turn in order", () => {
  const turns = [{ id: "turn-1", capturedAtMs: 1000 }];
  const result = attachMergesToTurns([merge(new Date(1100).toISOString(), { sourceTitle: "First" }), merge(new Date(1200).toISOString(), { sourceTitle: "Second" })], turns, null);
  assert.deepEqual(result.get("turn-1")?.map((entry) => entry.sourceTitle), ["First", "Second"]);
});
test("parsePatchNumstat parses additions, deletions and binary markers", () => {
  const numstat = ["3\t1\ta.txt", "-\t-\tb.bin"].join("\0") + "\0";
  assert.deepEqual(parsePatchNumstat(numstat), [
    { path: "a.txt", additions: 3, deletions: 1, binary: false },
    { path: "b.bin", additions: 0, deletions: 0, binary: true },
  ]);
});
test("extractFilePatch isolates a single file's section from a multi-file patch", () => {
  const patch = [
    "diff --git a/a.txt b/a.txt", "index 000..111 100644", "--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-old", "+new",
    "diff --git a/b.txt b/b.txt", "index 222..333 100644", "--- a/b.txt", "+++ b/b.txt", "@@ -1 +1 @@", "-foo", "+bar",
  ].join("\n");
  const section = extractFilePatch(patch, "a.txt");
  assert.ok(section?.startsWith("diff --git a/a.txt b/a.txt"));
  assert.ok(!section?.includes("b.txt"));
  assert.equal(extractFilePatch(patch, "missing.txt"), null);
});
test("resolveThreadForCheckout prefers a thread actively running at the checkout", () => {
  const threads = [
    { id: "idle", projectId: "p", worktreePath: "/checkout", title: "Idle" },
    { id: "running", projectId: "p", worktreePath: "/checkout", activeRunId: "run-1", title: "Running" },
  ];
  assert.equal(resolveThreadForCheckout(threads, "p", "/root", "/checkout")?.id, "running");
});
test("resolveThreadForCheckout falls back to the project root for threads without a worktree", () => {
  const threads = [{ id: "root-thread", projectId: "p", worktreePath: null, title: "Root" }];
  assert.equal(resolveThreadForCheckout(threads, "p", "/root", "/root")?.id, "root-thread");
  assert.equal(resolveThreadForCheckout(threads, "p", "/root", "/other"), null);
});
test("MergeRecordStore persists records and patch text to disk and reloads them", async () => {
  const home = await mkdtemp(join(tmpdir(), "t3-merge-records-"));
  try {
    const store = new MergeRecordStore(home);
    const record = await store.record(merge(new Date(1000).toISOString()), "diff --git a/a.txt b/a.txt\n");
    assert.ok(record.patchFile.startsWith(home));
    const reloaded = new MergeRecordStore(home);
    const records = await reloaded.forThread("dest");
    assert.equal(records.length, 1);
    assert.equal(await reloaded.readPatch(records[0]!), "diff --git a/a.txt b/a.txt\n");
    assert.deepEqual(await reloaded.forThread("other"), []);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test("MergeRecordStore keeps records in memory without a storage root", async () => {
  const store = new MergeRecordStore();
  const record = await store.record(merge(new Date(1000).toISOString()), "patch text");
  assert.equal((await store.forThread("dest")).length, 1);
  assert.equal(await store.readPatch(record), "patch text");
});
