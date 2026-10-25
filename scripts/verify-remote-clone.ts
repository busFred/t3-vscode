/**
 * Real "Add to another machine" verification: two isolated `t3 serve` homes in a temp directory. A is this computer
 * with a window checkout of a small public repository; C is a paired machine without it. The extension clones the
 * repository onto C into a temp folder, copies an ignored env file, and C then offers the repository like any other.
 * Deterministic by default; T3_VSCODE_LIVE=1 adds one low-effort live turn launched on C in the clone.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, appendFile } from "node:fs/promises";
import { openSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import { MultiEnvironmentClient } from "../src/host/multiEnvironmentClient.js";
import { EnvironmentCatalog, pairRemoteEnvironment, type SecretBackend } from "../src/host/environmentCatalog.js";
import { discoverServer } from "../src/host/serverDiscovery.js";
import { pairWithServer, type PairedSession } from "../src/host/pairing.js";
import { ComposerDraftStore } from "../src/host/composerDraftStore.js";
import { liveTestSelection } from "./liveTestModel.js";

const execFileAsync = promisify(execFile);
const LIVE = process.env.T3_VSCODE_LIVE === "1";
const REPOSITORY = "https://github.com/octocat/Hello-World.git";
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const children = new Set<ChildProcess>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function must(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS: ${name}`); }
  catch (cause) { const detail = cause instanceof Error ? cause.message : String(cause); results.push({ name, ok: false, detail }); console.log(`FAIL: ${name}\n      ${detail}`); }
}
async function until<T>(what: string, probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, timeoutMs = 20_000, intervalMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const value = await probe(); if (value) return value; if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`); await sleep(intervalMs); }
}
const freePort = () => new Promise<number>((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); }); });
interface ServerHandle { readonly name: string; readonly home: string; readonly cwd: string; readonly port: number; child: ChildProcess | null }
async function startServer(server: ServerHandle): Promise<void> {
  const fd = openSync(join(server.home, "serve.log"), "a");
  const child = spawn("t3", ["serve", "--base-dir", server.home, "--port", String(server.port), "--host", "127.0.0.1", "--no-browser", "--mode", "web", server.cwd], { stdio: ["ignore", fd, fd], cwd: server.cwd, env: { ...process.env, T3CODE_HOME: server.home } });
  server.child = child; children.add(child); child.once("exit", () => children.delete(child));
  await until(`${server.name} ready`, async () => { const found = await discoverServer(server.home); return found.ok && found.server.runtime.port === server.port; }, 60_000, 300);
}
const killAll = () => { for (const child of children) try { child.kill("SIGKILL"); } catch { /* gone */ } };
process.on("exit", killAll);
function memorySecrets(): SecretBackend {
  const values = new Map<string, string>(); const listeners = new Set<(event: { key: string }) => unknown>();
  return { get: async (key) => values.get(key), store: async (key, value) => { values.set(key, value); listeners.forEach((listener) => listener({ key })); },
    delete: async (key) => { values.delete(key); listeners.forEach((listener) => listener({ key })); }, onDidChange: (listener) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; } };
}

const started = Date.now();
let root = "";
async function main(): Promise<void> {
  const normal = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
  root = await realpath(await mkdtemp(join(tmpdir(), "t3-remote-clone-")));
  if (root === normal || root.startsWith(`${normal}/`)) throw new Error("Verification must not use the live ~/.t3 home.");
  const mk = async (name: string, dir: string): Promise<ServerHandle> => {
    const home = join(root, dir, "home"), cwd = join(root, dir, "cwd"); await mkdir(home, { recursive: true }); await mkdir(cwd, { recursive: true });
    return { name, home, cwd, port: await freePort(), child: null };
  };
  const A = await mk("A", "a"), C = await mk("C", "c");
  const windowRepo = join(root, "window-repo"), destination = join(root, "c-projects", "Hello-World");
  await execFileAsync("git", ["clone", "-q", "--depth", "1", REPOSITORY, windowRepo], { timeout: 60_000 });
  // An ignored env file, excluded locally so the public repository's tracked files stay untouched.
  await writeFile(join(windowRepo, ".env"), "VERIFY_TOKEN=remote-clone\n"); await appendFile(join(windowRepo, ".git", "info", "exclude"), ".env\n");
  console.log(`Isolated tmp root: ${root}`);
  const catalog = new EnvironmentCatalog(memorySecrets());
  const multi = new MultiEnvironmentClient(new T3Client(), { reconnectDelayMs: 1500 });
  let host: HostState | null = null; const cClient = new T3Client();
  try {
    await Promise.all([startServer(A), startServer(C)]);
    const discoveredA = await discoverServer(A.home); must(discoveredA.ok, "A discovery failed");
    const { stdout } = await execFileAsync("t3", ["pair", "--label", "VS Code clone verify", "--base-dir", C.home], { timeout: 45_000 });
    const token = /Token:\s*([0-9A-Z]{6,})/.exec(stdout)?.[1]; must(token, "no pairing token from `t3 pair`");
    const record = await pairRemoteEnvironment(`http://127.0.0.1:${C.port}/pair#token=${token}`, { localEnvironmentId: discoveredA.server.descriptor.environmentId });
    await catalog.upsert(record);
    console.log(`C pairing scopes: ${record.scopes.join(" ") || "(none recorded)"}`);
    const aClient = new T3Client();
    await aClient.connect(discoveredA.server, (await pairWithServer({ home: A.home, origin: discoveredA.server.origin, environmentId: discoveredA.server.descriptor.environmentId })).accessToken);
    await aClient.createProject(windowRepo, "Hello-World");
    await until("A's project to report its repository", async () => (await aClient.snapshotShell()).projects.some((project) => project.repositoryIdentity?.locator.remoteUrl), 20_000);
    await aClient.disconnect();
    const discoveredC = await discoverServer(C.home); must(discoveredC.ok, "C discovery failed");
    await cClient.connect(discoveredC.server, record.accessToken);
    let session: PairedSession | null = null;
    await multi.setRemoteEnvironments(await catalog.list());
    host = new HostState({ home: A.home, workspaceRoots: () => [windowRepo], draftStore: new ComposerDraftStore(join(root, "drafts")),
      credentials: { get: async () => session, save: async (next) => { session = next; }, clear: async () => { session = null; } } }, multi);
    multi.onRemoteStatus = () => host?.remoteEnvironmentsChanged();
    await host.start();
    must(host.snapshot().phase === "ready", `phase ${host.snapshot().phase}`);
    const h = host;
    h.registerView("tab", undefined, false); h.beginNewChat("tab");

    await check("C, which lacks the repository, is offered for cloning with that machine's default folder", async () => {
      const target = await until("C as a clone target", () => h.snapshot("tab").draft.addTargets?.find((entry) => entry.environmentId === record.environmentId), 20_000);
      must(target.available, `C is not available: ${target.reason}`);
      must(target.defaultDestination.endsWith("Hello-World"), `defaultDestination=${target.defaultDestination}`);
      must(h.snapshot("tab").draft.cloneSource?.httpsUrl === REPOSITORY, `cloneSource=${JSON.stringify(h.snapshot("tab").draft.cloneSource)}`);
      const files = await h.listCopyableFiles();
      must(files.some((file) => file.path === ".env" && file.checked), `files=${JSON.stringify(files)}`);
    });
    await check("cloning onto C points the new chat there, waits for the clone, then copies the env file", async () => {
      // An explicit temp destination: C runs as this user, so its default folder would be in the real home directory.
      await h.startClone({ environmentId: record.environmentId, destinationPath: destination, protocol: "https", files: [".env"] }, "tab");
      must(h.snapshot("tab").draft.environmentId === record.environmentId, "the draft did not move to C");
      await until("the clone and copy to finish", () => !h.snapshot("tab").draft.clone && h.snapshot("tab").draft.environmentId === record.environmentId, 120_000, 500);
      must((await readFile(join(destination, "README"), "utf8")).length > 0, "the clone has no README");
      must((await readFile(join(destination, ".env"), "utf8")) === "VERIFY_TOKEN=remote-clone\n", "the env file was not copied");
      must((await cClient.snapshotShell()).projects.some((project) => project.workspaceRoot === destination), "C does not list the cloned project");
    });
    await check("once cloned, C is offered in the regular Run on list for this repository", async () => {
      await until("C among the machines", () => h.snapshot("tab").draft.machines?.some((machine) => machine.environmentId === record.environmentId), 30_000, 500);
      must(!h.snapshot("tab").draft.addTargets?.some((entry) => entry.environmentId === record.environmentId), "C is still offered for cloning");
    });
    if (LIVE) await check("live: the first message launches on C in the cloned checkout", async () => {
      await h.setModel(undefined, liveTestSelection(h.snapshot("tab")), "tab");
      await h.sendMessage("Reply with exactly: REMOTE-CLONE-OK", undefined, "tab");
      const id = h.snapshot("tab").activeThreadId; must(id, "the tab did not follow the launched conversation");
      const thread = (await cClient.snapshotShell()).threads.find((entry) => entry.id === id); must(thread, "the thread is not on C");
      await until("assistant reply on C", async () => (await cClient.getThreadProjection(id)).visibleTurnItems.some((row) => row.item.type === "assistant_message" && "text" in row.item && String(row.item.text).includes("REMOTE-CLONE-OK")), 150_000, 1500);
    });
    else console.log("SKIP: live turn (set T3_VSCODE_LIVE=1)");
  } finally {
    await host?.dispose().catch(() => undefined); await multi.dispose().catch(() => undefined); await cClient.disconnect().catch(() => undefined);
    for (const child of children) child.kill("SIGTERM");
    await sleep(1500); killAll();
  }
}
try { await main(); }
catch (cause) { results.push({ name: "setup", ok: false, detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause) }); console.log(`FAIL: setup\n      ${results.at(-1)!.detail}`); }
finally { killAll(); if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined); }
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed.length ? 1 : 0);
