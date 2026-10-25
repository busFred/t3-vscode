import test from "node:test";
import assert from "node:assert/strict";
import { ProjectId, ThreadId, type OrchestrationV2ShellSnapshot, type OrchestrationV2ShellStreamItem } from "@t3tools/contracts";
import { v2Project, v2ThreadShell, v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { MultiEnvironmentClient } from "./multiEnvironmentClient.js";
import type { RemoteEnvironmentRecord } from "./environmentCatalog.js";
import type { T3Client } from "./t3Client.js";

type Call = readonly [string, ...unknown[]];
const project = (id: string, extra: object = {}) => ({ ...v2Project, id: ProjectId.make(id), title: id, ...extra });
const thread = (id: string, projectId: string, extra: object = {}) => ({ ...v2ThreadShell, id: ThreadId.make(id), projectId: ProjectId.make(projectId), title: id, ...extra });
const shell = (projects: OrchestrationV2ShellSnapshot["projects"], threads: OrchestrationV2ShellSnapshot["threads"], snapshotSequence = 0, archivedThreads: OrchestrationV2ShellSnapshot["archivedThreads"] = []): OrchestrationV2ShellSnapshot =>
  ({ ...v2ShellSnapshot, snapshotSequence, projects, threads, archivedThreads });
const record = (id: string, extra: Partial<RemoteEnvironmentRecord> = {}): RemoteEnvironmentRecord => ({
  environmentId: id, label: `Env ${id}`, httpBaseUrl: `https://${id}.example.ts.net/`, wsBaseUrl: `wss://${id}.example.ts.net/`,
  accessToken: `tok-${id}`, expiresAt: null, scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z", ...extra,
});
async function until(predicate: () => boolean, message = "condition"): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`); await new Promise((resolve) => setTimeout(resolve, 2)); }
}

/** A client double: records calls, serves a configurable shell, and lets tests drive the stream and the close callback. */
class FakeClient {
  connected = false;
  onClose: (() => void) | null = null;
  onConfig: unknown = null;
  config: unknown;
  worktreeSettingsCapabilities = undefined;
  calls: Call[] = [];
  shell: OrchestrationV2ShellSnapshot;
  shellHandler: ((item: OrchestrationV2ShellStreamItem) => void) | null = null;
  connectError: unknown = null;
  searchResult: { matches: unknown[] } = { matches: [] };
  searchError: Error | null = null;
  disconnects = 0; unsubscribes = 0; connects = 0;
  readonly name: string;
  constructor(shellValue: OrchestrationV2ShellSnapshot, name = "client") { this.shell = shellValue; this.name = name; this.config = { name }; }
  private log(...call: Call) { this.calls.push(call); }
  async connect(server: unknown, token: string) {
    this.connects += 1; this.log("connect", server, token);
    if (this.connectError) throw this.connectError;
    this.connected = true;
  }
  async disconnect() { this.disconnects += 1; this.connected = false; }
  async snapshotShell() { this.log("snapshotShell"); return this.shell; }
  async subscribeShell(handler: (item: OrchestrationV2ShellStreamItem) => void) {
    this.shellHandler = handler; return async () => { this.unsubscribes += 1; this.shellHandler = null; };
  }
  async subscribeThread(...args: unknown[]) { this.log("subscribeThread", ...args); return async () => {}; }
  async getThreadProjection(id: string) { this.log("getThreadProjection", id); return { from: this.name }; }
  async dispatch(input: unknown) { this.log("dispatch", input); }
  async answerSecretRequest(input: unknown) { this.log("answerSecretRequest", input); }
  async getHistory(id: string, cursor: string) { this.log("getHistory", id, cursor); return { from: this.name }; }
  async getTurnItem(id: string, itemId: string) { this.log("getTurnItem", id, itemId); return { from: this.name }; }
  async getTurnDiff(...args: unknown[]) { this.log("getTurnDiff", ...args); return { from: this.name }; }
  async subscribeWorktreeSetup(...args: unknown[]) { this.log("subscribeWorktreeSetup", ...args); return async () => {}; }
  async cancelWorktreeSetup(id: string) { this.log("cancelWorktreeSetup", id); }
  async createAssetUrl(resource: unknown) { this.log("createAssetUrl", resource); return { url: `http://${this.name}/asset`, expiresAt: 1 }; }
  async uploadAttachment(input: unknown, bytes: Uint8Array) { this.log("uploadAttachment", input, bytes); return { id: `${this.name}-attachment` }; }
  async deleteAttachment(id: string) { this.log("deleteAttachment", id); }
  async searchThreads(query: string) { this.log("searchThreads", query); if (this.searchError) throw this.searchError; return this.searchResult; }
  emit(item: OrchestrationV2ShellStreamItem) { this.shellHandler!(item); }
  close() { this.connected = false; this.onClose?.(); }
  callsNamed(name: string) { return this.calls.filter(([n]) => n === name); }
}

interface Rig { multi: MultiEnvironmentClient; primary: FakeClient; remotes: FakeClient[]; queue: FakeClient[]; items: OrchestrationV2ShellStreamItem[]; statusChanges: number; revoked: string[] }
async function rig(options: { primaryShell?: OrchestrationV2ShellSnapshot; reconnectDelayMs?: number; subscribe?: boolean; credentialValid?: boolean | null } = {}): Promise<Rig> {
  const primary = new FakeClient(options.primaryShell ?? shell([project("local-project")], [thread("local-thread", "local-project")], 7), "primary");
  const queue: FakeClient[] = [], remotes: FakeClient[] = [];
  const multi = new MultiEnvironmentClient(primary as unknown as T3Client, {
    makeClient: () => { const next = queue.shift(); if (!next) throw new Error("No remote client queued"); remotes.push(next); return next as never; },
    reconnectDelayMs: options.reconnectDelayMs ?? 5,
    // By default the remote T3 server confirms a rejected credential is no longer signed in.
    checkCredential: async () => options.credentialValid === undefined ? false : options.credentialValid,
  });
  const state: Rig = { multi, primary, remotes, queue, items: [], statusChanges: 0, revoked: [] };
  multi.onRemoteStatus = () => { state.statusChanges += 1; };
  multi.onRemoteRevoked = (revokedRecord) => { state.revoked.push(revokedRecord.environmentId); };
  if (options.subscribe !== false) { await multi.snapshotShell(); await multi.subscribeShell((item) => state.items.push(item)); }
  return state;
}
/** Pairs a remote whose shell is `remoteShell` and waits until it is connected. */
async function pair(r: Rig, id: string, remoteShell: OrchestrationV2ShellSnapshot, extra: Partial<RemoteEnvironmentRecord> = {}): Promise<FakeClient> {
  const fake = new FakeClient(remoteShell, id); r.queue.push(fake);
  await r.multi.setRemoteEnvironments([...r.multi.remoteStatuses().map((s) => record(s.environmentId, { label: s.label, enabled: s.enabled, expiresAt: s.expiresAt, ...(s.ignoredStatus ? { ignoredStatus: s.ignoredStatus } : {}) })), record(id, extra)]);
  await until(() => r.multi.remoteStatuses().find((s) => s.environmentId === id)?.state === "connected", `${id} connected`);
  return fake;
}
const ids = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id);
const lastSnapshot = (items: OrchestrationV2ShellStreamItem[]) => { const item = items.findLast((entry) => entry.kind === "snapshot"); assert.ok(item && item.kind === "snapshot"); return item.snapshot; };

test("With no remotes the snapshot and stream items are the primary's, unchanged", async () => {
  const r = await rig({ subscribe: false });
  assert.deepEqual(await r.multi.snapshotShell(), r.primary.shell);
  const received: OrchestrationV2ShellStreamItem[] = [];
  await r.multi.subscribeShell((item) => received.push(item));
  const snapshot: OrchestrationV2ShellStreamItem = { kind: "snapshot", snapshot: shell([project("local-project")], [thread("local-thread", "local-project"), thread("second", "local-project")], 9) };
  const event: OrchestrationV2ShellStreamItem = { kind: "thread.updated", sequence: 10, location: "active", thread: thread("third", "local-project") } as never;
  const synchronized: OrchestrationV2ShellStreamItem = { kind: "synchronized" } as never;
  r.primary.emit(snapshot); r.primary.emit(event); r.primary.emit(synchronized);
  assert.equal(received[0], snapshot);
  assert.equal(received[1], event);
  assert.equal(received[2], synchronized);
  assert.equal(r.multi.threadEnvironment("local-thread"), undefined);
  assert.equal(r.multi.configForThread("local-thread"), r.primary.config);
});

test("Merged shell lists primary first, appends remote records, and keeps local on id collisions", async () => {
  const r = await rig({ primaryShell: shell([project("p-local")], [thread("t-local", "p-local")], 7, [thread("t-archived-local", "p-local", { archivedAt: "2026-01-01T00:00:00.000Z" })]) });
  await pair(r, "a", shell([project("p-a"), project("p-local", { title: "remote impostor" })],
    [thread("t-a", "p-a"), thread("t-local", "p-a", { title: "remote impostor" })], 3, [thread("t-a-archived", "p-a")]));
  await pair(r, "b", shell([project("p-b")], [thread("t-b", "p-b")], 4));
  const merged = await r.multi.snapshotShell();
  assert.deepEqual(ids(merged.projects), ["p-local", "p-a", "p-b"]);
  assert.deepEqual(ids(merged.threads), ["t-local", "t-a", "t-b"]);
  assert.equal(merged.threads[0]!.title, "t-local");
  assert.equal(merged.projects[0]!.title, "p-local");
  assert.deepEqual(ids(merged.archivedThreads), ["t-archived-local", "t-a-archived"]);
  assert.equal(merged.snapshotSequence, 7);
  // Collisions keep local routing too.
  assert.equal(r.multi.threadEnvironment("t-local"), undefined);
  assert.equal(r.multi.projectEnvironment("p-local"), undefined);
  assert.deepEqual(r.multi.threadEnvironment("t-a"), { environmentId: "a", label: "Env a" });
  assert.deepEqual(r.multi.projectEnvironment("p-b"), { environmentId: "b", label: "Env b" });
  assert.deepEqual(r.multi.threadEnvironment("t-a-archived"), { environmentId: "a", label: "Env a" });
});

test("A remote shell event emits a merged snapshot carrying the primary's snapshotSequence", async () => {
  const r = await rig();
  const remote = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 100));
  r.items.length = 0;
  remote.emit({ kind: "thread.updated", sequence: 101, location: "active", thread: thread("t-a2", "p-a") } as never);
  assert.equal(r.items.length, 1);
  const snapshot = lastSnapshot(r.items);
  assert.equal(snapshot.snapshotSequence, 7);
  assert.deepEqual(ids(snapshot.threads), ["local-thread", "t-a", "t-a2"]);
  // Synchronized markers from a remote are not forwarded.
  remote.emit({ kind: "synchronized" } as never);
  assert.equal(r.items.length, 1);
});

test("A paired machine's config change reaches the same listener as the local server's", async () => {
  const r = await rig();
  const seen: unknown[] = [];
  r.multi.onConfig = (config) => { seen.push(config); };
  const remote = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 100));
  (remote.onConfig as (config: unknown) => void)({ name: "a" });
  assert.deepEqual(seen, [{ name: "a" }]);
  await r.multi.setRemoteEnvironments([]);
  (remote.onConfig as (config: unknown) => void)({ name: "a" });
  assert.equal(seen.length, 1, "a removed machine no longer redraws");
});

test("With remote shells present a primary snapshot is re-emitted merged", async () => {
  const r = await rig();
  await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  r.items.length = 0;
  r.primary.emit({ kind: "snapshot", snapshot: shell([project("local-project")], [thread("local-thread", "local-project"), thread("local-2", "local-project")], 8) });
  const snapshot = lastSnapshot(r.items);
  assert.deepEqual(ids(snapshot.threads), ["local-thread", "local-2", "t-a"]);
  assert.equal(snapshot.snapshotSequence, 8);
});

test("Thread-scoped calls follow the owning environment", async () => {
  const r = await rig();
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  const b = await pair(r, "b", shell([project("p-b")], [thread("t-b", "p-b")], 1));
  await r.multi.snapshotShell();
  await r.multi.dispatch({ type: "message.dispatch", threadId: "t-a" });
  await r.multi.dispatch({ type: "thread.fork", sourceThreadId: "t-b", targetThreadId: "new-fork" });
  await r.multi.dispatch({ type: "message.dispatch", threadId: "local-thread" });
  assert.deepEqual(a.callsNamed("dispatch").map(([, c]) => (c as { threadId: string }).threadId), ["t-a"]);
  assert.deepEqual(b.callsNamed("dispatch").map(([, c]) => (c as { sourceThreadId: string }).sourceThreadId), ["t-b"]);
  assert.equal(r.primary.callsNamed("dispatch").length, 1);

  await r.multi.subscribeThread("t-a", () => {});
  assert.equal(a.callsNamed("subscribeThread").length, 1);
  assert.equal(r.primary.callsNamed("subscribeThread").length, 0);
  await r.multi.subscribeThread("local-thread", () => {});
  assert.equal(r.primary.callsNamed("subscribeThread").length, 1);

  assert.deepEqual(await r.multi.getThreadProjection("t-b"), { from: "b" });
  assert.deepEqual(await r.multi.getThreadProjection("local-thread"), { from: "primary" });
  await r.multi.getHistory("t-a", "cursor"); await r.multi.getTurnItem("t-a", "item"); await r.multi.getTurnDiff("t-a", 1, 2);
  await r.multi.answerSecretRequest({ threadId: "t-b", requestId: "r" });
  await r.multi.cancelWorktreeSetup("t-a");
  assert.deepEqual([a.callsNamed("getHistory").length, a.callsNamed("getTurnItem").length, a.callsNamed("getTurnDiff").length, a.callsNamed("cancelWorktreeSetup").length], [1, 1, 1, 1]);
  assert.equal(b.callsNamed("answerSecretRequest").length, 1);
  assert.equal(r.primary.callsNamed("getHistory").length, 0);
});

test("thread.create is routed by projectId, and local projects stay local", async () => {
  const r = await rig();
  const a = await pair(r, "a", shell([project("p-a")], [], 1));
  await r.multi.snapshotShell();
  await r.multi.dispatch({ type: "thread.create", threadId: "brand-new", projectId: "p-a" });
  assert.equal(a.callsNamed("dispatch").length, 1);
  await r.multi.dispatch({ type: "thread.create", threadId: "brand-new-local", projectId: "local-project" });
  assert.equal(a.callsNamed("dispatch").length, 1);
  assert.equal(r.primary.callsNamed("dispatch").length, 1);
  // A command naming a local thread is never redirected by a remote project id.
  await r.multi.dispatch({ type: "message.dispatch", threadId: "local-thread", projectId: "p-a" });
  assert.equal(a.callsNamed("dispatch").length, 1);
  assert.equal(r.primary.callsNamed("dispatch").length, 2);
});

test("Assets and attachments route to the owning environment", async () => {
  const r = await rig();
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  await r.multi.snapshotShell();
  const resource = { type: "attachment", attachmentId: "x" } as never;
  assert.equal((await r.multi.createAssetUrl(resource, "t-a")).url, "http://a/asset");
  assert.equal((await r.multi.createAssetUrl(resource, "local-thread")).url, "http://primary/asset");
  assert.equal((await r.multi.createAssetUrl(resource)).url, "http://primary/asset");
  assert.equal((await r.multi.createAssetUrl({ type: "turn-item", threadId: "t-a" } as never)).url, "http://a/asset");

  const bytes = new Uint8Array([1, 2, 3]);
  const input = { name: "f.txt", mimeType: "text/plain", sizeBytes: 3, type: "file" } as never;
  assert.deepEqual(await r.multi.uploadAttachment(input, bytes, "a"), { id: "a-attachment" });
  assert.deepEqual(await r.multi.uploadAttachment(input, bytes), { id: "primary-attachment" });
  await r.multi.deleteAttachment("att-1", "a");
  await r.multi.deleteAttachment("att-2");
  assert.deepEqual(a.callsNamed("deleteAttachment"), [["deleteAttachment", "att-1"]]);
  assert.deepEqual(r.primary.callsNamed("deleteAttachment"), [["deleteAttachment", "att-2"]]);
  assert.equal(a.callsNamed("uploadAttachment").length, 1);
  await assert.rejects(async () => r.multi.uploadAttachment(input, bytes, "unknown"), /no longer paired/);
});

test("A disconnected remote reports itself by label, keeps its sessions listed, and refreshes after reconnecting", async () => {
  const r = await rig({ reconnectDelayMs: 20 });
  const first = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1), { label: "Studio Mac" });
  await r.multi.snapshotShell();
  const second = new FakeClient(shell([project("p-a")], [thread("t-a", "p-a"), thread("t-a-new", "p-a")], 2), "a2");
  r.queue.push(second);
  first.close();
  await until(() => r.multi.remoteStatuses()[0]?.state === "error", "error state");
  assert.equal(r.multi.remoteStatuses()[0]!.error, "Connection lost.");
  // Sessions stay listed but commands fail clearly.
  assert.deepEqual(ids((await r.multi.snapshotShell()).threads), ["local-thread", "t-a"]);
  assert.deepEqual(r.multi.threadEnvironment("t-a"), { environmentId: "a", label: "Studio Mac" });
  await assert.rejects(async () => r.multi.dispatch({ type: "message.dispatch", threadId: "t-a" }), /^Error: Studio Mac is disconnected\./);
  await assert.rejects(async () => r.multi.subscribeThread("t-a", () => {}), /Studio Mac is disconnected/);
  await assert.rejects(async () => r.multi.getThreadProjection("t-a"), /Studio Mac is disconnected/);
  await assert.rejects(async () => r.multi.uploadAttachment({} as never, new Uint8Array(), "a"), /Studio Mac is disconnected/);
  assert.equal(r.multi.configForThread("t-a"), null);
  // Reconnect replaces the retained shell with the fresh one.
  await until(() => r.multi.remoteStatuses()[0]?.state === "connected", "reconnect");
  assert.equal(r.multi.remoteStatuses()[0]!.error, undefined);
  assert.deepEqual(ids(lastSnapshot(r.items).threads), ["local-thread", "t-a", "t-a-new"]);
  await r.multi.dispatch({ type: "message.dispatch", threadId: "t-a" });
  assert.equal(second.callsNamed("dispatch").length, 1);
});

test("A closed remote retries with exponential backoff", async () => {
  const r = await rig({ reconnectDelayMs: 25 });
  const first = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  const failing = [new FakeClient(first.shell, "f1"), new FakeClient(first.shell, "f2")];
  failing.forEach((fake) => { fake.connectError = new Error("offline"); });
  const recovered = new FakeClient(first.shell, "ok");
  r.queue.push(...failing, recovered);
  const closedAt = Date.now();
  first.close();
  await until(() => failing[0]!.connects === 1, "first retry");
  const firstDelay = Date.now() - closedAt;
  await until(() => failing[1]!.connects === 1, "second retry");
  const secondDelay = Date.now() - closedAt;
  assert.ok(firstDelay >= 20, `first retry waited ${firstDelay}ms`);
  assert.ok(secondDelay - firstDelay >= 40, `second retry waited only ${secondDelay - firstDelay}ms after the first (expected ~50)`);
  assert.equal(r.multi.remoteStatuses()[0]!.error, "offline");
  await until(() => recovered.connects === 1 && r.multi.remoteStatuses()[0]!.state === "connected", "recovery");
  assert.equal(r.multi.remoteStatuses()[0]!.error, undefined);
});

test("Disabling or removing a remote clears its sessions and disconnects it", async () => {
  const r = await rig();
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  const b = await pair(r, "b", shell([project("p-b")], [thread("t-b", "p-b")], 1));
  assert.deepEqual(ids((await r.multi.snapshotShell()).threads), ["local-thread", "t-a", "t-b"]);

  await r.multi.setRemoteEnvironments([record("a", { enabled: false }), record("b")]);
  assert.deepEqual(ids(lastSnapshot(r.items).threads), ["local-thread", "t-b"]);
  assert.equal(a.disconnects, 1); assert.equal(a.unsubscribes, 1);
  assert.equal(r.multi.remoteStatuses().find((s) => s.environmentId === "a")!.state, "disabled");
  assert.equal(r.multi.threadEnvironment("t-a"), undefined);

  await r.multi.setRemoteEnvironments([record("a", { enabled: false })]);
  assert.deepEqual(ids(lastSnapshot(r.items).threads), ["local-thread"]);
  assert.equal(b.disconnects, 1);
  assert.deepEqual(r.multi.remoteStatuses().map((s) => s.environmentId), ["a"]);
  // Zero connected remote shells: the merged result collapses to the primary's records.
  assert.deepEqual(ids((await r.multi.snapshotShell()).projects), ["local-project"]);
});

test("Re-enabling a disabled remote reconnects it", async () => {
  const r = await rig();
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  await r.multi.setRemoteEnvironments([record("a", { enabled: false })]);
  const again = new FakeClient(a.shell, "a-again"); r.queue.push(again);
  await r.multi.setRemoteEnvironments([record("a")]);
  await until(() => r.multi.remoteStatuses()[0]!.state === "connected", "reconnect");
  assert.equal(again.connects, 1);
  assert.ok(ids(lastSnapshot(r.items).threads).includes("t-a"));
});

const DAY = 24 * 60 * 60 * 1000;
test("An auth failure on an unexpired pairing means revoked: state expired, shell cleared, onRemoteRevoked fires, no retry", async () => {
  const r = await rig({ reconnectDelayMs: 5 });
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1), { expiresAt: Date.now() + 10 * DAY });
  const rejected = new FakeClient(a.shell, "rejected");
  rejected.connectError = Object.assign(new Error("unauthorized"), { status: 401 });
  const never = new FakeClient(a.shell, "never"); r.queue.push(rejected, never);
  a.close();
  await until(() => rejected.connects === 1 && r.revoked.length === 1, "revocation");
  assert.deepEqual(r.revoked, ["a"]);
  const status = r.multi.remoteStatuses()[0]!;
  assert.equal(status.state, "expired");
  assert.match(status.error!, /revoked/);
  assert.deepEqual(ids((await r.multi.snapshotShell()).threads), ["local-thread"]);
  assert.equal(r.multi.threadEnvironment("t-a"), undefined);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(never.connects, 0);
  assert.equal(r.revoked.length, 1);
});

test("An auth failure the T3 server does not confirm (e.g. a proxy's 401) keeps retrying and never revokes", async () => {
  for (const credentialValid of [null, true] as const) {
    const r = await rig({ reconnectDelayMs: 5, credentialValid });
    const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1), { expiresAt: Date.now() + 10 * DAY });
    const rejected = new FakeClient(a.shell, "rejected");
    rejected.connectError = Object.assign(new Error("unauthorized"), { status: 401 });
    const retry = new FakeClient(a.shell, "retry"); r.queue.push(rejected, retry);
    a.close();
    await until(() => retry.connects === 1 && r.multi.remoteStatuses()[0]!.state === "connected", "retry after unconfirmed 401");
    assert.deepEqual(r.revoked, []);
    await r.multi.dispose();
  }
});

test("A credential with no recorded expiry that is rejected counts as revoked", async () => {
  const r = await rig();
  const fake = new FakeClient(shell([], [], 1), "x"); fake.connectError = Object.assign(new Error("unauthorized"), { status: 401 }); r.queue.push(fake);
  await r.multi.setRemoteEnvironments([record("x", { expiresAt: null })]);
  await until(() => r.revoked.length === 1, "revocation");
  assert.equal(r.multi.remoteStatuses()[0]!.state, "expired");
  assert.equal(r.multi.remoteStatuses()[0]!.expiresAt, null);
});

test("An auth failure after the pairing's expiry is an expiry: state expired, no onRemoteRevoked, no retry", async () => {
  const r = await rig({ reconnectDelayMs: 5 });
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1), { expiresAt: Date.now() - DAY });
  const rejected = new FakeClient(a.shell, "rejected");
  rejected.connectError = Object.assign(new Error("unauthorized"), { status: 401 });
  const never = new FakeClient(a.shell, "never"); r.queue.push(rejected, never);
  const before = r.statusChanges;
  a.close();
  await until(() => rejected.connects === 1 && r.multi.remoteStatuses()[0]!.state === "expired", "expired");
  const status = r.multi.remoteStatuses()[0]!;
  assert.match(status.error!, /This pairing expired/);
  assert.ok(r.statusChanges > before);
  assert.deepEqual(ids((await r.multi.snapshotShell()).threads), ["local-thread"]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(never.connects, 0);
  assert.deepEqual(r.revoked, []);
});

test("The expiry grace window is 60 s: failing within it is an expiry, failing just outside it is a revocation", async () => {
  for (const [offset, expectRevoked] of [[30_000, false], [120_000, true]] as const) {
    const r = await rig();
    const fake = new FakeClient(shell([], [], 1), "x"); fake.connectError = { _tag: "EnvironmentAuthInvalidError" }; r.queue.push(fake);
    await r.multi.setRemoteEnvironments([record("x", { expiresAt: Date.now() + offset })]);
    await until(() => r.multi.remoteStatuses()[0]!.state === "expired", "expired state");
    assert.equal(r.revoked.length, expectRevoked ? 1 : 0, `offset ${offset}`);
    await r.multi.dispose();
  }
});

test("Authentication failure is also recognised from reason and error tag", async () => {
  for (const cause of [{ reason: "authentication" }, { _tag: "EnvironmentAuthInvalidError" }]) {
    const r = await rig();
    const fake = new FakeClient(shell([], [], 1), "x"); fake.connectError = cause; r.queue.push(fake);
    await r.multi.setRemoteEnvironments([record("x")]);
    await until(() => r.revoked.length === 1, "revocation");
    assert.equal(r.multi.remoteStatuses()[0]!.state, "expired");
    await r.multi.dispose();
  }
});

test("remoteStatuses reports expiresAt and any ignoredStatus from the record", async () => {
  const r = await rig();
  await pair(r, "a", shell([], [], 1), { expiresAt: 12345, ignoredStatus: "expiring" });
  await pair(r, "b", shell([], [], 1));
  const [a, b] = r.multi.remoteStatuses();
  assert.equal(a!.environmentId, "a");
  assert.equal(a!.expiresAt, 12345);
  assert.equal(a!.ignoredStatus, "expiring");
  assert.equal(b!.expiresAt, null);
  assert.equal("ignoredStatus" in b!, false);
});

test("reconnectRemote reconnects only the named enabled remote", async () => {
  const r = await rig({ reconnectDelayMs: 5 });
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  const b = await pair(r, "b", shell([project("p-b")], [thread("t-b", "p-b")], 1));
  const a2 = new FakeClient(a.shell, "a2"), b2 = new FakeClient(b.shell, "b2"); r.queue.push(a2, b2);
  r.multi.reconnectRemote("a");
  await until(() => a2.connects === 1 && r.multi.remoteStatuses().find((s) => s.environmentId === "a")!.state === "connected", "a reconnected");
  assert.ok(a.disconnects >= 1);
  assert.equal(b2.connects, 0);
  assert.equal(b.disconnects, 0);
  assert.equal(r.multi.remoteStatuses().find((s) => s.environmentId === "b")!.state, "connected");
});

test("reconnectRemote ignores unknown and disabled remotes", async () => {
  const r = await rig();
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  r.multi.reconnectRemote("missing");
  await r.multi.setRemoteEnvironments([record("a", { enabled: false })]);
  const spare = new FakeClient(a.shell, "spare"); r.queue.push(spare);
  r.multi.reconnectRemote("a");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(spare.connects, 0);
  assert.equal(r.multi.remoteStatuses()[0]!.state, "disabled");
});

test("reconnectRemote retries an expired remote", async () => {
  const r = await rig();
  const bad = new FakeClient(shell([], [], 1), "bad"); bad.connectError = Object.assign(new Error("unauthorized"), { status: 401 }); r.queue.push(bad);
  await r.multi.setRemoteEnvironments([record("x", { expiresAt: Date.now() - DAY })]);
  await until(() => r.multi.remoteStatuses()[0]!.state === "expired", "expired");
  const good = new FakeClient(shell([project("p-x")], [thread("t-x", "p-x")], 1), "good"); r.queue.push(good);
  r.multi.reconnectRemote("x");
  await until(() => r.multi.remoteStatuses()[0]!.state === "connected", "reconnected");
  assert.equal(good.connects, 1);
});

test("A non-authentication connect failure is retried until it succeeds", async () => {
  const r = await rig({ reconnectDelayMs: 5 });
  const failing = new FakeClient(shell([project("p-a")], [thread("t-a", "p-a")], 1), "bad"); failing.connectError = new Error("ECONNREFUSED");
  const good = new FakeClient(failing.shell, "good"); r.queue.push(failing, good);
  await r.multi.setRemoteEnvironments([record("a")]);
  await until(() => r.multi.remoteStatuses()[0]!.state === "connected", "eventual connection");
  assert.equal(failing.connects, 1); assert.equal(good.connects, 1);
  assert.equal(r.revoked.length, 0);
});

test("searchThreads merges remote matches after local ones and tolerates a failing remote", async () => {
  const r = await rig();
  r.primary.searchResult = { matches: [{ threadId: "local-thread" }] };
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  const b = await pair(r, "b", shell([project("p-b")], [thread("t-b", "p-b")], 1));
  a.searchResult = { matches: [{ threadId: "t-a" }] };
  b.searchError = new Error("search failed");
  const result = await r.multi.searchThreads("needle") as unknown as { matches: Array<{ threadId: string }> };
  assert.deepEqual(result.matches.map((m) => m.threadId), ["local-thread", "t-a"]);
  assert.deepEqual(a.callsNamed("searchThreads"), [["searchThreads", "needle"]]);
  // With no remote matches the local result passes through untouched.
  a.searchResult = { matches: [] };
  assert.equal(await r.multi.searchThreads("needle"), r.primary.searchResult);
});

test("dispose stops remotes and cancels pending retries", async () => {
  const r = await rig({ reconnectDelayMs: 10 });
  const a = await pair(r, "a", shell([project("p-a")], [thread("t-a", "p-a")], 1));
  const retry = new FakeClient(a.shell, "retry"); r.queue.push(retry);
  a.close();
  await until(() => r.multi.remoteStatuses()[0]!.state === "error");
  await r.multi.dispose();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(retry.connects, 0);
  assert.deepEqual(r.multi.remoteStatuses(), []);
});
