import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { test } from "node:test";
import * as Schema from "effect/Schema";
import { ServerSettings } from "@t3tools/contracts";
import type { ThreadSummary } from "../shared/bridge";
import { WorktreeCoordinator, parseWorktreeChoice, type WorktreeTransport } from "./worktrees";
import type { EnvironmentCommand, EnvironmentRunner } from "./worktreeEnvironment";
import { acquireWorktreeLease } from "./worktreeEnvironment";

const exec = promisify(execFile);
const DAY = 24 * 60 * 60 * 1000;
async function fixture(t: { after: (action: () => Promise<void>) => void }) {
  const home = await mkdtemp(join(tmpdir(), "t3-coordinator-test-"));
  const root = join(home, "main"), storage = join(home, "storage");
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = async (cwd: string, ...args: string[]) => (await exec("git", args, { cwd, env })).stdout.trim();
  await exec("git", ["init", "-b", "main", root], { env });
  await git(root, "config", "user.name", "Test"); await git(root, "config", "user.email", "test@example.invalid");
  await writeFile(join(root, "environment.yml"), "dependencies: [python]\n");
  await writeFile(join(root, ".gitignore"), ".env*\n");
  await git(root, "add", "."); await git(root, "commit", "-m", "base");
  const events: string[] = [], calls: EnvironmentCommand[] = [], environments: string[] = [];
  const createInputs: unknown[] = [];
  const state = { service: "server-a", trusted: true, creates: 0, failCreate: false, ambiguousCreate: false, failAction: false, wrongPython: false,
    actionWait: null as Promise<void> | null, defaultAsync: false, invalidatePythonOnAction: false, failSettings: false, removes: 0 };
  let native = Schema.decodeUnknownSync(ServerSettings)({ defaultProjectScripts: [{ id: "setup", name: "Setup", command: "setup-project", icon: "configure", runOnWorktreeCreate: true, async: false }],
    projectSettingsOverrides: { project: { worktreeSubmodules: "top-level", newWorktreesStartFromOrigin: false } } });
  let threadPath: string | null = null, threadBranch: string | null = null;
  const runner: EnvironmentRunner = async (command, signal) => {
    calls.push(command);
    const args = command.args;
    const selector = args.indexOf("--prefix");
    const name = args.indexOf("--name");
    const prefix = selector >= 0 ? args[selector + 1]! : name >= 0 ? join(home, "conda", args[name + 1]!) : "";
    if (args[0] === "env" && args[1] === "list") return { stdout: JSON.stringify({ envs: environments }), stderr: "" };
    if (args[0] === "env" && args[1] === "create") {
      events.push("python-create"); await mkdir(prefix, { recursive: true }); environments.push(prefix);
    } else if (args[0] === "env" && args[1] === "remove") {
      events.push("python-remove"); await rm(prefix, { recursive: true }); environments.splice(environments.indexOf(prefix), 1);
    } else if (args.includes("python") && args.includes("-c")) {
      events.push("python-verify");
      return { stdout: JSON.stringify({ executable: join(state.wrongPython ? root : prefix, "bin", "python"), prefix, editable: [] }), stderr: "" };
    } else {
      events.push("action");
      if (state.invalidatePythonOnAction) state.wrongPython = true;
      if (state.actionWait) await Promise.race([state.actionWait, new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("cancelled action")), { once: true }))]);
      if (state.failAction) throw new Error("action failed token=secret");
    }
    return { stdout: "", stderr: "" };
  };
  const client = {
    getSettings: async () => { if (state.failSettings) throw new Error("settings unavailable"); return native; },
    createWorktree: async (raw: unknown) => {
      createInputs.push(raw);
      state.creates++;
      const input = raw as { refName: string; newRefName?: string; path?: string | null };
      if (state.failCreate) throw new Error("early creation failed");
      const branch = input.newRefName ?? input.refName;
      const path = input.path ?? join(home, branch.replaceAll("/", "-"));
      await git(root, "worktree", "add", ...(input.newRefName ? ["-b", input.newRefName] : []), path, input.refName);
      if (state.ambiguousCreate) throw new Error("response lost after creation");
      return { worktree: { path, refName: branch } };
    },
    removeWorktree: async (_cwd: string, path: string) => { state.removes++; await git(root, "worktree", "remove", "--force", path); },
  } as unknown as Partial<WorktreeTransport>;
  const project = { id: "project", title: "Project", workspaceRoot: root, scripts: [] };
  const threads = () => [{ id: "thread", projectId: "project", worktreePath: threadPath, branch: threadBranch, activeRunId: null } as ThreadSummary];
  const options = { storageRoot: storage, client, scope: () => state.service, projects: () => [project], threads,
    windowRoots: () => [root], changed: () => {}, assertTrusted: async () => { if (!state.trusted) throw new Error("workspace is untrusted"); }, runner };
  const coordinator = new WorktreeCoordinator(options);
  t.after(async () => { coordinator.dispose(); await rm(home, { recursive: true, force: true }); });
  const bind = async (path: string | null, branch: string | null) => { events.push("bind"); threadPath = path; threadBranch = branch; };
  const enablePython = () => coordinator.environments.saveProfile("server-a:project", { enabled: true, customSetup: "" });
  const setAsync = (value: boolean | undefined) => { native = { ...native, defaultProjectScripts: native.defaultProjectScripts.map(script => { const { async: _async, ...rest } = script; return value === undefined ? rest : { ...rest, async: value }; }) }; };
  const setLocation = (value: string) => { native = { ...native, worktreesDirectory: value }; };
  return { home, root, storage, git, state, calls, createInputs, events, coordinator, options, bind, threads, enablePython, setAsync, setLocation, project };
}

test("automatic orphan cleanup waits 24 hours across windows and never removes conversations or checkouts", async t => {
  const f = await fixture(t);
  await f.coordinator.environments.saveProfile("server-a:project", { enabled: true, location: "named", customSetup: "" });
  const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  const environment = (await f.coordinator.environments.get("server-a:project", prepared.path))!;
  assert(environment.checkoutIdentity);
  await f.git(f.root, "worktree", "remove", "--force", prepared.path);
  const start = Date.now();
  await f.coordinator.cleanupMissingEnvironments(start);
  assert.equal((await f.coordinator.environments.get("server-a:project", prepared.path))?.missingSince, new Date(start).toISOString());
  assert.equal(f.events.filter(e => e === "python-remove").length, 0);
  const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose());
  await other.cleanupMissingEnvironments(start + DAY - 1);
  assert.equal(f.events.filter(e => e === "python-remove").length, 0);
  await other.cleanupMissingEnvironments(start + DAY);
  assert.equal(f.events.filter(e => e === "python-remove").length, 1);
  assert.equal((await other.environments.get("server-a:project", prepared.path))?.status, "removed");
  assert.equal(f.state.removes, 0); assert.equal(f.threads()[0]?.worktreePath, prepared.path);
  assert.equal(other.snapshot().items.find(w => w.path === prepared.path)?.missing, true);
  await other.cleanupMissingEnvironments(start + DAY * 2);
  assert.equal(f.events.filter(e => e === "python-remove").length, 1);
});

test("cleanup finds orphan records after both Git and session entries disappear", async t => {
  const f = await fixture(t);
  await f.coordinator.environments.saveProfile("server-a:project", { enabled: true, location: "named", customSetup: "" });
  const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  await f.git(f.root, "worktree", "remove", "--force", prepared.path);
  f.options.threads = () => [];
  await f.coordinator.refresh();
  assert.equal(f.coordinator.snapshot().items.some(w => w.path === prepared.path), true);
  const start = Date.now(); await f.coordinator.cleanupMissingEnvironments(start);
  await f.coordinator.cleanupMissingEnvironments(start + DAY);
  assert.equal(f.events.filter(e => e === "python-remove").length, 1);
  assert.equal(f.coordinator.snapshot().items.some(w => w.path === prepared.path), false);
});

test("cleanup skips shared preparation leases and resets grace while a known agent is active", async t => {
  const f = await fixture(t);
  await f.coordinator.environments.saveProfile("server-a:project", { enabled: true, location: "named", customSetup: "" });
  const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  await f.git(f.root, "worktree", "remove", "--force", prepared.path);
  const start = Date.now(); await f.coordinator.cleanupMissingEnvironments(start);
  const release = await acquireWorktreeLease(f.storage, `checkout:${prepared.path}`);
  try { await f.coordinator.cleanupMissingEnvironments(start + DAY); assert.match(f.coordinator.snapshot().error!, /Another window/); }
  finally { await release(); }
  const threads = f.options.threads;
  f.options.threads = () => threads().map(t => ({ ...t, activeRunId: "running" }));
  await f.coordinator.cleanupMissingEnvironments(start + DAY);
  assert.equal((await f.coordinator.environments.get("server-a:project", prepared.path))?.missingSince, undefined);
  assert.equal(f.events.filter(e => e === "python-remove").length, 0);
  f.options.threads = threads;
  await f.coordinator.cleanupMissingEnvironments(start + DAY * 2);
  assert.equal(f.events.filter(e => e === "python-remove").length, 0);
  await f.coordinator.cleanupMissingEnvironments(start + DAY * 3);
  assert.equal(f.events.filter(e => e === "python-remove").length, 1);
});

test("cleanup rechecks trust and current activity after asynchronous Git checks", async t => {
  const f = await fixture(t);
  await f.coordinator.environments.saveProfile("server-a:project", { enabled: true, location: "named", customSetup: "" });
  const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  await f.git(f.root, "worktree", "remove", "--force", prepared.path);
  const start = Date.now(); await f.coordinator.cleanupMissingEnvironments(start);
  const trusted = f.options.assertTrusted;
  let checks = 0;
  f.options.assertTrusted = async () => { if (++checks === 3) f.state.trusted = false; await trusted(); };
  await f.coordinator.cleanupMissingEnvironments(start + DAY);
  assert.match(f.coordinator.snapshot().error!, /untrusted/);
  assert.equal(f.events.filter(e => e === "python-remove").length, 0);
  f.state.trusted = true; checks = 0;
  const threads = f.options.threads;
  f.options.assertTrusted = async () => { if (++checks === 3) f.options.threads = () => threads().map(t => ({ ...t, activeRunId: "late-run" })); await trusted(); };
  await f.coordinator.cleanupMissingEnvironments(start + DAY * 2);
  assert.equal(f.events.filter(e => e === "python-remove").length, 0);
  assert.equal((await f.coordinator.environments.get("server-a:project", prepared.path))?.missingSince, undefined);
});

test("binds service checkout before Python and native synchronous setup, then verifies again", async (t) => {
  const f = await fixture(t); await f.enablePython();
  const result = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  assert.equal(f.state.creates, 1);
  assert.deepEqual(f.events, ["bind", "python-create", "python-verify", "action", "python-verify"]);
  assert.equal(f.threads()[0]!.worktreePath, result.path);
  const action = f.calls.find(call => call.args.includes("setup-project"));
  assert.equal(action?.env?.T3CODE_PROJECT_ROOT, f.root);
  assert.equal(action?.env?.T3CODE_WORKTREE_PATH, result.path);
  assert.match(result.instructions!, /not automatically activated/);
  assert.equal(f.coordinator.snapshot().preparations[0]?.phase, "ready");
});

test("failed creation remains retryable with its stable branch before any checkout binding", async (t) => {
  const f = await fixture(t); f.state.failCreate = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind), /early creation/);
  const failed = f.coordinator.snapshot().preparations[0]!;
  assert.equal(failed.phase, "failed"); assert.deepEqual(f.events, []);
  f.state.failCreate = false;
  const result = await f.coordinator.retry(failed.id);
  assert(result.branch.includes(failed.id.slice(0, 16)));
  assert.equal(f.state.creates, 2);
});

test("even a settings-read failure retains an explicit retry before any service creation", async (t) => {
  const f = await fixture(t); f.state.failSettings = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind), /settings unavailable/);
  const failed = f.coordinator.snapshot().preparations[0]!;
  assert.equal(failed.phase, "failed"); assert.equal(f.state.creates, 0);
  f.state.failSettings = false;
  await f.coordinator.retry(failed.id);
  assert.equal(f.state.creates, 1);
});

test("lost creation response reconciles the retained checkout without a second service create", async (t) => {
  const f = await fixture(t); f.state.ambiguousCreate = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind), /response lost/);
  const failed = f.coordinator.snapshot().preparations[0]!;
  f.state.ambiguousCreate = false;
  const result = await f.coordinator.retry(failed.id);
  assert.equal(f.state.creates, 1); assert.equal(f.threads()[0]!.worktreePath, result.path);
});

test("failed setup preserves binding; retry reruns config copying idempotently without duplicating checkout", async (t) => {
  const f = await fixture(t); await f.enablePython();
  await writeFile(join(f.root, ".env"), "original");
  f.state.failAction = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new", copyEnv: true }, f.bind), /action failed/);
  const failed = f.coordinator.snapshot().preparations[0]!;
  assert(failed.path); assert.equal(f.threads()[0]!.worktreePath, failed.path);
  assert(!JSON.stringify(failed).includes("token=secret"));
  await writeFile(join(failed.path, ".env"), "local edit");
  await writeFile(join(f.root, ".env.local"), "new config");
  f.state.failAction = false;
  await f.coordinator.retry(failed.id);
  assert.equal(f.state.creates, 1);
  assert.equal(await readFile(join(failed.path, ".env"), "utf8"), "local edit");
  assert.equal(await readFile(join(failed.path, ".env.local"), "utf8"), "new config");
  assert.equal(f.coordinator.snapshot().preparations[0]?.error, undefined);
});

test("persisted failed setup reloads and retries the same bound checkout", async (t) => {
  const f = await fixture(t); f.state.failAction = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind));
  const failed = f.coordinator.snapshot().preparations[0]!;
  f.coordinator.dispose();
  const restarted = new WorktreeCoordinator(f.options); t.after(async () => restarted.dispose());
  await restarted.refresh();
  assert.equal(restarted.snapshot().preparations[0]?.id, failed.id);
  f.state.failAction = false;
  const result = await restarted.retry(failed.id);
  assert.equal(result.path, failed.path); assert.equal(f.state.creates, 1);
});

test("untrusted and root preparations cannot execute project setup or Python commands", async (t) => {
  const f = await fixture(t);
  await f.coordinator.prepare("project", "thread", { type: "existing", path: f.root }, f.bind);
  assert.deepEqual(f.events, ["bind"]);
  assert.equal(f.state.creates, 0);
  await assert.rejects(f.coordinator.prepareCheckout("project", f.root), /main checkout/);
  f.state.trusted = false;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind), /untrusted/);
  assert.equal(f.state.creates, 0);
});

test("activity in a linked service project protects its checkout from removal, apply and orphan cleanup", async t => {
  const f = await fixture(t);
  await f.coordinator.environments.saveProfile("server-a:project", { enabled: true, location: "named", customSetup: "" });
  const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  f.options.projects = () => [f.project, { ...f.project, id: "linked", workspaceRoot: prepared.path }];
  f.options.threads = () => [{ ...f.threads()[0]!, id: "linked-session", projectId: "linked", worktreePath: null, activeRunId: "working" }];
  await assert.rejects(f.coordinator.removalDetails("project", prepared.path), /agent or setup/);
  await assert.rejects(f.coordinator.apply("project", f.root, prepared.path, []), /agent is writing/);
  await f.git(f.root, "worktree", "remove", "--force", prepared.path);
  await f.coordinator.cleanupMissingEnvironments(Date.now());
  await f.coordinator.cleanupMissingEnvironments(Date.now() + DAY * 2);
  assert.equal((await f.coordinator.environments.get("server-a:project", prepared.path))?.missingSince, undefined);
  assert.equal(f.events.filter(event => event === "python-remove").length, 0);
});

test("a linked service-project root can be explicitly prepared without treating it as the Git main checkout", async t => {
  const f = await fixture(t), linked = join(f.home, 'linked-service-root');
  await f.git(f.root, 'worktree', 'add', '-b', 'linked-service-root', linked);
  f.options.projects = () => [f.project, { ...f.project, id: 'linked', workspaceRoot: linked }];
  await f.coordinator.environments.saveProfile('server-a:linked', { enabled: true, customSetup: '' });
  await f.coordinator.prepareCheckout('linked', linked);
  assert.equal((await f.coordinator.environments.get('server-a:linked', linked))?.status, 'ready');
  await assert.rejects(f.coordinator.prepareCheckout('linked', f.root), /main checkout/);
  assert.equal(f.state.creates, 0);
});

test("management preparation of a ready environment still verifies it before returning", async (t) => {
  const f = await fixture(t); await f.enablePython();
  const result = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  f.events.length = 0;
  await f.coordinator.prepareCheckout("project", result.path);
  assert.deepEqual(f.events, ["python-verify"]);
  f.state.wrongPython = true;
  await assert.rejects(f.coordinator.prepareCheckout("project", result.path), /Python executable/);
});

test("async native setup starts after Python readiness and does not block agent preparation", async (t) => {
  const f = await fixture(t); await f.enablePython(); f.setAsync(undefined);
  let release!: () => void;
  f.state.actionWait = new Promise<void>(resolve => { release = resolve; });
  const result = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  assert(result.path); assert.deepEqual(f.events, ["bind", "python-create", "python-verify", "action"]);
  assert.equal(f.coordinator.snapshot().preparations[0]?.phase, "ready");
  release();
  // Wait for the background completion's persistence before temporary storage cleanup.
  for (let i = 0; i < 50 && f.coordinator.snapshot().preparations[0]?.stage !== "Ready"; i++) await new Promise(resolve => setTimeout(resolve, 5));
});

test("cancellation keeps the same bound checkout and a retry can finish synchronous setup", async (t) => {
  const f = await fixture(t);
  f.state.actionWait = new Promise<void>(() => {});
  const pending = f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  for (let i = 0; i < 100 && !f.events.includes("action"); i++) await new Promise(resolve => setTimeout(resolve, 5));
  const running = f.coordinator.snapshot().preparations[0]!;
  f.coordinator.cancel(running.id);
  await assert.rejects(pending, /cancelled|aborted/i);
  assert.equal(f.coordinator.snapshot().preparations[0]?.phase, "cancelled");
  f.state.actionWait = null;
  const result = await f.coordinator.retry(running.id);
  assert.equal(result.path, running.path); assert.equal(f.state.creates, 1);
});

test("server scope changes discard stale preparation publication and prevent retries on another service", async (t) => {
  const f = await fixture(t); f.state.failCreate = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind));
  const id = f.coordinator.snapshot().preparations[0]!.id;
  f.state.service = "server-b";
  assert.equal(f.coordinator.snapshot().preparations.length, 0);
  await assert.rejects(f.coordinator.retry(id), /not available/);
  assert.equal(f.state.creates, 1);
});

test("workspace choice validation rejects unsafe refs and excessive parallel allocations", () => {
  assert.throws(() => parseWorktreeChoice({ type: "new", branch: "-bad" }), /valid Git/);
  assert.throws(() => parseWorktreeChoice({ type: "existing", path: "relative" }), /existing checkout/);
  assert.throws(() => parseWorktreeChoice({ type: "new", runs: [{ count: 5, modelSelection: { model: "fixture", instanceId: "fixture" } }] }), /four/);
});

test("new-worktree requests cannot reuse a branch that existed before creation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new", branch: "main" }, f.bind), /already exists/);
  assert.equal(f.state.creates, 0); assert.deepEqual(f.events, []);
});

test("new worktrees fall back to the current root HEAD when main is absent", async (t) => {
  const f = await fixture(t);
  await f.git(f.root, "branch", "-m", "develop");
  const result = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  assert(result.path); assert.equal(f.state.creates, 1);
});

test("synchronous project actions cannot dispatch with a Python interpreter they invalidated", async (t) => {
  const f = await fixture(t); await f.enablePython(); f.state.invalidatePythonOnAction = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind), /Python executable/);
  assert.equal(f.coordinator.snapshot().preparations[0]?.phase, "failed");
  assert.equal(f.events.filter(event => event === "python-verify").length, 2);
});

test("windows merge separate preparation files and retain parallel group metadata", async (t) => {
  const f = await fixture(t);
  await f.coordinator.prepare("project", "one", { type: "new" }, async () => {}, { groupId: "group", title: "Variant one" });
  const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose());
  await other.prepare("project", "two", { type: "new" }, async () => {}, { groupId: "group", title: "Variant two" });
  await f.coordinator.refresh();
  const preparations = f.coordinator.snapshot().preparations;
  assert.equal(preparations.length, 2);
  assert(preparations.every(p => p.groupId === "group"));
  assert.deepEqual(preparations.map(p => p.title).sort(), ["Variant one", "Variant two"]);
});

test("removal details allow the owned Python environment but protect unrelated untracked files", async (t) => {
  const f = await fixture(t); await f.enablePython();
  const result = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  const details = await f.coordinator.removalDetails("project", result.path);
  assert.equal(details.environment?.status, "ready");
  await writeFile(join(result.path, "keep-me"), "precious");
  await assert.rejects(f.coordinator.removalDetails("project", result.path), /untracked/);
});

test("restoration retains the branch and reruns project setup without rebinding a managed checkout", async (t) => {
  const f = await fixture(t);
  const first = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  await f.git(f.root, "worktree", "remove", first.path);
  await f.coordinator.refresh();
  await f.coordinator.restore("project", first.path);
  f.events.length = 0;
  await f.coordinator.prepareCheckout("project", first.path);
  assert.deepEqual(f.events, ["action"]);
  assert.equal(await f.git(first.path, "branch", "--show-current"), first.branch);
});

for (const cleaned of [false, true]) {
  test(`restoration ${cleaned ? "after cleanup rebuilds" : "during grace reuses"} its named environment when Git assigns a different admin directory`, async t => {
    const f = await fixture(t);
    await f.coordinator.environments.saveProfile("server-a:project", { enabled: true, location: "named", customSetup: "" });
    const first = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
    const original = (await f.coordinator.environments.get("server-a:project", first.path))!;
    await f.git(f.root, "worktree", "remove", "--force", first.path);
    const start = Date.now();
    await f.coordinator.cleanupMissingEnvironments(start);
    if (cleaned) await f.coordinator.cleanupMissingEnvironments(start + DAY);

    const collision = join(f.home, "collision", basename(first.path));
    await mkdir(join(f.home, "collision"));
    await f.git(f.root, "worktree", "add", "-b", "admin-collision", collision, "main");
    await f.coordinator.restore("project", first.path);
    const beforeVerify = f.events.filter(event => event === "python-verify").length;
    await f.coordinator.prepareCheckout("project", first.path);

    const restored = (await f.coordinator.environments.get("server-a:project", first.path))!;
    assert.equal(restored.id, original.id);
    assert.equal(restored.prefix, original.prefix);
    assert.equal(restored.status, "ready");
    assert.equal(restored.missingSince, undefined);
    assert.notEqual(restored.checkoutIdentity?.gitDir, original.checkoutIdentity?.gitDir);
    assert(f.events.filter(event => event === "python-verify").length > beforeVerify);
    assert.equal(f.events.filter(event => event === "python-create").length, cleaned ? 2 : 1);
    assert.equal(f.events.filter(event => event === "python-remove").length, cleaned ? 1 : 0);
    assert.equal(f.state.removes, 0);
    assert.equal(f.threads()[0]?.worktreePath, first.path);
    assert.equal(await f.git(first.path, "branch", "--show-current"), first.branch);
  });
}

test("restoration with multiple history records prepares the canonical latest attempt across reload", async (t) => {
  const f = await fixture(t);
  const first = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  await f.coordinator.prepareCheckout("project", first.path);
  const previous = f.coordinator.snapshot().preparations;
  assert.equal(previous.length, 2);
  const latestId = previous.at(-1)!.id;
  await f.git(f.root, "worktree", "remove", first.path);
  await f.coordinator.refresh(); await f.coordinator.restore("project", first.path);
  assert.deepEqual(f.coordinator.snapshot().preparations.map(p => p.phase), ["ready", "failed"]);
  await f.coordinator.prepareCheckout("project", first.path);
  assert.equal(f.coordinator.snapshot().preparations.at(-1)?.id, latestId);
  assert.deepEqual(f.coordinator.snapshot().preparations.map(p => p.phase), ["ready", "ready"]);
  f.coordinator.dispose();
  const restarted = new WorktreeCoordinator(f.options); t.after(async () => restarted.dispose());
  await restarted.refresh();
  const reloaded = restarted.snapshot().preparations;
  assert.equal(reloaded.at(-1)?.id, latestId); assert.equal(reloaded.at(-1)?.phase, "ready");
  assert(reloaded.every((p, i) => i === 0 || p.updatedAt! > reloaded[i - 1]!.updatedAt!));
});

test("native worktree directory layout and tilde expansion stay service-owned", async (t) => {
  const f = await fixture(t); f.setLocation("~/my-native-worktrees");
  await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  assert.equal((f.createInputs[0] as { path: unknown }).path, null);
});

test("private continuation handoff survives an early failure and reload with scope validation", async (t) => {
  const f = await fixture(t); f.state.failCreate = true;
  const handoff = { copyEdits: true, baseRef: await f.git(f.root, "rev-parse", "HEAD"), files: ["environment.yml"] };
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind, { handoff }));
  const failed = f.coordinator.snapshot().preparations[0]!;
  assert.equal("handoff" in failed, false);
  assert.deepEqual(f.coordinator.handoffFor(failed.id), handoff);
  const copy = f.coordinator.handoffFor(failed.id)!;
  (copy.files as string[]).push("not-retained");
  assert.deepEqual(f.coordinator.handoffFor(failed.id), handoff);
  f.coordinator.dispose();
  const restarted = new WorktreeCoordinator(f.options); t.after(async () => restarted.dispose());
  await restarted.refresh();
  assert.deepEqual(restarted.handoffFor(failed.id), handoff);
  f.state.failCreate = false;
  await restarted.retry(failed.id, async (path, branch) => { assert.deepEqual(restarted.handoffFor(failed.id), handoff); await f.bind(path, branch); });
  f.state.service = "other-server";
  assert.throws(() => restarted.handoffFor(failed.id), /not available/);
});

test("handoff validation rejects escaped source paths before creating a checkout", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind, { handoff: { copyEdits: true, baseRef: "a".repeat(40), files: ["../secret"] } }), /Invalid retained/);
  assert.equal(f.state.creates, 0);
});

test("an atomic preparation lease excludes stale-window retries and reloads the completed attempt", async (t) => {
  const f = await fixture(t); f.state.failAction = true;
  await assert.rejects(f.coordinator.prepare("project", "thread", { type: "new" }, f.bind));
  const id = f.coordinator.snapshot().preparations[0]!.id;
  const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose());
  await other.refresh(); f.state.failAction = false; f.events.length = 0;
  let release!: () => void;
  f.state.actionWait = new Promise<void>(resolve => { release = resolve; });
  const running = f.coordinator.retry(id);
  for (let i = 0; i < 100 && !f.events.includes("action"); i++) await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(other.retry(id, f.bind), /Another window/);
  assert.equal(f.events.filter(event => event === "action").length, 1);
  release(); await running; f.state.actionWait = null;
  await other.retry(id, f.bind);
  assert.equal(f.events.filter(event => event === "action").length, 1);
});

test("background setup retains its lease while verified conversation reuse remains nonblocking", async (t) => {
  const f = await fixture(t); await f.enablePython(); f.setAsync(true);
  let release!: () => void;
  f.state.actionWait = new Promise<void>(resolve => { release = resolve; });
  const first = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  const id = f.coordinator.snapshot().preparations[0]!.id;
  assert.equal(f.coordinator.snapshot().preparations[0]?.backgroundRunning, true);
  await f.coordinator.prepare("project", "thread", { type: "existing", path: first.path }, f.bind);
  const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose()); await other.refresh();
  await assert.rejects(other.retry(id, f.bind), /Another window/);
  assert.equal(f.events.filter(event => event === "action").length, 1);
  release();
  for (let i = 0; i < 100 && f.coordinator.snapshot().preparations[0]?.backgroundRunning; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.coordinator.snapshot().preparations[0]?.backgroundRunning, false);
});

for (const background of [false, true]) {
  test(`another window cannot remove a checkout during ${background ? "background" : "blocking"} setup`, async (t) => {
    const f = await fixture(t); await f.enablePython(); f.setAsync(background);
    let release!: () => void;
    f.state.actionWait = new Promise<void>(resolve => { release = resolve; });
    const preparing = f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
    for (let i = 0; i < 100 && !f.events.includes("action"); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert(f.events.includes("action"));
    const path = f.coordinator.snapshot().preparations[0]!.path!;
    if (background) await preparing;
    const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose()); await other.refresh();
    let environmentRemovals = 0;
    const removeEnvironment = other.environments.remove.bind(other.environments);
    other.environments.remove = async options => { environmentRemovals++; await removeEnvironment(options); };
    try {
      await assert.rejects(other.remove("project", path), /Another window/);
      assert.equal(environmentRemovals, 0);
      assert.equal(f.state.removes, 0);
      assert.equal((await other.environments.get("server-a:project", path))?.status, "ready");
      assert.equal(JSON.parse(await readFile(join(path, ".conda-env", ".t3-vscode-owned.json"), "utf8")).worktreePath, path);
    } finally { release(); await preparing; f.state.actionWait = null; }
    // Completion publishes status before its final lease release; wait only for that bounded handoff.
    let removed = false;
    for (let i = 0; i < 100 && !removed; i++) {
      try { await other.remove("project", path); removed = true; }
      catch (error) {
        if (!(error instanceof Error) || !/Another window/.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    assert(removed);
    assert.equal(environmentRemovals, 1);
    assert.equal(f.state.removes, 1);
    assert.equal((await other.environments.get("server-a:project", path))?.status, "removed");
  });
}

test("service switches during removal validation prevent both cleanup mutations and release the lease", async (t) => {
  const f = await fixture(t); await f.enablePython();
  const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
  const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose());
  const details = other.removalDetails.bind(other);
  let environmentRemovals = 0;
  const removeEnvironment = other.environments.remove.bind(other.environments);
  other.environments.remove = async options => { environmentRemovals++; await removeEnvironment(options); };
  other.removalDetails = async (projectId, path) => {
    const result = await details(projectId, path);
    f.state.service = "server-b";
    return result;
  };
  await assert.rejects(other.remove("project", prepared.path), /connected service changed/);
  assert.equal(environmentRemovals, 0); assert.equal(f.state.removes, 0);
  assert.equal((await other.environments.get("server-a:project", prepared.path))?.status, "ready");
  f.state.service = "server-a"; other.removalDetails = details;
  await other.remove("project", prepared.path);
  assert.equal(environmentRemovals, 1); assert.equal(f.state.removes, 1);
});

for (const change of ["service", "project root"] as const) {
  test(`${change} switches during environment cleanup prevent native checkout deletion`, async (t) => {
    const f = await fixture(t); await f.enablePython();
    const prepared = await f.coordinator.prepare("project", "thread", { type: "new" }, f.bind);
    const other = new WorktreeCoordinator(f.options); t.after(async () => other.dispose());
    const removeEnvironment = other.environments.remove.bind(other.environments);
    let cleanupInput: Parameters<typeof removeEnvironment>[0] | undefined;
    other.environments.remove = async options => {
      cleanupInput = { ...options };
      await removeEnvironment(options);
      if (change === "service") f.state.service = "server-b";
      else f.project.workspaceRoot = f.home;
    };
    await assert.rejects(other.remove("project", prepared.path), change === "service" ? /connected service changed/ : /project checkout changed/);
    assert.deepEqual(cleanupInput, { scope: "server-a:project", projectRoot: f.root, worktreePath: prepared.path });
    assert.equal(f.state.removes, 0);
    assert.equal(await readFile(join(prepared.path, "environment.yml"), "utf8"), "dependencies: [python]\n");
    assert.equal((await other.environments.get("server-a:project", prepared.path))?.status, "removed");
    assert.equal(await other.environments.get("server-b:project", prepared.path), null);
    f.state.service = "server-a"; f.project.workspaceRoot = f.root;
  });
}
