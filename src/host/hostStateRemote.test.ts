import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ProjectId, ThreadId, type OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { v2Project, v2ThreadShell, v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { HostState, type HostTransport } from "./hostState.js";
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
  await assert.rejects(matched.host.newThread("remote-match"), /other machines is not supported/);
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

test("New threads cannot start in a remote project", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await assert.rejects(f.host.newThread("remote-match"), /Starting sessions on other machines is not supported yet\./);
  await assert.rejects(f.host.chooseProject("remote-match"), /not supported|not found/i);
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
