import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorktreeEnvironmentCheckoutIdentity } from "../shared/worktreeEnvironment";
import { worktreeCleanupIdentity } from "./worktreeGit";
import { WorktreeEnvironmentManager, parseWorktreeEnvironmentProfile, runEnvironmentCommand, acquireWorktreeLease, type EnvironmentCommand, type EnvironmentRunner } from "./worktreeEnvironment";

async function fixture(t: { after: (action: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "t3-env-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const worktreePath = path.join(root, "worktree");
  const storage = path.join(root, "storage");
  await fs.mkdir(projectRoot);
  await fs.mkdir(worktreePath);
  await fs.writeFile(path.join(worktreePath, "environment.yml"), "name: original\ndependencies: [python]\n");
  await fs.mkdir(path.join(worktreePath, "package"));
  const calls: EnvironmentCommand[] = [];
  const envs: string[] = [];
  const state = { editable: [] as string[], failSetup: false, cancelCreate: null as AbortController | null, waitMs: 0, creates: 0, onList: null as (() => Promise<void>) | null };
  const runner: EnvironmentRunner = async (command) => {
    calls.push(command);
    const args = command.args;
    if (args[0] === "env" && args[1] === "list") { await state.onList?.(); return { stdout: JSON.stringify({ envs }), stderr: "" }; }
    const prefixIndex = args.indexOf("--prefix");
    const nameIndex = args.indexOf("--name");
    const prefix = prefixIndex >= 0 ? args[prefixIndex + 1]! : path.join(root, "envs", args[nameIndex + 1]!);
    if (args[0] === "create" || (args[0] === "env" && args[1] === "create")) {
      state.creates++;
      if (state.waitMs) await new Promise((resolve) => setTimeout(resolve, state.waitMs));
      await fs.mkdir(prefix, { recursive: true });
      envs.push(prefix);
      if (state.cancelCreate) { state.cancelCreate.abort(); throw new Error("cancelled creation"); }
      return { stdout: "created", stderr: "" };
    }
    if (args[0] === "env" && args[1] === "remove") {
      await fs.rm(prefix, { recursive: true });
      envs.splice(envs.indexOf(prefix), 1);
      return { stdout: "removed", stderr: "" };
    }
    if (args.includes("bash") && state.failSetup) throw new Error("setup failed token=secret-value");
    if (args.includes("-c") && args.includes("python")) {
      return { stdout: JSON.stringify({ executable: path.join(prefix, "bin", "python"), prefix, editable: state.editable.map((item) => pathToFileURL(item).href) }), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  const manager = new WorktreeEnvironmentManager(storage, { runner });
  const options = { scope: "service:project", projectRoot, worktreePath };
  return { root, projectRoot, worktreePath, storage, calls, envs, state, runner, manager, options };
}

async function orphanFixture(t: { after: (action: () => Promise<void>) => void }) {
  const f = await fixture(t);
  const commonDir = path.join(f.projectRoot, ".git"), gitDir = path.join(commonDir, "worktrees", "fixture");
  await fs.mkdir(gitDir, { recursive: true });
  const common = await fs.stat(commonDir), parent = await fs.stat(path.dirname(f.worktreePath));
  const identity: WorktreeEnvironmentCheckoutIdentity = { commonDir, gitDir, parentPath: path.dirname(f.worktreePath),
    parentDevice: parent.dev.toString(), commonDevice: common.dev.toString(), commonInode: common.ino.toString() };
  await f.manager.saveProfile(f.options.scope, { enabled: true, location: "named", customSetup: "" });
  const record = await f.manager.prepare({ ...f.options, checkoutIdentity: identity });
  await fs.rm(f.worktreePath, { recursive: true }); await fs.rm(gitDir, { recursive: true });
  const now = Date.UTC(2026, 0, 1);
  const removeCount = () => f.calls.filter(call => call.args[0] === "env" && call.args[1] === "remove").length;
  return { ...f, identity, record, now, removeCount };
}

async function retainedGitFixture(t: { after: (action: () => Promise<void>) => void }) {
  const f = await fixture(t), execute = promisify(execFile);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    HOME: f.root, XDG_CONFIG_HOME: f.root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = async (...args: string[]) => (await execute("git", args, { cwd: f.projectRoot, env })).stdout.trim();
  await git("init", "-b", "main"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.invalid");
  await fs.writeFile(path.join(f.projectRoot, "environment.yml"), "dependencies: [python]\n");
  await fs.mkdir(path.join(f.projectRoot, "package")); await fs.writeFile(path.join(f.projectRoot, "package", "__init__.py"), "");
  await git("add", "."); await git("commit", "-m", "fixture");
  await fs.rm(f.worktreePath, { recursive: true }); await git("worktree", "add", "-b", "original", f.worktreePath);
  await f.manager.saveProfile(f.options.scope, { enabled: true, location: "named", editable: ["package"] });
  f.state.editable = [path.join(f.worktreePath, "package")];
  const identity = await worktreeCleanupIdentity(f.projectRoot, f.worktreePath);
  const record = await f.manager.prepare({ ...f.options, checkoutIdentity: identity });
  return { ...f, git, identity, record };
}

test("profiles are disabled by default and validate bounded checkout-relative options", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.manager.getProfile(f.options.scope)).enabled, false);
  assert.equal((await f.manager.getProfile(f.options.scope)).autoCleanup, true);
  assert.throws(() => parseWorktreeEnvironmentProfile({ autoCleanup: "yes" }), /profile options/);
  await assert.rejects(f.manager.prepare(f.options), /disabled/);
  for (const directory of ["../base", "/tmp/base", ".", "a\\b", "a/../../base"]) {
    assert.throws(() => parseWorktreeEnvironmentProfile({ directory }), /relative/);
  }
  assert.throws(() => parseWorktreeEnvironmentProfile({ editable: ["../base"] }), /relative/);
  assert.throws(() => parseWorktreeEnvironmentProfile({ customSetup: "TOKEN=secret bash setup.sh" }), /credentials/);
  assert.deepEqual(parseWorktreeEnvironmentProfile({ editable: ["."] }).editable, ["."]);
  await assert.rejects(f.manager.getProfile(""), /scope/);
});

test("directory identity survives new managers, retry, removal and restoration", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  const first = await f.manager.prepare(f.options);
  assert.equal(first.status, "ready");
  assert.equal(first.target, path.join(f.worktreePath, ".conda-env"));
  const restarted = new WorktreeEnvironmentManager(f.storage, { runner: f.runner });
  const second = await restarted.prepare(f.options);
  assert.equal(first.id, second.id);
  assert.equal(f.state.creates, 1);
  const command = restarted.describe(second, "python", ["-c", "print('hello')"]);
  assert.deepEqual(command.args.slice(0, 3), ["run", "--prefix", second.target]);
  assert.match(command.agentInstructions, /not automatically activated/);
  assert.match(command.terminalCommand, /'\\''/);
  await restarted.remove(f.options);
  assert.equal((await restarted.get(f.options.scope, f.worktreePath))?.status, "removed");
  await assert.rejects(fs.stat(first.target), { code: "ENOENT" });
  const restored = await restarted.prepare(f.options);
  assert.equal(restored.id, first.id);
  assert.equal(f.state.creates, 2);
});

test("clone reinstalls editable packages from this checkout and checks every editable source", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, seed: "clone", cloneFrom: "cvafa", editable: ["package", "."] });
  f.state.editable = [path.join(f.worktreePath, "package"), f.worktreePath];
  const record = await f.manager.prepare(f.options);
  assert.equal(record.status, "ready");
  assert(f.calls.some((call) => call.args.includes("--clone") && call.args.includes("cvafa")));
  assert(f.calls.some((call) => call.args.includes("bash") && call.args.includes("bash ./setup.sh") && call.cwd === f.worktreePath));
  assert(f.calls.some((call) => call.args.includes("--editable") && call.args.includes(path.join(f.worktreePath, "package"))));
  f.state.editable.push(path.join(f.projectRoot, "old-package"));
  await assert.rejects(f.manager.prepare(f.options), /outside this worktree/);
  const failed = await f.manager.get(f.options.scope, f.worktreePath);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.id, record.id);
  assert.equal(f.state.creates, 1);
  assert.equal(f.calls.filter((call) => call.args.includes("bash")).length, 1, "a ready environment must not rerun custom setup");
  f.state.editable = [path.join(f.worktreePath, "package"), f.worktreePath];
  await f.manager.prepare(f.options);
  assert.equal(f.calls.filter((call) => call.args.includes("bash")).length, 2, "failed preparation retries setup");
});

test("failed setup preserves environment, redacts diagnostics and retries without recreating", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true });
  f.state.failSetup = true;
  await assert.rejects(f.manager.prepare(f.options), /setup failed/);
  const failed = await f.manager.get(f.options.scope, f.worktreePath);
  assert.equal(failed?.status, "failed");
  assert(!JSON.stringify(failed?.diagnostics).includes("secret-value"));
  f.state.failSetup = false;
  const ready = await f.manager.prepare(f.options);
  assert.equal(ready.id, failed?.id);
  assert.equal(f.state.creates, 1);
});

test("cancelled creation retains partial owned environment and stable ID for retry", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  const controller = new AbortController();
  f.state.cancelCreate = controller;
  await assert.rejects(f.manager.prepare({ ...f.options, signal: controller.signal }), /cancelled/);
  const cancelled = await f.manager.get(f.options.scope, f.worktreePath);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(await fs.readFile(path.join(cancelled!.target, ".t3-vscode-owned.json"), "utf8").then(() => true), true);
  f.state.cancelCreate = null;
  assert.equal((await f.manager.prepare(f.options)).id, cancelled?.id);
  assert.equal(f.state.creates, 1);
});

test("existing unowned directory and symlink environments are never reused or deleted", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  const target = path.join(f.worktreePath, ".conda-env");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "base-data"), "precious");
  await assert.rejects(f.manager.prepare(f.options), /not owned/);
  await assert.rejects(f.manager.remove(f.options), /ownership/);
  assert.equal(await fs.readFile(path.join(target, "base-data"), "utf8"), "precious");
  assert.equal(f.state.creates, 0);
  await fs.rm(target, { recursive: true });
  await fs.symlink(f.projectRoot, target, "dir");
  await assert.rejects(f.manager.prepare(f.options), /symlinks/);
  await assert.rejects(f.manager.remove(f.options), /symlinks/);
});

test("named targets reject unowned collisions, retain stable names and never modify clone base", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, location: "named", seed: "clone", customSetup: "" });
  const id = createHash("sha256").update(`${f.options.scope}\0${f.worktreePath}`).digest("hex").slice(0, 24);
  const collision = path.join(f.root, "envs", `t3-${id}`);
  const base = path.join(f.root, "envs", "cvafa");
  await fs.mkdir(collision, { recursive: true });
  await fs.mkdir(base);
  await fs.writeFile(path.join(base, "precious"), "base");
  f.envs.push(collision, base);
  await assert.rejects(f.manager.prepare(f.options), /not owned/);
  await assert.rejects(f.manager.remove(f.options), /ownership/);
  await fs.rm(collision, { recursive: true });
  f.envs.splice(f.envs.indexOf(collision), 1);
  const ready = await f.manager.prepare(f.options);
  assert.equal(ready.target, `t3-${id}`);
  assert.equal(ready.prefix, collision);
  await f.manager.remove(f.options);
  assert.equal(await fs.readFile(path.join(base, "precious"), "utf8"), "base");
  assert(f.calls.every((call) => !(call.args[0] === "env" && call.args[1] === "remove") || !call.args.includes(base)));
});

test("concurrent managers lock the same worktree so it is created only once", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  f.state.waitMs = 120;
  const otherWindow = new WorktreeEnvironmentManager(f.storage, { runner: f.runner });
  const records = await Promise.all([f.manager.prepare(f.options), otherWindow.prepare(f.options)]);
  assert.equal(records[0]!.id, records[1]!.id);
  assert.equal(f.state.creates, 1);
});

test("different project scopes cannot race to claim the same checkout directory", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  await f.manager.saveProfile("other-service:project", { enabled: true, customSetup: "" });
  f.state.waitMs = 80;
  const other = new WorktreeEnvironmentManager(f.storage, { runner: f.runner });
  const results = await Promise.allSettled([f.manager.prepare(f.options), other.prepare({ ...f.options, scope: "other-service:project" })]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(f.state.creates, 1);
});

test("editable URLs that resolve through a symlink to the original checkout are rejected", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  const linked = path.join(f.worktreePath, "linked-package");
  await fs.symlink(f.projectRoot, linked, "dir");
  f.state.editable = [linked];
  await assert.rejects(f.manager.prepare(f.options), /outside this worktree through a symlink/);
  assert.equal((await f.manager.get(f.options.scope, f.worktreePath))?.status, "failed");
});

test("dead stale local lock is recovered, live-owner lock is respected", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  const lockId = createHash("sha256").update(f.worktreePath).digest("hex").slice(0, 24);
  const lock = path.join(f.storage, "locks", lockId);
  await fs.mkdir(lock, { recursive: true });
  await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647, host: hostname(), token: "dead", time: Date.now() - 120_000 }));
  await f.manager.prepare(f.options);
  await fs.mkdir(lock);
  await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), token: "live", time: 0 }));
  const impatient = new WorktreeEnvironmentManager(f.storage, { runner: f.runner, lockTimeoutMs: 60 });
  await assert.rejects(impatient.prepare(f.options), /Another window/);
  assert.equal(JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")).token, "live");
});

test("tampered metadata or wrong project cannot authorize arbitrary deletion", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  const record = await f.manager.prepare(f.options);
  await assert.rejects(f.manager.remove({ ...f.options, projectRoot: f.worktreePath }), /another project/);
  const file = path.join(f.storage, "environments", `${record.id}.json`);
  await fs.writeFile(file, JSON.stringify({ ...record, target: f.projectRoot, prefix: f.projectRoot }));
  await assert.rejects(f.manager.remove(f.options), /metadata/);
  assert.equal((await fs.stat(f.projectRoot)).isDirectory(), true);
});

test("native runner cancels a child process with bounded diagnostic output", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const command = { executable: process.execPath, args: ["-e", "process.stderr.write('x'.repeat(30000));setInterval(()=>{},1000)"], cwd: f.root };
  const pending = runEnvironmentCommand(command, controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, /cancelled/); } finally { clearTimeout(timer); }
  const output = await runEnvironmentCommand({ executable: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(30000))"], cwd: f.root });
  assert.equal(output.stdout.length, 16_384);
  const environment = await runEnvironmentCommand({ executable: process.execPath, args: ["-e", "process.stdout.write(process.env.T3CODE_WORKTREE_PATH || '')"], cwd: f.root, env: { T3CODE_WORKTREE_PATH: f.worktreePath } });
  assert.equal(environment.stdout, f.worktreePath);
});

test("whole-operation leases recover dead local owners without stale observers taking a live lease", async (t) => {
  const f = await fixture(t);
  const identity = "preparation-fixture";
  const lock = path.join(f.storage, "operation-leases", createHash("sha256").update(identity).digest("hex"));
  await fs.mkdir(lock, { recursive: true });
  await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ host: hostname(), pid: 2_147_483_647, token: "11111111-1111-4111-8111-111111111111" }));
  const contenders = await Promise.allSettled([acquireWorktreeLease(f.storage, identity), acquireWorktreeLease(f.storage, identity)]);
  const owners = contenders.filter((item): item is PromiseFulfilledResult<() => Promise<void>> => item.status === "fulfilled");
  assert.equal(owners.length, 1);
  await assert.rejects(acquireWorktreeLease(f.storage, identity), /Another window/);
  await owners[0]!.value();
  const release = await acquireWorktreeLease(f.storage, identity);
  await release(); await release();
});

test("automatic cleanup waits 24 hours from first confirmed removal and persists grace across restarts", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  const options = { ...f.options, assertCleanupSafe: async () => true };
  const first = await f.manager.reconcile({ ...options, now: f.now });
  assert.equal(first?.missingSince, new Date(f.now).toISOString()); assert.equal(f.removeCount(), 0);
  const restarted = new WorktreeEnvironmentManager(f.storage, { runner: f.runner });
  const before = await restarted.reconcile({ ...options, now: f.now + day - 1 });
  assert.equal(before?.missingSince, first?.missingSince); assert.equal(f.removeCount(), 0);
  const removed = await restarted.reconcile({ ...options, now: f.now + day });
  assert.equal(removed?.status, "removed"); assert.equal(removed?.id, f.record.id);
  assert.equal(removed?.missingSince, undefined); assert.equal(f.removeCount(), 1);
  await assert.rejects(fs.stat(f.record.prefix!), { code: "ENOENT" });
  await assert.rejects(fs.stat(f.worktreePath), { code: "ENOENT" });
});

test("disabled automatic cleanup clears grace and re-enabling starts a new grace period", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  const options = { ...f.options, assertCleanupSafe: async () => true };
  await f.manager.reconcile({ ...options, now: f.now });
  const profile = await f.manager.getProfile(f.options.scope);
  await f.manager.saveProfile(f.options.scope, { ...profile, autoCleanup: false });
  const disabled = await f.manager.reconcile({ ...options, now: f.now + day });
  assert.equal(disabled?.missingSince, undefined); assert.equal(disabled?.status, "ready"); assert.equal(f.removeCount(), 0);
  await f.manager.saveProfile(f.options.scope, { ...profile, autoCleanup: true });
  const enabled = await f.manager.reconcile({ ...options, now: f.now + 2 * day });
  assert.equal(enabled?.missingSince, new Date(f.now + 2 * day).toISOString()); assert.equal(f.removeCount(), 0);
});

test("a safety failure or checkout reappearance resets grace without removing an environment", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
  const unsafe = await f.manager.reconcile({ ...f.options, now: f.now + day, assertCleanupSafe: async () => false });
  assert.equal(unsafe?.missingSince, undefined); assert.equal(f.removeCount(), 0);
  await f.manager.reconcile({ ...f.options, now: f.now + 2 * day, assertCleanupSafe: async () => true });
  await fs.mkdir(f.worktreePath);
  const restored = await f.manager.reconcile({ ...f.options, now: f.now + 3 * day, assertCleanupSafe: async () => true });
  assert.equal(restored?.missingSince, undefined); assert.equal(restored?.status, "ready"); assert.equal(f.removeCount(), 0);
});

test("final cleanup guard observes a newly disabled toggle before invoking Conda removal", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
  let checks = 0;
  const record = await f.manager.reconcile({ ...f.options, now: f.now + day, assertCleanupSafe: async () => {
    checks++;
    if (checks === 2) await f.manager.saveProfile(f.options.scope, { ...await f.manager.getProfile(f.options.scope), autoCleanup: false });
    return true;
  } });
  assert(checks >= 2); assert.equal(f.removeCount(), 0); assert.equal(record?.missingSince, undefined);
});

test("scope or cancellation guard failures make no cleanup mutation", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
  const file = path.join(f.storage, "environments", `${f.record.id}.json`), before = await fs.readFile(file, "utf8");
  let checks = 0;
  await assert.rejects(f.manager.reconcile({ ...f.options, now: f.now + day, assertCleanupSafe: async () => {
    if (++checks === 2) throw new Error("service changed");
    return true;
  } }), /service changed/);
  assert.equal(await fs.readFile(file, "utf8"), before); assert.equal(f.removeCount(), 0);
});

test("already missing named environments update metadata only, even with cleanup disabled", async (t) => {
  const f = await orphanFixture(t);
  await fs.rm(f.record.prefix!, { recursive: true });
  await f.manager.saveProfile(f.options.scope, { ...await f.manager.getProfile(f.options.scope), autoCleanup: false });
  const record = await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => false });
  assert.equal(record?.status, "removed"); assert.equal(f.removeCount(), 0);
  assert.equal(record?.missingSince, undefined);
});

test("missing environment parents are uncertainty, not evidence for marking an environment removed", async (t) => {
  const f = await orphanFixture(t);
  await fs.rm(path.dirname(f.record.prefix!), { recursive: true });
  await assert.rejects(f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true }), /parent is missing/);
  assert.equal((await f.manager.get(f.options.scope, f.worktreePath))?.status, "ready"); assert.equal(f.removeCount(), 0);
});

test("missing directory environments are reconciled only under their reachable captured parent", async (t) => {
  const f = await fixture(t);
  const commonDir = path.join(f.projectRoot, ".git"); await fs.mkdir(commonDir);
  const common = await fs.stat(commonDir), parent = await fs.stat(f.root);
  const identity = { commonDir, gitDir: path.join(commonDir, "worktrees", "fixture"), parentPath: f.root,
    parentDevice: parent.dev.toString(), commonDevice: common.dev.toString(), commonInode: common.ino.toString() };
  await f.manager.saveProfile(f.options.scope, { enabled: true, customSetup: "" });
  await f.manager.prepare({ ...f.options, checkoutIdentity: identity }); await fs.rm(f.worktreePath, { recursive: true });
  const record = await f.manager.reconcile({ ...f.options, now: Date.UTC(2026, 0, 1), assertCleanupSafe: async () => true });
  assert.equal(record?.status, "removed"); assert(f.calls.every(call => !call.args.includes("remove")));
});

test("legacy records without captured identity and unowned replacements are never automatically deleted", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  const file = path.join(f.storage, "environments", `${f.record.id}.json`);
  const legacy = JSON.parse(await fs.readFile(file, "utf8")); delete legacy.checkoutIdentity;
  await fs.writeFile(file, JSON.stringify(legacy));
  const record = await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
  assert.equal(record?.missingSince, undefined); assert.equal(f.removeCount(), 0);
  await fs.writeFile(file, JSON.stringify(f.record));
  await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
  await fs.writeFile(path.join(f.record.prefix!, ".t3-vscode-owned.json"), "{}");
  await assert.rejects(f.manager.reconcile({ ...f.options, now: f.now + day, assertCleanupSafe: async () => true }), /ownership/);
  assert.equal(f.removeCount(), 0); assert((await fs.stat(f.record.prefix!)).isDirectory());
});

test("cleanup-only profile toggles reuse setup and preparation clears the removal grace", async (t) => {
  const f = await fixture(t);
  await f.manager.saveProfile(f.options.scope, { enabled: true });
  const first = await f.manager.prepare(f.options);
  const file = path.join(f.storage, "environments", `${first.id}.json`);
  await fs.writeFile(file, JSON.stringify({ ...first, missingSince: new Date(0).toISOString() }));
  await f.manager.saveProfile(f.options.scope, { ...await f.manager.getProfile(f.options.scope), autoCleanup: false });
  const reused = await f.manager.prepare(f.options);
  assert.equal(reused.missingSince, undefined);
  assert.equal(f.calls.filter(call => call.args.includes("bash")).length, 1);
  assert.equal(f.state.creates, 1);
});

test("environment enumeration includes orphan records and rejects symlinked or oversized metadata", async (t) => {
  const f = await orphanFixture(t);
  assert.deepEqual((await f.manager.list(f.options.scope, f.projectRoot)).map(record => record.id), [f.record.id]);
  assert.deepEqual(await f.manager.list("other-project", f.projectRoot), []);
  const file = path.join(f.storage, "environments", `${f.record.id}.json`), backup = path.join(f.root, "record.json");
  await fs.rename(file, backup); await fs.symlink(backup, file);
  await assert.rejects(f.manager.list(f.options.scope, f.projectRoot), /regular file/);
  await fs.rm(file); await fs.writeFile(file, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(f.manager.list(f.options.scope, f.projectRoot), /regular file/);
});

test("a definitively removed environment can capture a new Git admin identity on restoration", async (t) => {
  const f = await orphanFixture(t);
  await f.manager.remove(f.options);
  await fs.mkdir(f.worktreePath); await fs.writeFile(path.join(f.worktreePath, "environment.yml"), "dependencies: [python]\n");
  const identity = { ...f.identity, gitDir: `${f.identity.gitDir}1` }; await fs.mkdir(identity.gitDir, { recursive: true });
  const restored = await f.manager.prepare({ ...f.options, checkoutIdentity: identity });
  assert.equal(restored.id, f.record.id); assert.equal(restored.status, "ready");
  assert.deepEqual(restored.checkoutIdentity, identity); assert.equal(f.state.creates, 2);
  await assert.rejects(f.manager.prepare({ ...f.options, checkoutIdentity: { ...identity, gitDir: `${identity.gitDir}2` } }), /identity changed/);
});

for (const replacement of ["marker", "prefix"] as const) {
  test(`cleanup rechecks ownership when the named-environment list replaces its ${replacement}`, async (t) => {
    const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
    await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
    const base = path.join(f.root, "base-environment"); await fs.mkdir(base); await fs.writeFile(path.join(base, "precious"), "base data");
    f.state.onList = async () => {
      f.state.onList = null;
      if (replacement === "marker") await fs.writeFile(path.join(f.record.prefix!, ".t3-vscode-owned.json"), "{}");
      else { await fs.rename(f.record.prefix!, `${f.record.prefix!}-kept`); await fs.symlink(base, f.record.prefix!, "dir"); }
    };
    await assert.rejects(f.manager.reconcile({ ...f.options, now: f.now + day, assertCleanupSafe: async () => true }), /ownership|moved/);
    assert.equal(f.removeCount(), 0);
    assert.equal(await fs.readFile(path.join(base, "precious"), "utf8"), "base data");
  });
}

test("cleanup rechecks ownership after the final asynchronous safety callback", async (t) => {
  const f = await orphanFixture(t), day = 24 * 60 * 60 * 1000;
  await f.manager.reconcile({ ...f.options, now: f.now, assertCleanupSafe: async () => true });
  let checks = 0;
  await assert.rejects(f.manager.reconcile({ ...f.options, now: f.now + day, assertCleanupSafe: async () => {
    if (++checks === 2) await fs.writeFile(path.join(f.record.prefix!, ".t3-vscode-owned.json"), "{}");
    return true;
  } }), /ownership/);
  assert.equal(f.removeCount(), 0);
});

test("a retained named environment survives real Git admin basename reuse before cleanup grace expires", async (t) => {
  const f = await retainedGitFixture(t);
  await f.git("worktree", "remove", "--force", f.worktreePath);
  const other = path.join(f.root, "other", path.basename(f.worktreePath)); await fs.mkdir(path.dirname(other));
  await f.git("worktree", "add", "-b", "unrelated", other);
  await f.git("worktree", "add", f.worktreePath, "original");
  const identity = await worktreeCleanupIdentity(f.projectRoot, f.worktreePath);
  assert.notEqual(identity.gitDir, f.identity.gitDir);
  const reused = await f.manager.prepare({ ...f.options, checkoutIdentity: identity });
  assert.equal(reused.id, f.record.id); assert.equal(reused.prefix, f.record.prefix); assert.equal(reused.status, "ready");
  assert.deepEqual(reused.checkoutIdentity, identity); assert.equal(f.state.creates, 1);
  assert.equal(f.calls.filter(call => call.args.includes("bash")).length, 2);
  assert.equal(f.calls.filter(call => call.args.includes("--editable")).length, 2);
});

test("a moved original checkout retains its named environment ownership instead of handing it to a new checkout", async (t) => {
  const f = await retainedGitFixture(t);
  const moved = path.join(f.root, "moved");
  await f.git("worktree", "move", f.worktreePath, moved);
  await f.git("worktree", "add", "-b", "replacement", f.worktreePath);
  const identity = await worktreeCleanupIdentity(f.projectRoot, f.worktreePath);
  await assert.rejects(f.manager.prepare({ ...f.options, checkoutIdentity: identity }), /identity changed/);
  assert.equal(f.state.creates, 1);
  assert.deepEqual((await f.manager.get(f.options.scope, f.worktreePath))?.checkoutIdentity, f.identity);
  assert.equal((await fs.stat(f.record.prefix!)).isDirectory(), true);
});
