import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ProjectId, ThreadId, type OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { v2Project, v2ThreadShell, v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { HostState, SIDEBAR_VIEW_ID, type HostTransport } from "./hostState.js";
import type { RemoteConnectionState } from "../shared/environmentStatus.js";
import { FakeTransport, provider, server, credentials, publishText } from "./testing/fakeTransport.js";

const run = promisify(execFile);
const REMOTE = { environmentId: "studio", label: "Studio Mac" };
const REMOTE_OTHER = { environmentId: "devbox", label: "Dev Box" };
const identity = (canonicalKey: string) => ({ canonicalKey, locator: { source: "git-remote", remoteName: "origin", remoteUrl: `https://${canonicalKey}.git` } }) as never;
const remoteModel = { instanceId: provider.instanceId, model: "remote-model" };

/** A transport that behaves like MultiEnvironmentClient: some projects and threads belong to remote environments. */
class RemoteTransport extends FakeTransport {
  threadOwners = new Map<string, { environmentId: string; label: string }>();
  projectOwners = new Map<string, { environmentId: string; label: string }>();
  remoteProviders = { providers: [{ ...provider, displayName: "Remote Kimi" }] };
  statuses: Array<{ environmentId: string; label: string; httpBaseUrl: string; enabled: boolean; state: RemoteConnectionState; error?: string; serverVersion?: string; expiresAt: number | null; ignoredStatus?: "reconnecting" | "expiring" | "expired" }> = [];
  remoteUploads: Array<{ name: string; environmentId: string | undefined }> = [];
  remoteDeletes: Array<{ id: string; environmentId: string | undefined }> = [];
  baselines: string[] = [];
  threadEnvironment = (id: string | undefined) => id ? this.threadOwners.get(id) : undefined;
  projectEnvironment = (id: string | undefined) => id ? this.projectOwners.get(id) : undefined;
  configForThread = (id: string | undefined) => id && this.threadOwners.has(id) ? this.remoteProviders as never : this.config as never;
  remoteStatuses = () => this.statuses;
  launches: Array<{ environmentId: string; input: Record<string, unknown> & { initialMessage?: { text: string; attachments: ReadonlyArray<{ id: string }> }; workspaceStrategy?: unknown } }> = [];
  remoteSearches: Array<{ environmentId: string; cwd: string; query: string }> = [];
  remoteRefs = [
    { name: "main", current: true, isDefault: true, worktreePath: "/home/dev/widget" },
    { name: "feature/x", current: false, isDefault: false, worktreePath: "/home/dev/widget-x" },
    { name: "origin/main", isRemote: true, remoteName: "origin", current: false, isDefault: false, worktreePath: null },
  ];
  configForEnvironment = (id: string | undefined) => id ? this.remoteProviders as never : this.config as never;
  /** A paired machine's server: launching adds the thread to that machine's shell, as the real server's stream would. */
  environmentCalls = (environmentId: string) => {
    const status = this.statuses.find((entry) => entry.environmentId === environmentId);
    if (status?.state !== "connected") throw new Error(`${status?.label ?? environmentId} is disconnected. Wait for it to reconnect, then retry.`);
    return {
      launchThread: async (input: { projectId: string; title: string; modelSelection: unknown }) => {
        this.launches.push({ environmentId, input: input as never });
        const threadId = ThreadId.make(`launched-${this.launches.length}`);
        this.threadOwners.set(threadId, { environmentId, label: status.label });
        this.shell = { ...this.shell, threads: [...this.shell.threads, { ...v2ThreadShell, id: threadId, projectId: ProjectId.make(input.projectId), title: input.title, modelSelection: input.modelSelection as never }] };
        return { threadId, projection: null, resumed: false };
      },
      listRefs: async () => ({ refs: this.remoteRefs, isRepo: true, hasPrimaryRemote: true, nextCursor: null, totalCount: this.remoteRefs.length }),
      searchPaths: async (cwd: string, query: string) => { this.remoteSearches.push({ environmentId, cwd, query }); return { entries: [{ path: "src/app.ts", kind: "file" }], truncated: false }; },
      refreshProviders: async () => [],
      startProjectClone: async (input: { projectId: string; destinationPath: string; remoteUrl: string; protocol?: string; title: string }) => {
        this.cloneStarts.push({ environmentId, input });
        return { projectId: input.projectId, cwd: input.destinationPath, remoteUrl: input.remoteUrl, repository: null };
      },
      subscribeProjectClones: async (handler: (clones: ReadonlyArray<unknown>) => void) => { this.cloneHandlers.set(environmentId, handler); return async () => { this.cloneHandlers.delete(environmentId); }; },
      cancelProjectClone: async (projectId: string) => { this.cloneActions.push(`cancel:${projectId}`); return { applied: true }; },
      retryProjectClone: async (projectId: string) => { this.cloneActions.push(`retry:${projectId}`); return { applied: true }; },
      writeProjectFile: async (cwd: string, relativePath: string, contents: string) => { this.fileWrites.push({ environmentId, cwd, relativePath, contents }); return { relativePath }; },
      deleteProject: async (projectId: string) => { this.cloneActions.push(`delete:${projectId}`); },
    } as never;
  };
  cloneStarts: Array<{ environmentId: string; input: { projectId: string; destinationPath: string; remoteUrl: string; protocol?: string; title: string } }> = [];
  cloneHandlers = new Map<string, (clones: ReadonlyArray<unknown>) => void>();
  cloneActions: string[] = [];
  fileWrites: Array<{ environmentId: string; cwd: string; relativePath: string; contents: string }> = [];
  access = new Map<string, "ok" | "disconnected" | "unsupported" | "permission">();
  cloneAccess = (id: string) => this.access.get(id) ?? (this.statuses.find((entry) => entry.environmentId === id)?.state === "connected" ? "ok" : "disconnected");
  constructor() {
    super();
    // FakeTransport declares the single-argument signatures; the multi-environment transport adds the environment id.
    Object.assign(this, {
      uploadAttachment: async (input: { name: string; type?: string }, _bytes: Uint8Array, environmentId?: string) => {
        this.remoteUploads.push({ name: input.name, environmentId });
        return { ...input, type: input.type ?? "image", id: `${environmentId ?? "local"}-att-${this.remoteUploads.length}` };
      },
      deleteAttachment: async (id: string, environmentId?: string) => { this.remoteDeletes.push({ id, environmentId }); },
    });
  }
  override captureTurnBaseline: HostTransport["captureTurnBaseline"] = async (_cwd, id) => { this.baselines.push(id); };
}

interface Fixture { host: HostState; client: RemoteTransport; repo: string; cleanup(): Promise<void> }
async function fixture(options: { remoteWorkspaceRoot?: (repo: string) => string; origin?: string | null; withWorktrees?: boolean } = {}): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "t3-remote-host-"));
  const root = await realpath(base), repo = join(root, "repo");
  await mkdir(repo);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com" };
  const previous = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
  await run("git", ["init", "-q"], { cwd: repo, env });
  if (options.origin !== null) await run("git", ["remote", "add", "origin", options.origin ?? "https://github.com/acme/widget.git"], { cwd: repo, env });

  const client = new RemoteTransport();
  const remoteRoot = options.remoteWorkspaceRoot?.(repo) ?? "/home/dev/widget";
  const shell: OrchestrationV2ShellSnapshot = { ...v2ShellSnapshot,
    projects: [
      { ...v2Project, id: ProjectId.make("local-project"), title: "local", workspaceRoot: repo },
      { ...v2Project, id: ProjectId.make("remote-match"), title: "widget", workspaceRoot: remoteRoot, repositoryIdentity: identity("github.com/acme/widget") },
      { ...v2Project, id: ProjectId.make("remote-other"), title: "other", workspaceRoot: "/home/dev/other", repositoryIdentity: identity("github.com/acme/other") },
    ],
    threads: [
      { ...v2ThreadShell, id: ThreadId.make("local-thread"), projectId: ProjectId.make("local-project"), title: "local thread", modelSelection: { instanceId: provider.instanceId, model: provider.models[0]!.slug } },
      { ...v2ThreadShell, id: ThreadId.make("remote-thread"), projectId: ProjectId.make("remote-match"), title: "remote thread", modelSelection: remoteModel },
      { ...v2ThreadShell, id: ThreadId.make("other-thread"), projectId: ProjectId.make("remote-other"), title: "other thread", modelSelection: remoteModel },
    ] as never,
  };
  client.shell = shell as never;
  client.projectOwners.set("remote-match", REMOTE); client.projectOwners.set("remote-other", REMOTE_OTHER);
  client.threadOwners.set("remote-thread", REMOTE); client.threadOwners.set("other-thread", REMOTE_OTHER);
  client.statuses = [{ ...REMOTE, httpBaseUrl: "https://studio.example", enabled: true, state: "connected", expiresAt: null }];
  const host = new HostState({ home: "/tmp/fake-t3-remote-test", credentials, discover: async () => ({ ok: true, server }), reconnectDelayMs: 0,
    workspaceRoots: () => [repo], workspaceRoot: () => repo,
    ...(options.withWorktrees ? { worktreeStorageRoot: join(root, "worktree-storage") } : {}) }, client);
  await host.start();
  return { host, client, repo, cleanup: async () => {
    await host.dispose();
    for (const [key, value] of [["GIT_CONFIG_GLOBAL", previous.global], ["GIT_CONFIG_NOSYSTEM", previous.system]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(base, { recursive: true, force: true });
  } };
}

test("Remote projects are visible only when a window folder's Git remote matches their repository identity", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const state = f.host.snapshot();
  assert.deepEqual(state.projects.map((p) => p.id).sort(), ["local-project", "remote-match"]);
  assert.deepEqual(state.threads.map((th) => th.id).sort(), ["local-thread", "remote-thread"]);
  assert.equal(state.projects.find((p) => p.id === "remote-match")!.environmentLabel, "Studio Mac");
  assert.equal(state.projects.find((p) => p.id === "local-project")!.environmentLabel, undefined);
  assert.equal(state.threads.find((th) => th.id === "remote-thread")!.environmentLabel, "Studio Mac");
  assert.equal("environmentLabel" in state.threads.find((th) => th.id === "local-thread")!, false);
});

test("Matching ignores case and URL form of the origin remote", async (t) => {
  const f = await fixture({ origin: "git@GitHub.com:Acme/Widget.git" }); t.after(f.cleanup);
  assert.ok(f.host.snapshot().projects.some((p) => p.id === "remote-match"));
});

test("Without a matching Git remote no remote project is visible", async (t) => {
  const f = await fixture({ origin: "https://github.com/someone/else.git" }); t.after(f.cleanup);
  assert.deepEqual(f.host.snapshot().projects.map((p) => p.id), ["local-project"]);
  assert.deepEqual(f.host.snapshot().threads.map((th) => th.id), ["local-thread"]);
});

test("Without any Git remote no remote project is visible", async (t) => {
  const f = await fixture({ origin: null }); t.after(f.cleanup);
  assert.deepEqual(f.host.snapshot().projects.map((p) => p.id), ["local-project"]);
});

test("A remote project whose workspaceRoot equals the local window path is not treated as local", async (t) => {
  // Same path, different repository: path equality alone must not make the remote project visible.
  const mismatched = await fixture({ origin: "https://github.com/someone/else.git", remoteWorkspaceRoot: (repo) => repo }); t.after(mismatched.cleanup);
  assert.deepEqual(mismatched.host.snapshot().projects.map((p) => p.id), ["local-project"]);
  // Same path and same repository: it is visible, but still remote (labelled, and not usable for new local work).
  const matched = await fixture({ remoteWorkspaceRoot: (repo) => repo }); t.after(matched.cleanup);
  const state = matched.host.snapshot();
  assert.equal(state.projects.find((p) => p.id === "remote-match")?.environmentLabel, "Studio Mac");
  await assert.rejects(matched.host.newThread("remote-match"), /Send the first message to start a conversation on another machine/);
  const created = await matched.host.newThread();
  assert.equal(matched.client.commands.findLast((c) => c.type === "thread.create")?.projectId, "local-project");
  assert.ok(created);
});

test("The active remote thread exposes remoteSession and its own providers; local threads do not", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.selectThread("remote-thread");
  let state = f.host.snapshot();
  assert.equal(state.activeThreadId, "remote-thread");
  assert.deepEqual(state.remoteSession, REMOTE);
  assert.equal(state.providers[0]!.displayName, "Remote Kimi");
  assert.deepEqual(state.environments?.rows, [{ environmentId: "studio", label: "Studio Mac", host: "studio.example", status: "connected", expiresAt: null, ignored: false }]);
  await f.host.selectThread("local-thread");
  state = f.host.snapshot();
  assert.equal(state.remoteSession, undefined);
  assert.equal(state.providers[0]!.displayName, provider.displayName);
});

const STUDIO = { ...REMOTE, httpBaseUrl: "https://studio.example:8443", enabled: true, expiresAt: null } as const;
const DAY = 24 * 60 * 60 * 1000;

test("environments is omitted without remoteStatuses, and present with empty rows when none are paired", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  f.client.statuses = [];
  const empty = f.host.snapshot().environments;
  assert.deepEqual(empty?.rows, []);
  assert.equal(empty?.indicator, "ok");
  assert.equal("remoteEnvironments" in f.host.snapshot(), false);
  Object.assign(f.client, { remoteStatuses: undefined });
  assert.equal("environments" in f.host.snapshot(), false);
});

test("environments.local describes this computer's server", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const local = f.host.snapshot().environments?.local;
  assert.equal(local?.label, "Audit");
  assert.equal(local?.host, "audit.invalid");
  assert.equal(local?.serverVersion, undefined);
});

test("environments rows carry host, status, detail, version and expiry for each machine state", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const soon = Date.now() + 1.5 * DAY;
  f.client.statuses = [
    { ...STUDIO, state: "connected", serverVersion: "1.2.3" },
    { ...STUDIO, environmentId: "b", label: "B", state: "connecting" },
    { ...STUDIO, environmentId: "c", label: "C", state: "error", error: "Connection lost." },
    { ...STUDIO, environmentId: "d", label: "D", state: "connected", expiresAt: soon },
    { ...STUDIO, environmentId: "e", label: "E", state: "expired", error: "This pairing expired. Pair the machine again with a new link." },
    { ...STUDIO, environmentId: "f", label: "F", state: "disabled", enabled: false, error: "ignored text" },
    { ...STUDIO, environmentId: "g", label: "G", state: "connected", enabled: false },
  ];
  const { rows, indicator } = f.host.snapshot().environments!;
  const byId = Object.fromEntries(rows.map((r) => [r.environmentId, r]));
  assert.deepEqual(byId.studio, { environmentId: "studio", label: "Studio Mac", host: "studio.example:8443", serverVersion: "1.2.3", status: "connected", expiresAt: null, ignored: false });
  assert.equal(byId.b!.status, "connecting"); assert.equal(byId.b!.detail, undefined);
  assert.equal(byId.c!.status, "reconnecting"); assert.equal(byId.c!.detail, "Connection lost.");
  assert.equal(byId.d!.status, "expiring"); assert.equal(byId.d!.detail, "Expires in 1 day"); assert.equal(byId.d!.expiresAt, soon);
  assert.equal(byId.e!.status, "expired"); assert.match(byId.e!.detail!, /pairing expired/);
  assert.equal(byId.f!.status, "disabled"); assert.equal(byId.f!.detail, undefined);
  assert.equal(byId.g!.status, "disabled");
  assert.equal(indicator, "error");
});

test("environments indicator follows the worst open problem", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  assert.equal(f.host.snapshot().environments?.indicator, "ok");
  f.client.statuses = [{ ...STUDIO, state: "error", error: "Connection lost." }];
  assert.equal(f.host.snapshot().environments?.indicator, "warn");
  f.client.statuses = [{ ...STUDIO, state: "error", error: "x" }, { ...STUDIO, environmentId: "b", label: "B", state: "expired" }];
  assert.equal(f.host.snapshot().environments?.indicator, "error");
});

test("a row is ignored only when ignoredStatus equals its current status", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const ignoredOf = (status: Partial<(typeof f.client.statuses)[number]>) => {
    f.client.statuses = [{ ...STUDIO, state: "error", error: "x", ...status }];
    return f.host.snapshot().environments!;
  };
  let env = ignoredOf({ ignoredStatus: "reconnecting" });
  assert.equal(env.rows[0]!.status, "reconnecting");
  assert.equal(env.rows[0]!.ignored, true);
  assert.equal(env.indicator, "ok");
  // A different problem than the one ignored still counts.
  env = ignoredOf({ ignoredStatus: "expiring" });
  assert.equal(env.rows[0]!.ignored, false);
  assert.equal(env.indicator, "warn");
  env = ignoredOf({ state: "expired", ignoredStatus: "reconnecting" });
  assert.equal(env.rows[0]!.status, "expired");
  assert.equal(env.rows[0]!.ignored, false);
  assert.equal(env.indicator, "error");
  env = ignoredOf({ state: "expired", ignoredStatus: "expired" });
  assert.equal(env.rows[0]!.ignored, true);
  assert.equal(env.indicator, "ok");
  // Ignored expiring, then the machine reconnects normally with a far expiry: nothing to ignore.
  env = ignoredOf({ state: "connected", expiresAt: Date.now() + 10 * DAY, ignoredStatus: "expiring" });
  assert.equal(env.rows[0]!.status, "connected");
  assert.equal(env.rows[0]!.ignored, false);
  env = ignoredOf({ state: "connected", expiresAt: Date.now() + DAY, ignoredStatus: "expiring" });
  assert.equal(env.rows[0]!.status, "expiring");
  assert.equal(env.rows[0]!.ignored, true);
  assert.equal(env.indicator, "ok");
});

test("An empty thread is never created in a remote project; only a first message launches one", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  // An empty thread is never created on another machine: its first message launches it there.
  await assert.rejects(f.host.newThread("remote-match"), /Send the first message to start a conversation on another machine\./);
  await assert.rejects(f.host.chooseProject("remote-match"), /on another machine\. Choose the machine above the message box/);
  assert.equal(f.client.commands.some((c) => c.type === "thread.create" && c.projectId === "remote-match"), false);
});

test("Saved-turn diffs, file restores and checkout actions are rejected for remote threads", async (t) => {
  const f = await fixture({ withWorktrees: true }); t.after(f.cleanup);
  const message = /is not available for sessions on Studio Mac yet\./;
  await assert.rejects(f.host.prepareTurnDiff("remote-thread", "remote-thread", "item"), /Saved turn diffs is not available for sessions on Studio Mac yet\./);
  await assert.rejects(f.host.restoreFiles("remote-thread", "remote-thread", { itemId: "item" }, [], "everything"), /Restoring files is not available for sessions on Studio Mac yet\./);
  await assert.rejects(f.host.restorePreview("remote-thread", "remote-thread", { itemId: "item" }), /Restoring files is not available/);
  await assert.rejects(f.host.adoptCheckoutBranch("remote-thread"), message);
  await assert.rejects(f.host.switchCheckoutToSessionBranch("remote-thread"), message);
  await assert.rejects(f.host.prepareThreadWorkspace("remote-thread", { type: "main" } as never), /Checkout actions is not available for sessions on Studio Mac yet\./);
  await assert.rejects(f.host.setSessionBranchPolicy("remote-thread", "follow"), message);
  await assert.rejects(f.host.restorePreview("local-thread", "remote-thread", { itemId: "item" }), /Restoring files is not available/);
  assert.equal(f.client.savedDiffRequests.length, 0);
});

test("Sending to a remote thread dispatches through the transport without capturing a local baseline", async (t) => {
  const f = await fixture({ withWorktrees: true }); t.after(f.cleanup);
  await f.host.selectThread("remote-thread");
  await f.host.sendMessage("hello remote", "remote-thread");
  const dispatched = f.client.commands.filter((c) => c.type === "message.dispatch");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]!.threadId, "remote-thread");
  assert.equal(dispatched[0]!.text, "hello remote");
  assert.deepEqual(f.client.baselines, []);
  // A local thread still captures its baseline.
  await f.host.selectThread("local-thread");
  await f.host.sendMessage("hello local", "local-thread");
  assert.deepEqual(f.client.baselines, ["local-thread"]);
});

test("Attachments for a remote thread upload and delete against that environment", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.selectThread("remote-thread");
  const remote = await f.host.uploadAttachment("notes.txt", "text/plain", new Uint8Array([1, 2]), undefined, "remote-thread");
  assert.deepEqual(f.client.remoteUploads, [{ name: "notes.txt", environmentId: "studio" }]);
  assert.equal(remote.environmentId, "studio");
  await f.host.releaseAttachment(remote.attachment!.id);
  assert.deepEqual(f.client.remoteDeletes, [{ id: remote.attachment!.id, environmentId: "studio" }]);

  await f.host.selectThread("local-thread");
  const local = await f.host.uploadAttachment("local.txt", "text/plain", new Uint8Array([3]), undefined, "local-thread");
  assert.deepEqual(f.client.remoteUploads[1], { name: "local.txt", environmentId: undefined });
  await f.host.releaseAttachment(local.attachment!.id);
  assert.deepEqual(f.client.remoteDeletes[1], { id: local.attachment!.id, environmentId: undefined });
});

test("An attachment uploaded for a remote thread is accepted by that thread's send but refused for a local thread", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.selectThread("remote-thread");
  const remote = await f.host.uploadAttachment("notes.txt", "text/plain", new Uint8Array([1, 2]), undefined, "remote-thread");
  await assert.rejects(f.host.sendMessage("wrong target", "local-thread", undefined, "auto", [remote.attachment!.id]), /not available in the current chat/);
  await f.host.sendMessage("right target", "remote-thread", undefined, "auto", [remote.attachment!.id]);
  const sent = f.client.commands.findLast((c) => c.type === "message.dispatch");
  assert.equal(sent?.threadId, "remote-thread");
  assert.equal(sent?.attachments.length, 1);
});

test("Asset URLs are requested with the conversation that displays them", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const seen: Array<string | undefined> = [];
  f.client.createAssetUrl = async (_resource: never, threadId?: string) => { seen.push(threadId); return { url: "http://127.0.0.1:1/x", expiresAt: Date.now() + 60_000 }; };
  await f.host.selectThread("remote-thread"); publishText(f.client, "remote-thread", "![diagram](assets/diagram.svg)");
  await f.host.chatAsset("remote-thread", { sourceThreadId: "remote-thread", itemId: "text-remote-thread" }, { kind: "media", path: "assets/diagram.svg" });
  assert.deepEqual(seen, ["remote-thread"]);
});

test("Remote sessions open the web UI under their own environment id", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.selectThread("remote-thread");
  assert.match(f.host.webUiUrl(), /\/studio\/remote-thread$/);
  await f.host.selectThread("local-thread");
  assert.match(f.host.webUiUrl(), /\/audit\/local-thread$/);
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

test("A new chat can run on a paired machine with the same repository; its server launches the thread with the first message", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  assert.deepEqual(f.host.snapshot().draft.machines?.map((machine) => [machine.label, machine.local, machine.status]), [["Audit", true, "connected"], ["Studio Mac", false, "connected"]]);
  await f.host.chooseMachine("studio");
  const draft = f.host.snapshot().draft;
  assert.deepEqual([draft.environmentId, draft.projectId, draft.workspaceRoot, draft.workspace], ["studio", "remote-match", "/home/dev/widget", { type: "root" }]);
  assert.equal(f.host.snapshot().providers[0]?.displayName, "Remote Kimi", "the model menu lists that machine's providers");
  await settled();
  assert.deepEqual(f.host.snapshot().draft.remoteCheckouts?.items.map((item) => [item.path, item.branch, item.root]), [["/home/dev/widget", "main", true], ["/home/dev/widget-x", "feature/x", false]]);
  await f.host.sendMessage("Hello from here");
  assert.equal(f.client.launches.length, 1);
  const { environmentId, input } = f.client.launches[0]!;
  assert.deepEqual([environmentId, input.projectId, input.workspaceStrategy, input.initialMessage?.text, input.generateTitle], ["studio", "remote-match", { type: "root" }, "Hello from here", true]);
  assert.equal(f.client.commands.some((command) => command.type === "thread.create" || command.type === "message.dispatch"), false, "no empty thread is created first");
  assert.equal(f.host.snapshot().activeThreadId, "launched-1");
  assert.equal(f.host.snapshot().remoteSession?.label, "Studio Mac");
  await assert.rejects(f.host.chooseMachine("audit"), /stays on its machine/);
  // The next new chat in this view starts on the same machine.
  f.host.registerView("next", SIDEBAR_VIEW_ID, false);
  assert.equal(f.host.snapshot("next").draft.environmentId, "studio");
});

test("A new chat on a paired machine can use its root, one of its worktrees or a new worktree", async (t) => {
  const f = await fixture({ withWorktrees: true }); t.after(f.cleanup);
  await f.host.chooseMachine("studio"); await settled();
  await assert.rejects(f.host.configureWorktree({ type: "existing", path: "/home/dev/elsewhere" }, "remote-match"), /listed on that machine/);
  await assert.rejects(f.host.configureWorktree({ type: "pr", reference: "12", baseRef: "main" }, "remote-match"), /root checkout, one of its worktrees or a new worktree/);
  await assert.rejects(f.host.configureWorktree({ type: "existing", path: "/home/dev/widget-x" }, "local-project"), /machine this chat runs on/);
  await f.host.configureWorktree({ type: "existing", path: "/home/dev/widget-x", branch: "feature/x" }, "remote-match");
  await f.host.sendMessage("Work in the feature worktree");
  assert.deepEqual(f.client.launches[0]!.input.workspaceStrategy, { type: "existing_worktree", worktreePath: "/home/dev/widget-x", branch: "feature/x" });
  f.host.registerView("tab"); await f.host.chooseMachine("studio", "tab");
  await f.host.configureWorktree({ type: "new", baseRef: "main", branch: "t3/remote", startFromOrigin: true }, "remote-match", "tab");
  await f.host.sendMessage("Start a fresh worktree", undefined, "tab");
  assert.deepEqual(f.client.launches[1]!.input.workspaceStrategy, { type: "worktree", baseRef: "main", branch: "t3/remote", startFromOrigin: true });
});

test("A draft for a machine that dropped is kept and cannot be sent until it reconnects", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.chooseMachine("studio");
  f.client.statuses = [{ ...REMOTE, httpBaseUrl: "https://studio.example", enabled: true, state: "error", error: "offline", expiresAt: null }];
  assert.equal(f.host.snapshot().draft.machines?.find((machine) => !machine.local)?.status, "reconnecting");
  await assert.rejects(f.host.sendMessage("Wait for me"), /Studio Mac is reconnecting\. Your draft is kept/);
  assert.equal(f.client.launches.length, 0);
  assert.equal(f.host.snapshot().draft.environmentId, "studio", "the draft keeps its machine");
});

test("A new chat's attachments and suggestions come from its chosen machine", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.chooseMachine("studio");
  await f.host.uploadAttachment("shot.png", "image/png", new Uint8Array([1, 2, 3]));
  assert.deepEqual(f.client.remoteUploads.map((upload) => upload.environmentId), ["studio"]);
  const paths = await f.host.composerSuggestions("path", "app", false);
  assert.deepEqual(f.client.remoteSearches, [{ environmentId: "studio", cwd: "/home/dev/widget", query: "app" }]);
  assert.deepEqual(paths.map((item) => item.value), ["src/app.ts"]);
  // An existing conversation on that machine searches its own checkout there too, not this computer's server.
  await f.host.chooseMachine("audit"); await f.host.selectThread("remote-thread");
  await f.host.composerSuggestions("path", "app", false);
  assert.equal(f.client.remoteSearches.at(-1)?.environmentId, "studio");
});

test("A new editor tab from a tab bound for another machine opens without an empty local thread", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  f.host.registerView("source"); await f.host.chooseMachine("studio", "source");
  // The editor provider's new-chat sequence: inherit, begin, and skip the up-front thread for another machine.
  f.host.registerView("panel", "source", false); f.host.beginNewChat("panel");
  assert.equal(f.host.draftOnOtherMachine("panel"), true);
  assert.equal(f.host.snapshot("panel").draft.environmentId, "studio");
  await f.host.sendMessage("From the new tab", undefined, "panel");
  assert.equal(f.client.launches.length, 1);
  assert.equal(f.client.commands.some((command) => command.type === "thread.create"), false);
  // A tab opened on an existing conversation never inherits the machine choice.
  f.host.registerView("opened", "source");
  assert.equal(f.host.draftOnOtherMachine("opened"), false);
});

test("Choosing a machine in a new editor tab keeps what was typed and removes the unused local thread", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  f.host.registerView("tab", undefined, false); f.host.beginNewChat("tab");
  const placeholder = await f.host.newThread(undefined, "tab");
  await f.host.composerState(placeholder, true, false, "tab");
  f.host.saveComposerDraft(placeholder, { text: "Typed before choosing", contexts: [] }, undefined, "tab");
  await f.host.chooseMachine("studio", "tab");
  assert.equal(f.host.snapshot("tab").activeThreadId, undefined);
  assert.ok(f.client.commands.some((command) => command.type === "thread.delete" && command.threadId === placeholder), "the placeholder thread is deleted");
  assert.equal((await f.host.restoreComposerDraft("new", "tab")).draft.text, "Typed before choosing");
});

test("A draft whose machine dropped out of reach stays bound to it and never runs here", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.host.chooseMachine("studio");
  // Reconnecting or an expired pairing drops that machine's shell, so its projects are unknown for a while.
  f.client.projectOwners.delete("remote-match");
  f.client.shell = { ...f.client.shell, snapshotSequence: f.client.shell.snapshotSequence + 1, projects: f.client.shell.projects.filter((project) => project.id !== "remote-match") };
  f.client.statuses = [{ ...REMOTE, httpBaseUrl: "https://studio.example", enabled: true, state: "expired", expiresAt: null }];
  f.client.shellHandler?.({ kind: "snapshot", snapshot: f.client.shell });
  const draft = f.host.snapshot().draft;
  assert.deepEqual([draft.environmentId, draft.projectId, draft.machines?.find((machine) => !machine.local)?.status], ["studio", "remote-match", "expired"]);
  await assert.rejects(f.host.sendMessage("Should wait"), /Your draft is kept/);
  assert.equal(f.client.commands.some((command) => command.type === "thread.create" || command.type === "message.dispatch"), false);
});

/** A window repository with a Git remote, ignored env files, and a paired machine that lacks it. */
async function cloneFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const f = await fixture(); t.after(f.cleanup);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(f.repo, ".gitignore"), ".env\n.env.local\nnode_modules/\n");
  await writeFile(join(f.repo, ".env"), "TOKEN=fixture\n"); await writeFile(join(f.repo, ".env.local"), "LOCAL=1\n");
  await mkdir(join(f.repo, "node_modules")); await writeFile(join(f.repo, "node_modules", "big.js"), "x");
  f.client.statuses = [...f.client.statuses, { ...REMOTE_OTHER, httpBaseUrl: "https://devbox.example", enabled: true, state: "connected", expiresAt: null }];
  f.client.shell = { ...f.client.shell, snapshotSequence: f.client.shell.snapshotSequence + 1, projects: f.client.shell.projects.map((project) => project.id === "local-project" ? { ...project, repositoryIdentity: identity("github.com/acme/widget") } : project) };
  f.client.shellHandler?.({ kind: "snapshot", snapshot: f.client.shell });
  return f;
}
const cloneSnapshot = (projectId: string, phase: string, extra: Record<string, unknown> = {}) => ({ projectId, remoteUrl: "https://github.com/acme/widget.git", destinationPath: "/home/dev/widget", repository: { nameWithOwner: "acme/widget" },
  phase, stage: "receiving", percent: 42, detail: null, error: null, startedAt: new Date().toISOString(), endedAt: null, sequence: 1, ...extra });

test("Machines without this repository are offered for cloning, with the reason when they cannot take it", async (t) => {
  const f = await cloneFixture(t);
  const draft = f.host.snapshot().draft;
  assert.deepEqual(draft.addTargets?.map((target) => [target.label, target.available, target.defaultDestination]), [["Dev Box", true, "~/widget"]]);
  assert.deepEqual([draft.cloneSource?.sshUrl, draft.cloneSource?.httpsUrl], ["git@github.com:acme/widget.git", "https://github.com/acme/widget.git"]);
  f.client.access.set("devbox", "permission");
  assert.deepEqual(f.host.snapshot().draft.addTargets?.map((target) => [target.available, target.reason]), [[false, "needs source-control access"]]);
  await assert.rejects(f.host.startClone({ environmentId: "devbox", destinationPath: "~/widget", protocol: "https", files: [] }), /lacks source-control access/);
  assert.deepEqual((await f.host.listCopyableFiles()).map((file) => [file.path, file.checked]), [[".env", true], [".env.local", true]], "ignored folders are skipped whole");
});

test("Cloning onto a machine points the new chat there; sending waits for the clone and the copied env files", async (t) => {
  const f = await cloneFixture(t);
  await f.host.startClone({ environmentId: "devbox", destinationPath: "~/src/widget", protocol: "ssh", files: [".env", "../outside", "node_modules/big.js"] });
  const { input } = f.client.cloneStarts[0]!;
  assert.deepEqual([input.destinationPath, input.remoteUrl, input.protocol, input.title], ["~/src/widget", "git@github.com:acme/widget.git", "ssh", "local"]);
  assert.equal(f.host.snapshot().draft.environmentId, "devbox");
  f.client.cloneHandlers.get("devbox")!([cloneSnapshot(input.projectId, "running")]);
  assert.deepEqual([f.host.snapshot().draft.clone?.phase, f.host.snapshot().draft.clone?.percent, f.host.snapshot().draft.clone?.name], ["running", 42, "acme/widget"]);
  await assert.rejects(f.host.sendMessage("Too early"), /Cloning repository on Dev Box/);
  f.client.cloneHandlers.get("devbox")!([cloneSnapshot(input.projectId, "done", { percent: 100 })]);
  await settled();
  assert.deepEqual(f.client.fileWrites.map((write) => [write.cwd, write.relativePath, write.contents]), [["~/src/widget", ".env", "TOKEN=fixture\n"]], "only listed files are copied");
  assert.equal(f.host.snapshot().draft.clone, undefined);
  await f.host.sendMessage("Now it is ready");
  assert.deepEqual([f.client.launches[0]!.environmentId, f.client.launches[0]!.input.projectId], ["devbox", input.projectId]);
});

test("A failed clone can be retried or removed, which returns the chat to this computer", async (t) => {
  const f = await cloneFixture(t);
  await f.host.startClone({ environmentId: "devbox", destinationPath: "~/widget", protocol: "https", files: [] });
  const projectId = f.client.cloneStarts[0]!.input.projectId;
  f.client.cloneHandlers.get("devbox")!([cloneSnapshot(projectId, "failed", { error: "Permission denied (publickey)." })]);
  assert.deepEqual([f.host.snapshot().draft.clone?.phase, f.host.snapshot().draft.clone?.error], ["failed", "Permission denied (publickey)."]);
  await f.host.cloneAction("retry");
  await f.host.cloneAction("remove");
  assert.deepEqual(f.client.cloneActions, [`retry:${projectId}`, `delete:${projectId}`]);
  assert.equal(f.host.snapshot().draft.environmentId, undefined);
});

test("An attachment in the new chat follows it to the machine a clone moves it to", async (t) => {
  const f = await cloneFixture(t);
  f.host.registerView("tab", undefined, false); f.host.beginNewChat("tab");
  await f.host.restoreComposerDraft("new", "tab");
  const file = await f.host.uploadAttachment("shot.png", "image/png", new Uint8Array([1, 2, 3]), "tab");
  f.host.saveComposerDraft("new", { text: "With a picture", contexts: [], attachments: [file] }, undefined, "tab");
  await f.host.startClone({ environmentId: "devbox", destinationPath: "~/widget", protocol: "https", files: [] }, "tab");
  const restored = await f.host.restoreComposerDraft("new", "tab");
  assert.deepEqual([restored.draft.text, restored.draft.attachments?.[0]?.environmentId], ["With a picture", "devbox"]);
  assert.deepEqual(f.client.remoteUploads.map((upload) => upload.environmentId), [undefined, "devbox"], "uploaded again from the kept copy");
});

test("Only regular text files are offered for copying: symlinks, folders and binaries are not", async (t) => {
  const f = await cloneFixture(t);
  const { writeFile, symlink } = await import("node:fs/promises");
  await writeFile(join(f.repo, ".gitignore"), ".env\n.env.local\nnode_modules/\nlinked.env\nfolder-link\nimage.bin\n");
  await symlink("/etc/hostname", join(f.repo, "linked.env")); await symlink(f.repo, join(f.repo, "folder-link"));
  await writeFile(join(f.repo, "image.bin"), new Uint8Array([0x89, 0x50, 0, 1]));
  assert.deepEqual((await f.host.listCopyableFiles()).map((file) => file.path), [".env", ".env.local"]);
});

test("A finished clone that dropped off the machine's list still gets its files, and one bad file does not stop the rest", async (t) => {
  const f = await cloneFixture(t);
  const { rm: remove } = await import("node:fs/promises");
  await f.host.startClone({ environmentId: "devbox", destinationPath: "~/widget", protocol: "https", files: [".env", ".env.local"] });
  const projectId = f.client.cloneStarts[0]!.input.projectId;
  f.client.cloneHandlers.get("devbox")!([cloneSnapshot(projectId, "running")]);
  // The machine was away when the clone finished; it then lists nothing, but has the project.
  f.client.shell = { ...f.client.shell, snapshotSequence: f.client.shell.snapshotSequence + 1, projects: [...f.client.shell.projects, { ...f.client.shell.projects[0]!, id: projectId as never, workspaceRoot: "~/widget" }] };
  f.client.shellHandler?.({ kind: "snapshot", snapshot: f.client.shell });
  await remove(join(f.repo, ".env.local"));
  f.client.cloneHandlers.get("devbox")!([]);
  await settled();
  assert.deepEqual(f.client.fileWrites.map((write) => write.relativePath), [".env"]);
  const clone = f.host.snapshot().draft.clone;
  assert.equal(clone?.copy?.phase, "failed");
  assert.match(clone?.copy?.error ?? "", /^\.env\.local \(/);
});
