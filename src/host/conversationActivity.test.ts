import test from "node:test";
import assert from "node:assert/strict";
import { viewsHarness } from "./testing/fakeTransport.js";
import { activityFixture, publishActivity } from "./testing/activityFixture.js";
import { conversationActivity } from "./conversationActivity.js";

test("The queue and task banner follow the current run and do not reuse an earlier turn's task list", () => {
  const projection = activityFixture("first"); const activity = conversationActivity(projection);
  assert.equal(activity.queue?.canSteer, true); assert.deepEqual(activity.queue?.entries.map((entry) => entry.text), ["Queued follow-up 1", "Queued follow-up 2"]);
  assert.equal(activity.tasks?.steps[1]?.text, "Implement the approved design");
  assert.equal(conversationActivity({ ...projection, plans: projection.plans.map((plan) => ({ ...plan, runId: projection.runs[0]!.id })) }).tasks, null);
  assert.equal(conversationActivity({ ...projection, runs: projection.runs.map((run) => ({ ...run, status: "completed" })) }).tasks, null);
  assert.equal(conversationActivity(activityFixture("first", false)).queue?.canSteer, false);
});
test("Queue and steer submissions are explicit and remain with their originating conversation", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); host.registerView("other"); await host.selectThread("second", "other");
  await host.sendMessage("queued", "first", undefined, "queue"); await host.sendMessage("steering", "first", undefined, "steer");
  const commands = client.commands.filter((command) => command.type === "message.dispatch");
  assert.deepEqual(commands[0]?.dispatchMode, { type: "queue_after_active" }); assert.equal(commands[0]?.deliveryIntent, undefined);
  assert.equal(commands[1]?.deliveryIntent, "steer"); assert.equal(host.snapshot("other").activeThreadId, "second");
  await assert.rejects(host.sendMessage("bad", "first", undefined, "invented"), /delivery mode/);
});
test("Queue edits retain attachments/context, and promotion uses the host's active run instead of a renderer target", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first"); publishActivity(client, "first");
  await host.queueAction("first", "edit", "queued-first-1", "Edited follow-up", undefined);
  const edit = client.commands.find((command) => command.type === "queued-run.edit")!;
  assert.equal(edit.type, "queued-run.edit"); if (edit.type === "queued-run.edit") { assert.deepEqual(edit.context, { version: 1, records: [] }); assert.equal(edit.attachments, undefined); }
  await host.queueAction("first", "reorder", "queued-first-2", undefined, "queued-first-1"); assert.equal(host.snapshot().queue?.entries[0]?.runId, "queued-first-2");
  await host.queueAction("first", "steer", "queued-first-1", undefined, undefined);
  const steer = client.commands.find((command) => command.type === "queued-message.promote-to-steer")!;
  assert.equal(steer.type, "queued-message.promote-to-steer"); if (steer.type === "queued-message.promote-to-steer") assert.equal(steer.targetRunId, "active-first");
  await assert.rejects(host.queueAction("first", "cancel", "queued-first-1", undefined, undefined), /no longer queued/);
  await assert.rejects(host.queueAction("first", "cancel", "invented", undefined, undefined), /no longer queued/);
  await assert.rejects(host.queueAction("outside-thread", "cancel", "queued-first-2", undefined, undefined), /workspace/);
  await host.queueAction("first", "cancel", "queued-first-2", undefined, undefined); assert.equal(host.snapshot().queue?.entries.length, 0);
});
test("A held queue can resume, but unsupported steering and stale reordering cannot mutate it", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  const projection = activityFixture("first", false);
  client.threadHandlers.get("first")?.({ kind: "snapshot", snapshotSequence: 1, projection: { ...projection, runs: projection.runs.map((run) => run.status === "queued" ? { ...run, queueHeld: true } : run) } });
  assert.equal(host.snapshot().queue?.held, true);
  await assert.rejects(host.queueAction("first", "steer", "queued-first-1", undefined, undefined), /cannot steer/);
  await assert.rejects(host.queueAction("first", "reorder", "queued-first-1", undefined, "missing"), /destination/);
  assert.equal(client.commands.length, 0);
  await host.queueAction("first", "resume", undefined, undefined, undefined);
  assert.equal(host.snapshot().queue?.held, false);
  await assert.rejects(host.queueAction("first", "resume", undefined, undefined, undefined), /not paused/);
});
