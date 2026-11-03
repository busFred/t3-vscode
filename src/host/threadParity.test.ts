import test from "node:test";
import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { OrchestrationV2ThreadProjection, OrchestrationV2DomainEvent, OrchestrationV2ThreadShell, PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";

const projectionWith = (base: OrchestrationV2ThreadProjection, fields: object) => Schema.decodeUnknownSync(OrchestrationV2ThreadProjection)({ ...Schema.encodeSync(OrchestrationV2ThreadProjection)(base), ...fields });

test("Stop dispatches thread.stop for active, background-only, subagent-only and idle threads", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  for (const fields of [
    { activeRunId: "run", status: "running" },
    { activeRunId: null, status: "completed", pendingBackgroundTasks: [{ taskId: "bg", kind: "command", description: "dev server" }] },
    { activeRunId: null, pendingBackgroundTasks: [{ taskId: "child", kind: "subagent", description: "Research", childThreadId: "second" }] },
    { activeRunId: null, pendingBackgroundTasks: [] },
  ]) {
    client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((thread) => thread.id === "first" ? Schema.decodeUnknownSync(OrchestrationV2ThreadShell)({ ...Schema.encodeSync(OrchestrationV2ThreadShell)(thread), ...fields }) : thread) };
    client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
    await host.interrupt("first");
    const command = client.commands.at(-1)!;
    assert.equal(command.type, "thread.stop");
    assert.equal(command.threadId, "first");
    assert.ok(!("runId" in command));
    assert.ok(!("stopDelegatedTasks" in command), "server defaults to stopping delegated tasks");
  }
});

test("Force stop requires an unresponsive Stop, server support and the same run", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  const base = await client.getThreadProjection("first");
  const at = DateTime.makeUnsafe(Date.now());
  const make = (unresponsive: boolean, status = "running", result = false) => projectionWith(base, {
    runs: [{ id: "run", threadId: "first", ordinal: 1, status, createdAt: at, updatedAt: at, requestedAt: at, startedAt: at, completedAt: status === "completed" ? at : null, userMessageId: "message", providerInstanceId: base.thread.providerInstanceId, modelSelection: base.thread.modelSelection, rootNodeId: null, activeAttemptId: null, checkpointId: null, contextHandoffId: null, providerThreadId: null, providerTurnId: null }],
    turnItems: [{ id: "stop", threadId: "first", runId: "run", type: "run_interrupt_request", title: null, status: "running", ordinal: 1, message: "Stop", startedAt: at, completedAt: null, updatedAt: at, nodeId: null, parentItemId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, ...(unresponsive ? { unresponsiveAt: at } : {}) },
      ...(result ? [{ id: "result", threadId: "first", runId: "run", type: "run_interrupt_result", title: null, status: "completed", ordinal: 2, message: "Stopped", startedAt: at, completedAt: at, updatedAt: at, nodeId: null, parentItemId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null }] : [])],
  });
  let sequence = 1;
  const show = (projection: OrchestrationV2ThreadProjection) => client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: ++sequence, projection });
  const summary = () => host.snapshot().threads.find((thread) => thread.id === "first")!;
  show(make(true));
  assert.equal(summary().forceStopRunId, undefined);
  client.config = { ...client.config, environment: { capabilities: { threadForceStop: true } } as NonNullable<typeof client.config.environment> };
  show(make(false));
  assert.equal(summary().forceStopRunId, undefined);
  await assert.rejects(host.forceStop("first", "run"), /no longer waiting/);
  show(make(true));
  assert.equal(summary().forceStopRunId, "run");
  await assert.rejects(host.forceStop("first", "new-run"), /no longer waiting/);
  await host.forceStop("first", "run");
  assert.deepEqual(client.forceStops, [{ threadId: "first", runId: "run" }]);
  show(make(true, "completed"));
  assert.equal(summary().forceStopRunId, undefined, "no pending background work remains");
  show(make(true, "running", true));
  assert.equal(summary().forceStopRunId, undefined, "a stop result clears Force stop");
});

test("Workspace suggestions refresh expired complete snapshots, coalescing concurrent refreshes", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const provider = client.config.providers[0]!;
  client.config = { ...client.config, providers: [{ ...provider, workspaceSnapshots: [{ cwd: "/tmp/t3-vscode", checkedAt: new Date(Date.now() - PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS - 1).toISOString(), slashCommands: [], skills: [{ name: "old", enabled: true, path: "/tmp/old" }] }] }] };
  let finish!: () => void;
  client.refreshProviders = async (instanceId, cwd) => {
    client.providerRefreshes.push({ instanceId, cwd });
    await new Promise<void>((resolve) => { finish = resolve; });
    client.config = { ...client.config, providers: [{ ...provider, workspaceSnapshots: [{ cwd: cwd!, checkedAt: new Date().toISOString(), slashCommands: [], skills: [{ name: "fresh", enabled: true, path: "/tmp/fresh" }] }] }] };
    return { providers: client.config.providers };
  };
  const first = host.composerSuggestions("skill", "", true), second = host.composerSuggestions("skill", "", true);
  await new Promise((resolve) => setImmediate(resolve)); finish();
  for (const items of await Promise.all([first, second])) {
    assert.ok(items.some((item) => item.label.includes("fresh")));
    assert.ok(!items.some((item) => item.label.includes("old")));
  }
  await host.composerSuggestions("skill", "", true);
  assert.equal(client.providerRefreshes.length, 1);
});

test("Upstream reducers project tags, guest share and PR link deltas; shell summaries retain tags and links", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  let projection = (await client.getThreadProjection("first"));
  const at = new Date().toISOString();
  const link = { host: "github.com", repository: "owner/repo", number: 42, url: "https://example.invalid/pr/42", source: "manual", linkedAt: at, snapshot: null, stack: null };
  projection = { ...projection, thread: { ...projection.thread, linkedPullRequest: { projectId: projection.thread.projectId, repository: "owner/repo", number: 42, url: "https://github.com/owner/repo/pull/42" }, pullRequests: [{ ...link, source: "manual", url: "https://github.com/owner/repo/pull/42" }] } };
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 1, projection });
  let sequence = 1;
  const share = { id: "share", host: "share.invalid", guestName: "Guest", createdAt: at, expiresAt: at, messages: [] };
  for (const [type, fields] of [["thread.tags-updated", { tags: ["review"] }], ["thread.guest-share-updated", { guestShare: share }], ["thread.pull-request-link-updated", null]] as const) {
    const payload = fields ? { ...Schema.encodeSync(OrchestrationV2ThreadProjection)(projection).thread, ...fields } : link;
    const event = Schema.decodeUnknownSync(OrchestrationV2DomainEvent)({ id: `event-${type}`, threadId: "first", occurredAt: DateTime.makeUnsafe(at), type, payload });
    client.threadHandlers.get("first")!({ kind: "event", sequence: ++sequence, event });
    projection = host["threads"].get("first")!.projection!;
    if (type === "thread.tags-updated") assert.deepEqual(projection.thread.tags, ["review"]);
    if (type === "thread.guest-share-updated") assert.equal(projection.thread.guestShare?.guestName, "Guest");
    if (type === "thread.pull-request-link-updated") assert.equal(projection.thread.pullRequests?.[0]?.url, link.url);
  }
  const thread = client.shell.threads.find((thread) => thread.id === "first")!;
  client.shellHandler!({ kind: "thread.updated", sequence: client.shell.snapshotSequence + 1, location: "active", thread: { ...thread, tags: projection.thread.tags, pullRequests: projection.thread.pullRequests, linkedPullRequest: projection.thread.linkedPullRequest } });
  const summary = host.snapshot().threads.find((thread) => thread.id === "first")!;
  assert.deepEqual(summary.tags, ["review"]);
  assert.equal(summary.pullRequests?.[0]?.url, link.url);
  assert.equal(summary.linkedPullRequest?.number, 42);
  assert.deepEqual(summary.linkedPullRequest, projection.thread.linkedPullRequest ?? null);
});
