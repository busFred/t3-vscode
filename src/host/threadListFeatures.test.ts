import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, NodeId, ProviderDriverKind, ProviderInstanceId, RunId, ThreadId, type OrchestrationV2Subagent } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";
import { activityFixture, publishActivity } from "./testing/activityFixture.js";
import { v2Now, v2Projection } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { filterThreadListTags } from "../shared/threadListTags.js";
import { compareSessions } from "../shared/sessionSort.js";
import { canStopSubagent } from "../shared/subagentStop.js";
import { withRemoteSubagents } from "../shared/remoteSubagents.js";

const agent: OrchestrationV2Subagent = { id: NodeId.make("agent"), threadId: ThreadId.make("first"), runId: RunId.make("parent-run"),
  parentNodeId: NodeId.make("node"), origin: "app_owned", createdBy: "system", driver: ProviderDriverKind.make("codex"), providerInstanceId: ProviderInstanceId.make("codex"),
  providerThreadId: null, childThreadId: ThreadId.make("second"), nativeTaskRef: null,
  prompt: "Investigate", title: "Task", model: null, status: "running", result: null, startedAt: v2Now, completedAt: null, updatedAt: v2Now };

test("Tag commands trim and preserve case, validate contract rules, and remove exact tags", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.threadAction("first", "tag-add", "  Private  ");
  await host.threadAction("first", "tag-add", "private");
  assert.deepEqual(host.snapshot().threads.find(thread => thread.id === "first")?.tags, ["Private", "private"]);
  await host.threadAction("first", "tag-remove", "Private");
  assert.deepEqual(host.snapshot().threads.find(thread => thread.id === "first")?.tags, ["private"]);
  const command = client.commands.find(command => command.type === "thread.tag.set")!;
  assert.equal(command.type, "thread.tag.set"); if (command.type === "thread.tag.set") { assert.equal(command.threadId, "first"); assert.equal(command.tag, "Private"); assert.equal(command.tagged, true); }
  const count = client.commands.length;
  for (const value of [" ", "a".repeat(65), "a\nb", "x\u0000y"]) await assert.rejects(host.threadAction("first", "tag-add", value));
  await assert.rejects(host.threadAction("outside-thread", "tag-add", "valid"), /available/);
  assert.equal(client.commands.length, count);
});

test("Server tag hiding follows parent lineage and settings, while explicit sidebar tags match case", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.config = { ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, hiddenThreadTags: [" Private ", " "], hideTaggedThreads: true } };
  client.shell = { ...client.shell, snapshotSequence: 10, threads: client.shell.threads.map(thread => ({ ...thread,
    tags: thread.id === "first" ? ["Private"] : thread.id === "third" ? ["private"] : [],
    ...(thread.id === "second" ? { lineage: { ...thread.lineage, parentThreadId: ThreadId.make("first"), relationshipToParent: "subagent" as const } } : {}),
  })) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.deepEqual(filterThreadListTags(host.snapshot().threads).map(thread => thread.id), ["third"]);
  assert.deepEqual(filterThreadListTags(host.snapshot().threads, "private").map(thread => thread.id), ["third"]);
  assert.deepEqual(filterThreadListTags(host.snapshot().threads, "Private"), []);
  client.config = { ...client.config, settings: { ...client.config.settings!, hideTaggedThreads: false } };
  client.onConfig?.(client.config as never);
  assert.equal(filterThreadListTags(host.snapshot().threads).length, 3);
  assert.deepEqual(filterThreadListTags(host.snapshot().threads, "Private").map(thread => thread.id), ["first", "second"]);
});

test("Tag visibility updates use the owning server settings without discarding existing tags", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.config = { ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, hiddenThreadTags: ["keep"] } };
  const patches: unknown[] = [];
  Object.assign(client, { updateSettings: async (patch: object) => { patches.push(patch); client.config = { ...client.config, settings: { ...client.config.settings!, ...patch } }; return client.config.settings; } });
  await host.threadAction("first", "hide-tag", "new");
  await host.threadAction("first", "toggle-tag-hiding");
  await host.threadAction("first", "show-tag", "keep");
  assert.deepEqual(patches, [{ hiddenThreadTags: ["keep", "new"] }, { hideTaggedThreads: true }, { hiddenThreadTags: ["new"] }]);
  const remotePatches: unknown[] = [];
  Object.assign(client, { threadEnvironment: (id: string) => id === "second" ? { environmentId: "studio", label: "Studio" } : undefined,
    configForThread: (id: string) => id === "second" ? { ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, hiddenThreadTags: ["remote"] } } : client.config,
    environmentCalls: () => ({ updateSettings: async (patch: unknown) => { remotePatches.push(patch); } }) });
  await host.threadAction("second", "hide-tag", "remote-new");
  assert.deepEqual(remotePatches, [{ hiddenThreadTags: ["remote", "remote-new"] }]); assert.equal(patches.length, 3);
});

test("Pinned moves persist server order keys and reject stale or unpinned destinations", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.shell = { ...client.shell, snapshotSequence: 10, threads: client.shell.threads.map(thread => ({ ...thread, pinnedAt: v2Now, pinOrderKey: thread.id === "first" ? "g" : thread.id === "second" ? "n" : "t" })) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.reorderPins("third", "first");
  const sorted = () => [...host.snapshot().threads].sort((a, b) => compareSessions(a, b, "title-desc")).map(thread => thread.id);
  assert.deepEqual(sorted(), ["third", "first", "second"]);
  await host.reorderPins("third", null); assert.deepEqual(sorted(), ["first", "second", "third"]);
  assert.equal(client.commands.filter(command => command.type === "thread.pin.reorder").length, 2);
  await assert.rejects(host.reorderPins("first", "missing"), /no longer pinned/);
  await host.threadAction("first", "unpin");
  await assert.rejects(host.reorderPins("first", null), /Only active pinned/);
});

test("Keyless pins get ordered keys without losing any pinned row", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.shell = { ...client.shell, snapshotSequence: 10, threads: client.shell.threads.map(thread => ({ ...thread, pinnedAt: v2Now, pinOrderKey: null })) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.reorderPins("third", "first");
  assert.deepEqual([...host.snapshot().threads].sort((a, b) => compareSessions(a, b, "date-asc")).map(thread => thread.id), ["third", "first", "second"]);
  assert.ok(client.commands.filter(command => command.type === "thread.pin.reorder").length > 1);
});

test("Send now starts the selected queued run only while the workflow permits it", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first"); publishActivity(client, "first");
  await assert.rejects(host.queueAction("first", "start", "queued-first-2", undefined, undefined), /current turn/);
  const projection = activityFixture("first");
  const idle = { ...projection, runs: projection.runs.map(run => run.status === "running" ? { ...run, status: "completed" as const } : run) };
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 21, projection: idle });
  assert.equal(host.snapshot().queue?.canSendNow, true);
  await host.queueAction("first", "start", "queued-first-2", undefined, undefined);
  const command = client.commands.find(command => command.type === "queued-run.start")!;
  assert.equal(command.type, "queued-run.start"); if (command.type === "queued-run.start") { assert.equal(command.runId, "queued-first-2"); assert.equal(command.threadId, "first"); }
  await assert.rejects(host.queueAction("first", "start", "missing", undefined, undefined), /no longer queued/);
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 22, projection: { ...idle, thread: { ...idle.thread, archivedAt: v2Now } } });
  await assert.rejects(host.queueAction("first", "start", "queued-first-1", undefined, undefined), /current turn/);
});

test("Subagent stop validates the parent task and routes app-owned children to their environment", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  const publish = (entry: OrchestrationV2Subagent) => client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 30, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make("first") }, subagents: [entry] } });
  publish(agent);
  assert.deepEqual(host.snapshot().threads.find(thread => thread.id === "second")?.stopSubagent, { threadId: "first", subagentId: "agent" });
  await host.stopSubagent("first", "agent");
  const command = client.commands.find(command => command.type === "subagent.stop")!;
  assert.equal(command.type, "subagent.stop"); if (command.type === "subagent.stop") assert.equal(command.runId, "parent-run");
  assert.ok(client.commands.some(command => command.type === "thread.stop" && command.threadId === "second"));
  await assert.rejects(host.stopSubagent("first", "missing"), /cannot be stopped/);
  publish({ ...agent, status: "completed" }); await assert.rejects(host.stopSubagent("first", "agent"), /cannot be stopped/);
  publish({ ...agent, origin: "provider_native" }); await assert.rejects(host.stopSubagent("first", "agent"), /cannot be stopped/);
  Object.assign(client, { threadEnvironment: (id: string) => id === "second" ? { environmentId: "studio", label: "Studio" } : undefined });
  publish({ ...agent, remoteChild: { environmentId: EnvironmentId.make("studio"), threadId: ThreadId.make("second"), label: "Studio" }, childThreadId: null });
  await host.stopSubagent("first", "agent");
  assert.deepEqual(client.commands.at(-1) && { type: client.commands.at(-1)!.type, threadId: (client.commands.at(-1) as { threadId: string }).threadId }, { type: "thread.stop", threadId: "second" });
  const rows = withRemoteSubagents(host.snapshot().threads);
  assert.deepEqual(rows.find(thread => thread.id === "second")?.stopSubagent, { threadId: "first", subagentId: "agent" });
});

test("Native Stop requires a running Claude task with strong native identity and a run", () => {
  const native = { ...agent, origin: "provider_native" as const, driver: ProviderDriverKind.make("claudeAgent"), nativeTaskRef: { strength: "strong", nativeId: "native" } as OrchestrationV2Subagent["nativeTaskRef"] };
  assert.equal(canStopSubagent(native), true);
  for (const entry of [{ ...native, runId: null }, { ...native, nativeTaskRef: null }, { ...native, startedAt: null }, { ...native, status: "completed" as const }, { ...native, driver: ProviderDriverKind.make("codex") }]) assert.equal(canStopSubagent(entry), false);
});

test("Tag hiding inherits across delegated environments and hides orphaned children", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  Object.assign(client, { threadEnvironment: (id: string) => id === "first" ? undefined : { environmentId: "studio", label: "Studio" },
    configForThread: (id: string) => ({ ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, hideTaggedThreads: id === "first", hiddenThreadTags: ["Private"] } }) });
  client.shell = { ...client.shell, snapshotSequence: 10, threads: client.shell.threads.map(thread => ({ ...thread,
    tags: thread.id === "first" ? ["Private"] : [],
    ...(thread.id === "second" ? { delegatedFrom: { title: "Parent", threadId: ThreadId.make("first"), environmentId: EnvironmentId.make(host.snapshot().environment!.environmentId) } } : {}),
    ...(thread.id === "third" ? { lineage: { ...thread.lineage, parentThreadId: ThreadId.make("missing"), relationshipToParent: "subagent" as const } } : {}),
  })) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.deepEqual(host.snapshot().threads.map(thread => thread.hiddenByTag), [true, true, true]);
  Object.assign(client, { configForThread: () => ({ ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, hideTaggedThreads: true, hiddenThreadTags: [" "] } }) });
  client.onConfig?.(client.config as never);
  assert.deepEqual(host.snapshot().threads.map(thread => thread.hiddenByTag), [false, false, false]);
});

test("Pin rebalancing retains hidden pins and rejects hidden moved rows", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.config = { ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, hideTaggedThreads: true, hiddenThreadTags: ["private"] } };
  client.shell = { ...client.shell, snapshotSequence: 11, threads: client.shell.threads.map(thread => ({ ...thread,
    pinnedAt: v2Now, pinOrderKey: thread.id === "first" ? "n" : null, tags: thread.id === "first" ? ["private"] : [],
  })) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.reorderPins("third", "second");
  assert.ok(client.commands.every(command => command.type !== "thread.pin.reorder" || command.threadId !== "first"));
  assert.equal(host.snapshot().threads.find(thread => thread.id === "first")?.pinOrderKey, "n");
  await assert.rejects(host.reorderPins("first", "second"), /hidden by tag/);
});

test("An app-owned child's newer run remains stoppable even if parent stop fails", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  client.shell = { ...client.shell, snapshotSequence: 12, threads: client.shell.threads.map(thread => thread.id === "second"
    ? { ...thread, activityRunStatus: "running" as const, activityRunStartedAt: v2Now } : thread) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 32, projection: { ...v2Projection,
    thread: { ...v2Projection.thread, id: ThreadId.make("first") }, subagents: [{ ...agent, status: "completed" }] } });
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async (input) => { if ((input as { type: string }).type === "subagent.stop") throw new Error("Parent lost task"); await dispatch(input); };
  await host.stopSubagent("first", "agent");
  assert.equal(client.commands.at(-1)?.type, "thread.stop");
});
