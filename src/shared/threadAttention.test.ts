import test from "node:test";
import assert from "node:assert/strict";
import { parseCustomSnooze, unseenRun } from "./threadAttention.js";
import { sessionShelves } from "./sessionTree.js";
import type { ThreadSummary } from "./bridge.js";

test("A finished run is unread only after a visit; a failure needs someone even on a never-opened thread", () => {
  const done = { status: "completed", completedAt: "2026-10-24T12:00:00.000Z" };
  assert.equal(unseenRun(done, null), null);
  assert.equal(unseenRun(done, "2026-10-24T11:00:00.000Z"), "done");
  assert.equal(unseenRun(done, "2026-10-24T12:00:00.000Z"), null);
  assert.equal(unseenRun({ status: "running", completedAt: null }, "2026-10-24T11:00:00.000Z"), null);
  const failed = { status: "failed", completedAt: "2026-10-24T12:00:00.000Z" };
  assert.equal(unseenRun(failed, null), "failed");
  assert.equal(unseenRun(failed, "2026-10-24T11:59:00.000Z"), "failed");
  assert.equal(unseenRun(failed, "2026-10-24T12:01:00.000Z"), null);
  assert.equal(unseenRun(null, null), null);
});

test("Custom snooze accepts durations, a date and time, or a time of day", () => {
  const now = new Date(2026, 9, 24, 15, 30);
  assert.equal(parseCustomSnooze("90m", now), new Date(2026, 9, 24, 17, 0).toISOString());
  assert.equal(parseCustomSnooze("2 hours", now), new Date(2026, 9, 24, 17, 30).toISOString());
  assert.equal(parseCustomSnooze("3d", now), new Date(2026, 9, 27, 15, 30).toISOString());
  assert.equal(parseCustomSnooze("2026-10-25 9:05", now), new Date(2026, 9, 25, 9, 5).toISOString());
  // A time already past today means tomorrow.
  assert.equal(parseCustomSnooze("18:00", now), new Date(2026, 9, 24, 18, 0).toISOString());
  assert.equal(parseCustomSnooze("09:00", now), new Date(2026, 9, 25, 9, 0).toISOString());
  for (const text of ["", "soon", "0h", "5 weeks", "2026-10-23 10:00", "2026-02-30 10:00"]) assert.equal(parseCustomSnooze(text, now), null, text);
});

test("Snoozed threads leave the active list for their own shelf, soonest wake first", () => {
  const thread = (id: string, fields: Partial<ThreadSummary> = {}) => ({ id, projectId: "p", title: id, status: "idle", updatedAt: "2026-10-24T12:00:00.000Z", archived: false, pinned: false, activeRunId: null, ...fields }) as ThreadSummary;
  const shelves = sessionShelves([
    thread("active"), thread("later", { snoozedUntil: "2026-10-25T09:00:00.000Z" }), thread("sooner", { snoozedUntil: "2026-10-24T18:00:00.000Z" }),
    thread("settled", { settled: true, snoozedUntil: "2026-10-25T09:00:00.000Z" }),
  ]);
  assert.deepEqual(shelves.active.map((node) => node.thread.id), ["active"]);
  assert.deepEqual(shelves.snoozed.map((node) => node.thread.id), ["sooner", "later"]);
  assert.deepEqual(shelves.settled.map((node) => node.thread.id), ["settled"]);
});
