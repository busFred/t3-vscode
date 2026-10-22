import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GitRunner, RestoreIo } from "./checkpointRestore.js";
import { cleanExcludePattern, execGit, nodeIo, restoreAttribution, restoreDryRun, restoreExecute } from "./checkpointRestore.js";

const C = "refs/t3/orchestration-v2/checkpoints/scope/3";
const L = "refs/t3/orchestration-v2/checkpoints/scope/5";
const numstat = (entries: Array<[string, number, number]>) => Buffer.from(entries.map(([path, add, del]) => `${add}\t${del}\t${path}`).join("\0") + (entries.length ? "\0" : ""), "utf8");
const lines = (paths: string[]) => Buffer.from(paths.join("\0") + (paths.length ? "\0" : ""), "utf8");

function recordingGit(handlers: Record<string, (args: ReadonlyArray<string>, options?: Parameters<GitRunner>[2]) => Buffer | Promise<Buffer>>, calls: string[][] = []): { git: GitRunner; calls: string[][] } {
  const git: GitRunner = async (_cwd, args, options) => {
    calls.push([...args]);
    const handler = handlers[args[0]!];
    if (!handler) throw new Error(`Unhandled git command: ${args.join(" ")}`);
    return handler(args, options);
  };
  return { git, calls };
}

test("Attribution tags agent-only, you-only, both, and untracked files", async () => {
  const { git } = recordingGit({
    diff: (args) => args.includes(L) && args.includes(C)
      ? numstat([["agent-only.ts", 4, 1], ["both.ts", 2, 0]])
      : numstat([["both.ts", 1, 1], ["you-only.ts", 3, 0]]),
    "ls-files": () => lines(["new.ts"]),
  });
  const files = await restoreAttribution(git, { cwd: "/repo", checkpointRef: C, latestRef: L });
  assert.deepEqual(files.map((f) => f.path), ["agent-only.ts", "both.ts", "new.ts", "you-only.ts"]);
  assert.deepEqual(files[0], { path: "agent-only.ts", agent: { additions: 4, deletions: 1 } });
  assert.deepEqual(files[1], { path: "both.ts", agent: { additions: 2, deletions: 0 }, you: { additions: 1, deletions: 1 } });
  assert.deepEqual(files[2], { path: "new.ts", you: { additions: 0, deletions: 0, untracked: true } });
  assert.deepEqual(files[3], { path: "you-only.ts", you: { additions: 3, deletions: 0 } });
});

test("Dry run maps clean, conflicting and no-op diffs per file without touching the real index", async () => {
  const { git, calls } = recordingGit({
    "read-tree": () => Buffer.alloc(0),
    diff: (args) => args.at(-1) === "same.ts" ? Buffer.alloc(0) : Buffer.from("patch-for-" + args.at(-1)),
    apply: (args) => { if (args.at(-1) === "-" && args.includes("--3way")) { if (calls.filter((c) => c[0] === "apply").length === 1) return Buffer.alloc(0); throw new Error("patch does not apply"); } return Buffer.alloc(0); },
  });
  const verdicts = await restoreDryRun(git, { cwd: "/repo", checkpointRef: C, latestRef: L, paths: ["same.ts", "clean.ts", "conflict.ts"] });
  assert.deepEqual(verdicts, { "same.ts": "clean", "clean.ts": "clean", "conflict.ts": "conflict" });
  assert.deepEqual(calls[0], ["read-tree", C]);
});

test("Dry run with no candidate paths never shells out", async () => {
  const calls: string[][] = [];
  const git: GitRunner = async (_cwd, args) => { calls.push([...args]); return Buffer.alloc(0); };
  assert.deepEqual(await restoreDryRun(git, { cwd: "/repo", checkpointRef: C, latestRef: L, paths: [] }), {});
  assert.deepEqual(calls, []);
});

function memoryIo(initial: Record<string, Buffer> = {}): RestoreIo & { files: Map<string, Buffer> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path) => { const data = files.get(path); if (!data) throw new Error(`ENOENT: ${path}`); return data; },
    writeFile: async (path, data) => { files.set(path, data); },
    mkdir: async () => {},
  };
}

test("Execute restores, excludes kept untracked files from clean, then re-applies kept patches in order", async () => {
  const order: string[] = [];
  const { git } = recordingGit({
    diff: (args) => { order.push(`diff:${args.at(-1)}`); return args.at(-1) === "clean.ts" ? Buffer.from("patch-clean") : Buffer.from("patch-conflict"); },
    restore: () => { order.push("restore"); return Buffer.alloc(0); },
    clean: (args) => { order.push(`clean:${args.join(",")}`); return Buffer.alloc(0); },
    apply: (args, options) => { order.push(`apply:${options?.input?.toString()}`); if (options?.input?.toString() === "patch-conflict") throw new Error("conflict"); return Buffer.alloc(0); },
    checkout: (args) => { order.push(`checkout:${args.join(",")}`); return Buffer.alloc(0); },
  });
  const io = memoryIo({ "/repo/clean.ts": Buffer.from("clean-bytes"), "/repo/conflict.ts": Buffer.from("conflict-bytes") });
  const results = await restoreExecute(git, io, { cwd: "/repo", checkpointRef: C, latestRef: L, keepTracked: ["clean.ts", "conflict.ts"], keepUntracked: ["notes.md"], storageDir: "/storage" });
  // Snapshot + diff both kept files BEFORE the destructive restore/clean, then apply after, in input order.
  assert.deepEqual(order, ["diff:clean.ts", "diff:conflict.ts", "restore", "clean:clean,-fd,-e,/notes.md", "apply:patch-clean", "apply:patch-conflict", "checkout:checkout," + C + ",--,conflict.ts"]);
  assert.deepEqual(results, [{ path: "clean.ts", outcome: "applied" }, { path: "conflict.ts", outcome: "conflict", yoursPath: "conflict.ts.yours" }, { path: "notes.md", outcome: "kept-untracked" }]);
  assert.equal(io.files.get("/repo/conflict.ts.yours")?.toString(), "conflict-bytes");
  assert.equal(io.files.get("/storage/clean.ts")?.toString(), "clean-bytes");
});

test("Execute applies a no-op patch without invoking git apply", async () => {
  const applyCalls: string[] = [];
  const { git } = recordingGit({
    diff: () => Buffer.alloc(0),
    restore: () => Buffer.alloc(0),
    clean: () => Buffer.alloc(0),
    apply: () => { applyCalls.push("apply"); return Buffer.alloc(0); },
  });
  const io = memoryIo({ "/repo/same.ts": Buffer.from("x") });
  const results = await restoreExecute(git, io, { cwd: "/repo", checkpointRef: C, latestRef: L, keepTracked: ["same.ts"], keepUntracked: [], storageDir: "/storage" });
  assert.deepEqual(results, [{ path: "same.ts", outcome: "applied" }]);
  assert.deepEqual(applyCalls, []);
});

test("Against a real repository: attribution, dry run and execute agree on clean, conflicting, agent-only and untracked files", async (t) => {
  const exec = promisify(execFile);
  const home = await mkdtemp(join(tmpdir(), "t3-restore-git-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, "repo");
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = async (...args: string[]) => (await exec("git", args, { cwd: repo, env })).stdout.trim();
  await exec("git", ["init", "-q", "-b", "main", repo], { env });
  await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  // A file long enough that an edit near the top and one near the bottom land in separate diff hunks.
  await writeFile(join(repo, "shared.txt"), Array.from({ length: 20 }, (_, index) => `${index + 1}`).join("\n") + "\n");
  await writeFile(join(repo, "conflict.txt"), "x\ny\nz\n");
  await git("add", "-A"); await git("commit", "-q", "-m", "base");
  const checkpointRef = await git("rev-parse", "HEAD");
  await writeFile(join(repo, "shared.txt"), Array.from({ length: 20 }, (_, index) => index === 4 ? "AGENT-5" : `${index + 1}`).join("\n") + "\n");
  await writeFile(join(repo, "conflict.txt"), "x\nAGENT-y\nz\n");
  await writeFile(join(repo, "agent-only.txt"), "agent new file\n");
  await git("add", "-A"); await git("commit", "-q", "-m", "agent");
  const latestRef = await git("rev-parse", "HEAD");
  // Your edits: far from the agent's line in shared.txt (clean merge), on the same line in conflict.txt (conflict), plus a new untracked file.
  await writeFile(join(repo, "shared.txt"), Array.from({ length: 20 }, (_, index) => index === 4 ? "AGENT-5" : index === 14 ? "YOUR-15" : `${index + 1}`).join("\n") + "\n");
  await writeFile(join(repo, "conflict.txt"), "x\nYOUR-y\nz\n");
  await writeFile(join(repo, "notes.txt"), "untracked\n");
  await writeFile(join(repo, "weird[1].txt"), "glob name\n");
  await writeFile(join(repo, "scratch.txt"), "unkept\n");

  const attribution = await restoreAttribution(execGit, { cwd: repo, checkpointRef, latestRef });
  assert.deepEqual(attribution.map((file) => file.path), ["agent-only.txt", "conflict.txt", "notes.txt", "scratch.txt", "shared.txt", "weird[1].txt"]);
  assert.deepEqual(attribution[0], { path: "agent-only.txt", agent: { additions: 1, deletions: 0 } });
  assert.deepEqual(attribution[2], { path: "notes.txt", you: { additions: 0, deletions: 0, untracked: true } });
  assert.ok(attribution[1]?.agent && attribution[1]?.you, "conflict.txt carries both tags");
  assert.ok(attribution[4]?.agent && attribution[4]?.you, "shared.txt carries both tags");

  const verdicts = await restoreDryRun(execGit, { cwd: repo, checkpointRef, latestRef, paths: ["shared.txt", "conflict.txt"] });
  assert.deepEqual(verdicts, { "shared.txt": "clean", "conflict.txt": "conflict" });

  const storageDir = join(home, "storage");
  const results = await restoreExecute(execGit, nodeIo, { cwd: repo, checkpointRef, latestRef, keepTracked: ["shared.txt", "conflict.txt"], keepUntracked: ["notes.txt", "weird[1].txt"], storageDir });
  assert.deepEqual(results, [{ path: "shared.txt", outcome: "applied" }, { path: "conflict.txt", outcome: "conflict", yoursPath: "conflict.txt.yours" }, { path: "notes.txt", outcome: "kept-untracked" }, { path: "weird[1].txt", outcome: "kept-untracked" }]);

  const sharedLines = (await readFile(join(repo, "shared.txt"), "utf8")).split("\n");
  assert.equal(sharedLines[4], "5", "the agent's edit is reverted to the checkpoint's line, not reapplied");
  assert.equal(sharedLines[14], "YOUR-15", "your far-away edit re-applies");
  assert.equal(await readFile(join(repo, "conflict.txt"), "utf8"), "x\ny\nz\n", "a conflicting file keeps the restored checkpoint version");
  assert.equal(await readFile(join(repo, "conflict.txt.yours"), "utf8"), "x\nYOUR-y\nz\n", "the pre-restore bytes are preserved beside it");
  assert.equal(await readFile(join(repo, "notes.txt"), "utf8"), "untracked\n", "a kept untracked file survives git clean");
  assert.equal(await readFile(join(repo, "weird[1].txt"), "utf8"), "glob name\n", "a kept file whose name is a gitignore glob survives git clean");
  await assert.rejects(readFile(join(repo, "scratch.txt"), "utf8"), "an unkept untracked file is cleaned");
  await assert.rejects(readFile(join(repo, "agent-only.txt"), "utf8"), "an unkept agent-only file is removed by the restore");
});

test("Kept untracked paths become anchored, escaped gitignore patterns", () => {
  assert.equal(cleanExcludePattern("notes.md"), "/notes.md");
  assert.equal(cleanExcludePattern("dir/weird[1]*?.txt"), "/dir/weird\\[1\\]\\*\\?.txt");
  assert.equal(cleanExcludePattern("!bang #hash"), "/\\!bang \\#hash");
});
