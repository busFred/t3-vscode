import test from "node:test";
import assert from "node:assert/strict";
import * as DateTime from "effect/DateTime";
import { DEFAULT_SERVER_SETTINGS, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { viewsHarness, type FakeTransport } from "./testing/fakeTransport.js";

const capable = (client: FakeTransport) => {
  client.config = { ...client.config, environment: { capabilities: { threadSnooze: true, threadVisitedTracking: true, threadAutoSettleOptOut: true } } as NonNullable<typeof client.config.environment> };
};
/** Replace one shell thread the way a server delta would. */
const updateThread = (client: FakeTransport, id: string, fields: Record<string, unknown>) => {
  const sequence = client.shell.snapshotSequence + 1;
  client.shell = { ...client.shell, snapshotSequence: sequence, threads: client.shell.threads.map((thread) => thread.id === id ? { ...thread, ...fields } : thread) };
  client.shellHandler?.({ kind: "thread.updated", sequence, location: "active", thread: client.shell.threads.find((thread) => thread.id === id)! });
};
const summary = (host: Awaited<ReturnType<typeof viewsHarness>>["host"], id: string) => host.snapshot().threads.find((thread) => thread.id === id)!;

test("Read state, snooze and auto-settle appear only where the thread's server supports them", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const plain = summary(host, "first");
  assert.deepEqual([plain.tracksVisits, plain.canSnooze, plain.autoSettle, plain.unseen], [undefined, undefined, undefined, undefined]);
  await assert.rejects(host.threadAction("first", "snooze", new Date(Date.now() + 3_600_000).toISOString()), /cannot snooze/);
  await assert.rejects(host.threadAction("first", "mark-unread"), /does not track read state/);
  await assert.rejects(host.threadAction("first", "auto-settle-off"), /cannot change auto-settle/);
  assert.equal(client.commands.length, 0);
  capable(client);
  const capableSummary = summary(host, "first");
  assert.deepEqual([capableSummary.tracksVisits, capableSummary.canSnooze, capableSummary.autoSettle], [true, true, true]);
  // T3 can only mark a thread unread once a run has finished.
  assert.equal(capableSummary.canMarkUnread, undefined);
  await assert.rejects(host.threadAction("first", "mark-unread"), /finished response/);
});

test("Auto-settle is offered only where the thread's machine auto-settles anything, following live settings", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); capable(client);
  const projectId = host.snapshot().threads.find((thread) => thread.id === "first")!.projectId;
  const settle = (settings: Partial<typeof DEFAULT_SERVER_SETTINGS>) => {
    client.config = { ...client.config, settings: { ...DEFAULT_SERVER_SETTINGS, ...settings } } as typeof client.config;
    client.onConfig?.(client.config as Parameters<NonNullable<typeof client.onConfig>>[0]);
  };
  assert.equal(summary(host, "first").autoSettle, true, "unknown settings keep the choice");
  settle({ sidebarAutoSettleAfterDays: null, sidebarAutoSettleOnMerge: false });
  assert.equal(summary(host, "first").autoSettle, undefined, "a machine that never auto-settles hides it");
  settle({ sidebarAutoSettleAfterDays: null, sidebarAutoSettleOnMerge: false, projectSettingsOverrides: { [ProjectId.make("other")]: { sidebarAutoSettleAfterDays: 7 } } });
  assert.equal(summary(host, "first").autoSettle, true, "any project that auto-settles runs T3's sweep, which settles closed pull requests everywhere");
  settle({ sidebarAutoSettleAfterDays: 3, projectSettingsOverrides: { [projectId]: { sidebarAutoSettleAfterDays: null, sidebarAutoSettleOnMerge: false } } });
  assert.equal(summary(host, "first").autoSettle, true, "a project that turns it off can still settle on a closed pull request");
  settle({ sidebarAutoSettleAfterDays: null, sidebarAutoSettleOnMerge: false, projectSettingsOverrides: { [projectId]: { sidebarAutoSettleAfterDays: null } } });
  assert.equal(summary(host, "first").autoSettle, undefined, "overrides that keep it off still hide it");
});

test("Snooze moves a thread to the Snoozed shelf until it wakes, and Wake brings it back", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); capable(client);
  await assert.rejects(host.threadAction("first", "snooze", new Date(Date.now() - 1000).toISOString()), /future/);
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await host.threadAction("first", "snooze", until);
  assert.deepEqual(client.commands.map((command) => command.type === "thread.snooze" ? command.snoozedUntil : command.type), [until]);
  assert.equal(summary(host, "first").snoozedUntil, until);
  await host.threadAction("first", "unsnooze");
  assert.equal(client.commands.at(-1)?.type, "thread.unsnooze");
  assert.equal(summary(host, "first").snoozedUntil, undefined);
  // A thread waiting on the person cannot be hidden.
  updateThread(client, "second", { pendingRuntimeRequest: { id: "request", kind: "user_input", createdAt: DateTime.makeUnsafe(Date.now()) } });
  assert.equal(summary(host, "second").canSnooze, false);
  await assert.rejects(host.threadAction("second", "snooze", until), /waiting for you/);
});

test("A woken snooze shows until visited, and a run finished after the last visit reads as Done", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); capable(client);
  const visited = DateTime.makeUnsafe(Date.now() - 60_000), finished = DateTime.makeUnsafe(Date.now() - 30_000);
  updateThread(client, "first", { latestRunId: RunId.make("run"), latestRunCompletedAt: finished, lastVisitedAt: visited });
  assert.equal(summary(host, "first").unseen, "done");
  updateThread(client, "second", { snoozedUntil: DateTime.makeUnsafe(Date.now() - 1000), snoozedAt: DateTime.makeUnsafe(Date.now() - 7_200_000), lastVisitedAt: DateTime.makeUnsafe(Date.now() - 3_600_000) });
  assert.deepEqual([summary(host, "second").woke, summary(host, "second").snoozedUntil], [true, undefined]);
  updateThread(client, "second", { lastVisitedAt: DateTime.makeUnsafe(Date.now()) });
  assert.equal(summary(host, "second").woke, undefined);
});

test("Only a thread whose tab is visible in a focused window is visited; Mark unread holds while it stays open", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); capable(client);
  updateThread(client, "first", { latestRunId: RunId.make("run"), latestRunCompletedAt: DateTime.makeUnsafe(Date.now() - 1000), lastVisitedAt: DateTime.makeUnsafe(Date.now() - 60_000), updatedAt: DateTime.makeUnsafe(Date.now() - 1000) });
  host.registerView("tab"); await host.selectThread("first", "tab");
  const visits = () => client.commands.filter((command) => command.type === "thread.visit");
  assert.equal(visits().length, 0, "a hidden tab reads nothing");
  host.setWindowFocused(false); host.setViewVisible("tab", true);
  assert.equal(visits().length, 0, "an unfocused window reads nothing");
  host.setWindowFocused(true);
  assert.deepEqual(visits().map((command) => command.threadId), [ThreadId.make("first")]);
  assert.equal(summary(host, "first").unseen, undefined);
  await host.threadAction("first", "mark-unread");
  assert.equal(summary(host, "first").unseen, "done");
  host.setViewVisible("tab", true);
  assert.equal(visits().length, 1, "the hold keeps it unread while the tab stays on screen");
  host.setViewVisible("tab", false); host.setViewVisible("tab", true);
  assert.equal(visits().length, 2, "looking again reads it again, though Mark unread left the thread unchanged");
  assert.equal(summary(host, "first").unseen, undefined);
});

test("Duplicate copies the conversation into a new thread and opens it beside the source", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const opened: string[] = [];
  const bridge = new BridgeHandler(host, new WebviewRegistry(), async () => {}, { rename: async () => undefined, confirmDelete: async () => false }, undefined, { openSessionTab: async (threadId) => { opened.push(threadId); } });
  await bridge.performThreadAction("second", "duplicate");
  const fork = client.commands.find((command) => command.type === "thread.fork");
  assert.ok(fork?.type === "thread.fork");
  assert.deepEqual([fork.sourceThreadId, fork.sourcePoint, fork.title], [ThreadId.make("second"), { type: "latest_stable" }, "second conversation (copy)"]);
  assert.deepEqual(opened, [fork.targetThreadId]);
  assert.equal(host.snapshot().activeThreadId, "first");
});

test("Custom snooze asks for a time and cancelling sends nothing", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); capable(client);
  let answer: string | undefined;
  const bridge = new BridgeHandler(host, new WebviewRegistry(), async () => {}, { rename: async () => undefined, confirmDelete: async () => false, snoozeUntil: async () => answer });
  await bridge.performThreadAction("first", "snooze");
  assert.equal(client.commands.length, 0);
  answer = new Date(Date.now() + 7_200_000).toISOString();
  await bridge.performThreadAction("first", "snooze");
  assert.equal(client.commands.at(-1)?.type, "thread.snooze");
});
