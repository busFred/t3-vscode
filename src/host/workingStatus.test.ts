import assert from "node:assert/strict";
import test from "node:test";
import { MessageId, RunId, TurnItemId } from "@t3tools/contracts";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";
import { turnFixture } from "./testing/turnFixture.js";

test("Working begins on accepted dispatch, before output, and ends on the run's terminal state", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.sendMessage("Start", "first");
  const accepted = host.snapshot().acknowledgedWorking;
  assert.ok(accepted); assert.equal(host.snapshot().transcript.length, 0);
  await host.sendMessage("Queued", "first", "sidebar", "queue");
  assert.equal(host.snapshot().acknowledgedWorking?.messageId, accepted.messageId, "Queueing must not replace the active response's acknowledgement");
  const projection = turnFixture("first", 1), run = { ...projection.runs[0]!, userMessageId: MessageId.make(accepted.messageId) };
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 12, projection: { ...projection, runs: [run] } });
  assert.equal(host.snapshot().acknowledgedWorking, undefined);
});
test("Only the final assistant message of a settled run can fork", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "Early answer", 1, { runId: RunId.make("run-first-1") });
  const projection = await client.getThreadProjection("first"), first = projection.visibleTurnItems[0]!;
  const finalId = TurnItemId.make("final-answer");
  const last = { ...first, position: 1, sourceItemId: finalId, item: { ...first.item, id: finalId } };
  const run = turnFixture("first", 1).runs[0]!;
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection: { ...projection, visibleTurnItems: [first, last], runs: [{ ...run, status: "running" }] } });
  assert.deepEqual(host.snapshot().transcript.map(row => row.canFork), [false, false]);
  await assert.rejects(host.forkFromResponse("first", "first", "text-first"), /cannot be forked/);
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 3, projection: { ...projection, visibleTurnItems: [first, last], runs: [run] } });
  assert.deepEqual(host.snapshot().transcript.map(row => row.canFork), [false, true]);
});
