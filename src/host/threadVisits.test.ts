import test from "node:test";
import assert from "node:assert/strict";
import { ThreadVisits, VISIT_THROTTLE_MS, type SeenThread } from "./threadVisits.js";

const seen = (updatedAt: string, fields: Partial<SeenThread> = {}): SeenThread => ({ threadId: "a", updatedAt, lastVisitedAt: null, urgent: false, ...fields });

test("A thread on screen is visited once per change, throttled unless something unseen is showing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sent: Array<[string, string]> = [];
  const visits = new ThreadVisits(async (threadId, visitedAt) => { sent.push([threadId, visitedAt]); }, () => Date.now());
  visits.update([seen("2026-10-24T12:00:00.000Z")]);
  visits.update([seen("2026-10-24T12:00:00.000Z")]);
  assert.deepEqual(sent, [["a", "2026-10-24T12:00:00.000Z"]]);
  // Already visited at this watermark: nothing to send.
  visits.update([seen("2026-10-24T12:00:01.000Z", { lastVisitedAt: "2026-10-24T12:00:01.000Z" })]);
  assert.equal(sent.length, 1);
  // A plain change waits out the throttle, then sends the latest watermark.
  visits.update([seen("2026-10-24T12:00:02.000Z")]);
  visits.update([seen("2026-10-24T12:00:03.000Z")]);
  assert.equal(sent.length, 1);
  t.mock.timers.tick(VISIT_THROTTLE_MS);
  assert.deepEqual(sent.at(-1), ["a", "2026-10-24T12:00:03.000Z"]);
  // A finished run on screen is visited at once.
  visits.update([seen("2026-10-24T12:00:04.000Z", { urgent: true })]);
  assert.deepEqual(sent.at(-1), ["a", "2026-10-24T12:00:04.000Z"]);
  visits.dispose();
});

test("Off-screen threads are never visited, and a pending visit is dropped when the thread leaves the screen", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sent: string[] = [];
  const visits = new ThreadVisits(async (threadId) => { sent.push(threadId); }, () => Date.now());
  visits.update([seen("2026-10-24T12:00:00.000Z")]);
  visits.update([seen("2026-10-24T12:00:01.000Z")]);
  visits.update([]);
  t.mock.timers.tick(VISIT_THROTTLE_MS);
  assert.deepEqual(sent, ["a"]);
  visits.dispose();
});

test("Mark unread holds while the thread stays on screen unchanged, and ends on a change or leaving the screen", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sent: string[] = [];
  const visits = new ThreadVisits(async (_, visitedAt) => { sent.push(visitedAt); }, () => Date.now());
  visits.holdUnread("a", "2026-10-24T12:00:00.000Z");
  visits.update([seen("2026-10-24T12:00:00.000Z", { urgent: true })]);
  assert.deepEqual(sent, []);
  visits.update([seen("2026-10-24T12:00:05.000Z", { urgent: true })]);
  assert.deepEqual(sent, ["2026-10-24T12:00:05.000Z"]);
  visits.holdUnread("a", "2026-10-24T12:00:05.000Z");
  visits.update([]);
  t.mock.timers.tick(VISIT_THROTTLE_MS);
  visits.update([seen("2026-10-24T12:00:05.000Z", { urgent: true })]);
  assert.deepEqual(sent, ["2026-10-24T12:00:05.000Z", "2026-10-24T12:00:05.000Z"], "looking again after Mark unread reads it again, though the thread is unchanged");
  visits.dispose();
});

test("A failed visit is retried on the next change on screen", async () => {
  let fail = true; const sent: string[] = [];
  const visits = new ThreadVisits(async (_, visitedAt) => { if (fail) throw new Error("offline"); sent.push(visitedAt); });
  visits.update([seen("2026-10-24T12:00:00.000Z", { urgent: true })]);
  await new Promise((resolve) => setImmediate(resolve));
  fail = false;
  visits.update([seen("2026-10-24T12:00:00.000Z", { urgent: true })]);
  assert.deepEqual(sent, ["2026-10-24T12:00:00.000Z"]);
  visits.dispose();
});
