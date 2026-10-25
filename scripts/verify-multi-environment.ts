/**
 * Live multi-environment verification. Starts two isolated `t3 serve` instances (local "A" and remote "B"),
 * pairs B through pairRemoteEnvironment, and drives a headless HostState over MultiEnvironmentClient.
 * Deterministic by default (no model call); set T3_VSCODE_LIVE=1 for one low-effort live turn on B.
 * Never touches ~/.t3 or any running server: every server uses its own temp --base-dir and a free port.
 * Never prints tokens (server logs stay inside the temp directory, which is deleted at the end).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, openSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { EnvironmentCatalog, pairRemoteEnvironment, type RemoteEnvironmentRecord, type SecretBackend } from "../src/host/environmentCatalog.js";
import { HostState } from "../src/host/hostState.js";
import { MultiEnvironmentClient } from "../src/host/multiEnvironmentClient.js";
import type { PairedSession } from "../src/host/pairing.js";
import { pairWithServer } from "../src/host/pairing.js";
import { discoverServer } from "../src/host/serverDiscovery.js";
import { T3Client } from "../src/host/t3Client.js";
import type { HostStateSnapshot } from "../src/shared/bridge.js";
import { ComposerDraftStore } from "../src/host/composerDraftStore.js";
import { liveTestSelection } from "./liveTestModel.js";

const execFileAsync = promisify(execFile);
const LIVE = process.env.T3_VSCODE_LIVE === "1";
const started = Date.now();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const children = new Set<ChildProcess>();
let root = "";

/** Scrubs anything token-shaped before printing. */
const scrub = (text: string) => text.replace(/(token=|Token:\s*|Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1<redacted>");
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS: ${name}`); }
  catch (cause) {
    const detail = scrub(cause instanceof Error ? cause.message : String(cause));
    results.push({ name, ok: false, detail }); console.log(`FAIL: ${name}\n      ${detail.split("\n").join("\n      ")}`);
  }
}
function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function until<T>(what: string, probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, timeoutMs = 20_000, intervalMs = 150): Promise<T> {
  const end = Date.now() + timeoutMs; let last: unknown;
  for (;;) {
    try { const value = await probe(); if (value) return value; } catch (cause) { last = cause; }
    if (Date.now() > end) throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${what}${last ? ` (last error: ${scrub(String(last))})` : ""}`);
    await sleep(intervalMs);
  }
}
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); });
});

interface ServerHandle { readonly name: string; readonly home: string; readonly port: number; readonly cwd: string; child: ChildProcess | null }
async function startServer(server: ServerHandle): Promise<void> {
  const log = join(server.home, `serve-${Date.now()}.log`);
  const fd = openSync(log, "a");
  const child = spawn("t3", ["serve", "--base-dir", server.home, "--port", String(server.port), "--host", "127.0.0.1", "--no-browser", "--mode", "web", server.cwd], {
    stdio: ["ignore", fd, fd], cwd: server.cwd, env: { ...process.env, T3CODE_HOME: server.home },
  });
  server.child = child; children.add(child);
  child.once("exit", () => { children.delete(child); if (server.child === child) server.child = null; });
  await until(`${server.name} server ready`, async () => {
    if (server.child !== child) throw new Error(`${server.name} server exited early; see its log inside the temp directory`);
    const found = await discoverServer(server.home);
    return found.ok && found.server.runtime.port === server.port ? found.server : undefined;
  }, 60_000, 300);
}
async function stopServer(server: ServerHandle): Promise<void> {
  const child = server.child; if (!child) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(8000)]);
  if (children.has(child)) { child.kill("SIGKILL"); await Promise.race([exited, sleep(2000)]); }
}
const killAll = () => { for (const child of children) try { child.kill("SIGKILL"); } catch { /* already gone */ } };
process.on("exit", killAll);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { killAll(); process.exit(130); });

const git = (cwd: string, ...args: string[]) => execFileAsync("git", args, { cwd });
async function makeRepo(dir: string, origin: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.email", "verify@example.invalid"); await git(dir, "config", "user.name", "Verify");
  await writeFile(join(dir, "README.md"), "# fixture\n");
  await git(dir, "add", "-A"); await git(dir, "commit", "-q", "-m", "init");
  await git(dir, "remote", "add", "origin", origin);
}
/** In-memory SecretStorage stand-in. */
function memorySecrets(): SecretBackend {
  const values = new Map<string, string>(); const listeners = new Set<(event: { key: string }) => unknown>();
  return {
    get: async (key) => values.get(key),
    store: async (key, value) => { values.set(key, value); for (const listener of listeners) listener({ key }); },
    delete: async (key) => { values.delete(key); for (const listener of listeners) listener({ key }); },
    onDidChange: (listener) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
  };
}
// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function main(): Promise<void> {
  const normal = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
  root = await realpath(await mkdtemp(join(tmpdir(), "t3-multi-env-")));
  if (root === normal || root.startsWith(`${normal}/`)) throw new Error("Verification must not use the live ~/.t3 home.");
  const mk = async (name: string, dir: string): Promise<ServerHandle> => {
    const home = join(root, dir, "home"), cwd = join(root, dir, "cwd"); await mkdir(home, { recursive: true }); await mkdir(cwd, { recursive: true });
    return { name, home, cwd, port: await freePort(), child: null };
  };
  const A = await mk("A", "a"), B = await mk("B", "b");
  if (A.port === B.port) throw new Error("Port collision");
  console.log(`Isolated tmp root: ${root}\nPorts: A=${A.port} B=${B.port}`);

  // Fixtures: window repo, B clone with the same origin, and an unrelated B repo.
  const ORIGIN = "https://github.com/acme/widget.git";
  const windowRepo = join(root, "window-repo"), remoteClone = join(root, "b-clone"), otherRepo = join(root, "b-other");
  await makeRepo(windowRepo, ORIGIN);
  await cp(windowRepo, remoteClone, { recursive: true });
  await makeRepo(otherRepo, "https://github.com/acme/unrelated.git");

  const catalog = new EnvironmentCatalog(memorySecrets());
  const multi = new MultiEnvironmentClient(new T3Client(), { reconnectDelayMs: 1500 });
  let host: HostState | null = null; let aClient: T3Client | null = null; let bClient: T3Client | null = null;
  try {
    await Promise.all([startServer(A), startServer(B)]);
    const discoveredA = await discoverServer(A.home); must(discoveredA.ok, "A discovery failed");
    const localEnvironmentId = discoveredA.server.descriptor.environmentId;

    // ---- Pairing through the new code path ----
    let record!: RemoteEnvironmentRecord;
    await check("pairRemoteEnvironment pairs with B from a /pair#token= link", async () => {
      const { stdout } = await execFileAsync("t3", ["pair", "--label", "VS Code verify", "--base-dir", B.home], { timeout: 45_000 });
      const token = /Token:\s*([0-9A-Z]{6,})/.exec(stdout)?.[1];
      must(token, "could not parse the pairing token from `t3 pair` output");
      record = await pairRemoteEnvironment(`http://127.0.0.1:${B.port}/pair#token=${token}`, { localEnvironmentId });
      must(record.enabled && record.accessToken.length > 0, "record is not enabled or has no access token");
      must(record.environmentId !== localEnvironmentId, "remote environment id equals the local one");
      must(record.httpBaseUrl.includes(String(B.port)), `unexpected httpBaseUrl ${record.httpBaseUrl}`);
      await catalog.upsert(record);
      must((await catalog.list()).length === 1, "catalog does not list the stored record");
    });
    if (!record) throw new Error("Pairing failed; cannot continue.");
    await check("pairing B with its own environment id as local is rejected", async () => {
      const { stdout } = await execFileAsync("t3", ["pair", "--label", "VS Code verify self", "--base-dir", B.home], { timeout: 45_000 });
      const token = /Token:\s*([0-9A-Z]{6,})/.exec(stdout)?.[1]; must(token, "no token");
      await pairRemoteEnvironment(`http://127.0.0.1:${B.port}/pair#token=${token}`, { localEnvironmentId: record.environmentId }).then(
        () => { throw new Error("expected rejection"); }, (error: Error) => must(/local T3 server/.test(error.message), `unexpected message: ${scrub(error.message)}`));
    });

    // ---- Own clients for seeding and out-of-band verification ----
    aClient = new T3Client();
    const sessionA = await pairWithServer({ home: A.home, origin: discoveredA.server.origin, environmentId: localEnvironmentId });
    await aClient.connect(discoveredA.server, sessionA.accessToken);
    const discoveredB = await discoverServer(B.home); must(discoveredB.ok, "B discovery failed");
    bClient = new T3Client();
    await bClient.connect(discoveredB.server, record.accessToken);
    const model = (() => {
      for (const provider of bClient!.config?.providers ?? []) { const slug = (provider.models.find((m) => m.isDefault) ?? provider.models[0])?.slug; if (slug) return { instanceId: provider.instanceId, model: slug }; }
      throw new Error("B advertises no provider model to create a thread with.");
    })();
    const newThread = async (client: T3Client, projectId: string, title: string) => {
      const id = randomUUID();
      await client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId: id, projectId, createdBy: "user", creationSource: "web", title,
        modelSelection: model, runtimeMode: "approval-required", interactionMode: "default", branch: null, worktreePath: null });
      return id;
    };
    const bProject = await bClient.createProject(remoteClone, "widget-remote");
    const bOtherProject = await bClient.createProject(otherRepo, "unrelated-remote");
    const bThread = await newThread(bClient, bProject, "Remote widget thread");
    const bOtherThread = await newThread(bClient, bOtherProject, "Remote unrelated thread");
    const aProject = await aClient.createProject(windowRepo, "widget-local");
    const aThread = await newThread(aClient, aProject, "Local widget thread");
    const bKey = await until("B's project to report a repository identity", async () => {
      const shell = await bClient!.snapshotShell(); return shell.projects.find((p) => p.id === bProject)?.repositoryIdentity?.canonicalKey;
    }, 15_000).catch(() => "");
    console.log(`B project canonicalKey: ${bKey || "(none)"}`);

    // ---- Headless HostState over the multi-environment client ----
    let session: PairedSession | null = null;
    const waitHost = async <T>(what: string, probe: (state: HostStateSnapshot) => T | undefined | false | null, timeoutMs = 20_000) => until(what, () => probe(host!.snapshot()), timeoutMs);
    await mkdir(join(root, "state"), { recursive: true });
    await check("MultiEnvironmentClient connects B and HostState starts ready", async () => {
      await multi.setRemoteEnvironments(await catalog.list());
      host = new HostState({
        home: A.home, workspaceRoots: () => [windowRepo], draftStore: new ComposerDraftStore(join(root, "state", "drafts")),
        worktreeStorageRoot: join(root, "state", "worktrees"), restoreStorageRoot: join(root, "state", "restore"),
        credentials: { get: async () => session, save: async (next) => { session = next; }, clear: async () => { session = null; } },
      }, multi);
      multi.onRemoteStatus = () => host?.remoteEnvironmentsChanged();
      await host.start();
      must(host.snapshot().phase === "ready", `phase ${host.snapshot().phase}: ${scrub(host.snapshot().notice ?? "")}`);
      await until("B remote connected", () => multi.remoteStatuses().find((s) => s.environmentId === record.environmentId)?.state === "connected", 20_000);
    });
    if (!host) throw new Error("HostState did not start.");
    const h: HostState = host;
    const labelB = record.label;

    await check("B's thread is listed with environmentLabel; local thread has none", async () => {
      const state = await waitHost("B thread in snapshot", (s) => s.threads.some((t) => t.id === bThread) && s);
      const remote = state.threads.find((t) => t.id === bThread)!;
      must(remote.environmentLabel === labelB, `environmentLabel=${remote.environmentLabel} expected ${labelB}`);
      const local = state.threads.find((t) => t.id === aThread);
      must(local && local.environmentLabel === undefined, `local thread missing or labelled: ${JSON.stringify(local?.environmentLabel)}`);
      const project = state.projects.find((p) => p.id === bProject);
      must(project?.environmentLabel === labelB, `B project environmentLabel=${project?.environmentLabel}`);
      must(state.environments?.rows.some((e) => e.environmentId === record.environmentId && e.status === "connected"), "environments.rows does not report B connected");
    });

    await check("project on B with a different repository is NOT visible", async () => {
      const state = h.snapshot();
      must(!state.projects.some((p) => p.id === bOtherProject), "unrelated B project is visible");
      must(!state.threads.some((t) => t.id === bOtherThread), "unrelated B thread is visible");
    });

    await check("selecting B's thread loads its transcript snapshot and flags a remote session", async () => {
      await h.selectThread(bThread);
      const state = await waitHost("B thread loaded", (s) => s.activeThreadId === bThread && !s.threadLoading && s);
      must(state.remoteSession?.environmentId === record.environmentId, `remoteSession=${JSON.stringify(state.remoteSession)}`);
      const projection = await bClient!.getThreadProjection(bThread);
      must(String(projection.thread.id) === bThread, "B's own projection does not match");
      must(state.transcript.length === 0 && projection.visibleTurnItems.length === 0, "transcript unexpectedly non-empty for a fresh thread");
      must(state.providers.length > 0, "providers for the active remote thread come from B but are empty");
    });

    await check("renaming B's thread through HostState changes the title on B (not on A)", async () => {
      await h.threadAction(bThread, "rename", "Renamed via HostState");
      await until("title on B", async () => (await bClient!.snapshotShell()).threads.find((t) => t.id === bThread)?.title === "Renamed via HostState", 10_000);
      must(h.snapshot().threads.find((t) => t.id === bThread)?.title === "Renamed via HostState", "HostState snapshot title not updated");
      must(!(await aClient!.snapshotShell()).threads.some((t) => t.id === bThread), "B's thread leaked to A");
    });

    await check("attachment uploaded while B's thread is active lands on B, not A", async () => {
      await h.selectThread(bThread);
      const draft = await h.uploadAttachment("pixel.png", "image/png", PNG, undefined, bThread);
      must(draft.attachment, "no attachment returned");
      const id = draft.attachment.id;
      must(draft.environmentId === record.environmentId, `draft.environmentId=${draft.environmentId}`);
      const holds = (home: string) => {
        const dir = join(home, "userdata", "attachments"); if (!existsSync(dir)) return false;
        const walk = (d: string): boolean => readdirSync(d, { withFileTypes: true }).some((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.includes(id));
        return walk(dir);
      };
      await until("attachment file on B", () => holds(B.home), 10_000);
      must(!holds(A.home), "attachment file also found on A");
      await h.releaseAttachment(id);
      await until("unsent attachment removed from B", () => !holds(B.home), 10_000);
    });

    await check("a new chat can choose B: B's project, checkouts and files come from B's server", async () => {
      h.registerView("remote-draft");
      const machines = h.snapshot("remote-draft").draft.machines;
      must(machines?.length === 2 && machines[0]!.local && machines[1]!.environmentId === record.environmentId && machines[1]!.status === "connected", `machines=${JSON.stringify(machines)}`);
      await h.chooseMachine(record.environmentId, "remote-draft");
      const draft = await until("B's checkouts listed", () => { const d = h.snapshot("remote-draft").draft; return d.remoteCheckouts && !d.remoteCheckouts.loading && d; }, 15_000);
      must(draft.environmentId === record.environmentId && draft.projectId === bProject && draft.workspaceRoot === remoteClone, `draft=${JSON.stringify({ e: draft.environmentId, p: draft.projectId, w: draft.workspaceRoot })}`);
      must(!draft.remoteCheckouts!.error && draft.remoteCheckouts!.items[0]?.root === true && draft.remoteCheckouts!.items[0]!.path === remoteClone && draft.remoteCheckouts!.items[0]!.branch === "main", `checkouts=${scrub(JSON.stringify(draft.remoteCheckouts))}`);
      const files = await h.composerSuggestions("path", "READ", false, "remote-draft");
      must(files.some((item) => item.value === "README.md"), `suggestions=${JSON.stringify(files.map((item) => item.value))}`);
      must(h.snapshot("remote-draft").providers.length > 0, "B's providers are not offered to the draft");
      await h.removeView("remote-draft");
    });

    await check("turn diff and restore are rejected for B's thread", async () => {
      for (const [name, run] of [
        ["prepareTurnDiff", () => h.prepareTurnDiff(bThread, bThread, "item")],
        ["restorePreview", () => h.restorePreview(bThread, bThread, { itemId: "item" })],
        ["restoreFiles", () => h.restoreFiles(bThread, bThread, { itemId: "item" }, [], "everything")],
      ] as const) {
        const error = await run().then(() => undefined, (cause: Error) => cause);
        must(error, `${name} unexpectedly succeeded`);
        must(/not available for sessions on/.test(error.message), `${name} rejected with an unexpected message: ${error.message}`);
      }
    });

    const recordNow = () => multi.remoteStatuses().find((s) => s.environmentId === record.environmentId);
    await check("disabling B removes its threads; the local thread stays", async () => {
      await multi.setRemoteEnvironments([{ ...record, enabled: false }]);
      const state = await waitHost("B thread gone", (s) => !s.threads.some((t) => t.id === bThread) && s);
      must(state.threads.some((t) => t.id === aThread), "local thread vanished with B");
      must(!state.projects.some((p) => p.id === bProject), "B project still listed");
      must(recordNow()?.state === "disabled", `status ${recordNow()?.state}`);
      must(state.activeThreadId !== bThread, "removed thread is still active");
    });
    await check("re-enabling B restores its threads and they are selectable", async () => {
      await multi.setRemoteEnvironments([record]);
      await waitHost("B thread back", (s) => s.threads.some((t) => t.id === bThread) && s);
      await h.selectThread(bThread);
      await waitHost("B thread loaded again", (s) => s.activeThreadId === bThread && !s.threadLoading && s.remoteSession !== undefined && s);
    });

    await check("stopping B marks it error while its threads stay listed", async () => {
      await stopServer(B);
      await until("remote state error", () => recordNow()?.state === "error", 20_000);
      const state = await waitHost("environments reconnecting", (s) => s.environments?.rows.find((e) => e.environmentId === record.environmentId)?.status === "reconnecting" && s, 10_000);
      must(state.environments?.indicator === "warn", `indicator=${state.environments?.indicator} while B is down`);
      must(state.threads.some((t) => t.id === bThread), "B's thread disappeared while B is down");
      must(state.phase === "ready", `local phase became ${state.phase}`);
      const error = await h.threadAction(bThread, "rename", "while down").then(() => undefined, (cause: Error) => cause);
      must(error && /disconnected/.test(error.message), `command to a down remote gave: ${error?.message ?? "success"}`);
    });
    await check("restarting B on the same port and base dir reconnects within 30 s", async () => {
      await startServer(B);
      await until("remote reconnected", () => recordNow()?.state === "connected", 30_000, 250);
      const state = await waitHost("thread list after reconnect", (s) => s.threads.some((t) => t.id === bThread) && s.environments?.rows.find((e) => e.environmentId === record.environmentId)?.status === "connected" && s, 10_000);
      await waitHost("active remote thread resubscribed", (s) => s.activeThreadId === bThread && !s.threadLoading && s, 15_000);
      await bClient!.disconnect().catch(() => undefined);
      const rediscovered = await discoverServer(B.home); must(rediscovered.ok, "B rediscovery failed");
      bClient = new T3Client(); await bClient.connect(rediscovered.server, record.accessToken);
      await h.threadAction(bThread, "rename", "After reconnect");
      await until("rename after reconnect on B", async () => (await bClient!.snapshotShell()).threads.find((t) => t.id === bThread)?.title === "After reconnect", 10_000);
      must(state.remoteSession !== undefined || h.snapshot().remoteSession !== undefined, "remote session flag lost after reconnect");
    });

    if (LIVE) {
      await check("live: message to B's thread through HostState gets an assistant reply on B", async () => {
        await h.selectThread(bThread);
        await waitHost("thread active", (s) => s.activeThreadId === bThread && !s.threadLoading && s);
        await h.setModel(bThread, liveTestSelection(h.snapshot()));
        await h.sendMessage("Reply with exactly: MULTI-ENV-OK", bThread);
        await until("assistant reply on B", async () => {
          const projection = await bClient!.getThreadProjection(bThread);
          return projection.visibleTurnItems.some((row) => row.item.type === "assistant_message" && "text" in row.item && String(row.item.text).includes("MULTI-ENV-OK"));
        }, 150_000, 1500);
      });
      await check("live: a new chat on B launches on B with its first message, in B's root checkout", async () => {
        h.registerView("remote-root"); await h.chooseMachine(record.environmentId, "remote-root");
        await h.setModel(undefined, liveTestSelection(h.snapshot("remote-root")), "remote-root");
        await h.sendMessage("Reply with exactly: REMOTE-LAUNCH-OK", undefined, "remote-root");
        const id = h.snapshot("remote-root").activeThreadId;
        must(id, "the tab did not switch to the launched conversation");
        must(h.snapshot("remote-root").remoteSession?.environmentId === record.environmentId, "the launched conversation is not flagged as running on B");
        must((await bClient!.snapshotShell()).threads.some((t) => t.id === id), "the thread is not on B");
        must(!(await aClient!.snapshotShell()).threads.some((t) => t.id === id), "the thread leaked to A");
        await until("assistant reply on B", async () => (await bClient!.getThreadProjection(id!)).visibleTurnItems.some((row) => row.item.type === "assistant_message" && "text" in row.item && String(row.item.text).includes("REMOTE-LAUNCH-OK")), 150_000, 1500);
      });
      await check("live: a new chat on B in a new worktree gets that worktree created on B", async () => {
        h.registerView("remote-worktree"); await h.chooseMachine(record.environmentId, "remote-worktree");
        await until("B's checkouts listed", () => h.snapshot("remote-worktree").draft.remoteCheckouts?.loading === false, 15_000);
        await h.setModel(undefined, liveTestSelection(h.snapshot("remote-worktree")), "remote-worktree");
        await h.configureWorktree({ type: "new", baseRef: "main", branch: "t3/remote-launch" }, bProject, "remote-worktree");
        await h.sendMessage("Reply with exactly: REMOTE-WORKTREE-OK", undefined, "remote-worktree");
        const id = h.snapshot("remote-worktree").activeThreadId!;
        const thread = await until("the worktree bound on B", async () => (await bClient!.snapshotShell()).threads.find((t) => t.id === id && t.worktreePath && t.branch), 120_000, 1000);
        must(thread.branch === "t3/remote-launch" && thread.worktreePath !== remoteClone, `branch=${thread.branch} path=${thread.worktreePath}`);
        must(existsSync(thread.worktreePath!), "the worktree folder does not exist on B's disk");
        await until("assistant reply on B", async () => (await bClient!.getThreadProjection(id)).visibleTurnItems.some((row) => row.item.type === "assistant_message" && "text" in row.item && String(row.item.text).includes("REMOTE-WORKTREE-OK")), 150_000, 1500);
      });
    } else console.log("SKIP: live turn (set T3_VSCODE_LIVE=1)");
  } finally {
    await (host as HostState | null)?.dispose().catch(() => undefined);
    await multi.dispose().catch(() => undefined);
    await aClient?.disconnect().catch(() => undefined);
    await bClient?.disconnect().catch(() => undefined);
    await Promise.all([A, B].map((s) => s && stopServer(s).catch(() => undefined)));
    killAll();
  }
}

try { await main(); }
catch (cause) { results.push({ name: "setup", ok: false, detail: scrub(cause instanceof Error ? cause.stack ?? cause.message : String(cause)) }); console.log(`FAIL: setup\n      ${results.at(-1)!.detail}`); }
finally { killAll(); if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed.length ? 1 : 0);
