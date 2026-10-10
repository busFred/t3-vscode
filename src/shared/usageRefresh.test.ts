import test from "node:test";
import assert from "node:assert/strict";
import { UsageRefreshScheduler, usageRefreshIntervalMs, type UsageRefreshTimers } from "./usageRefresh.js";

function fakeTimers() {
  const active = new Map<number, { callback: () => void; ms: number }>(); let next = 1;
  const timers: UsageRefreshTimers = { set: (callback, ms) => { active.set(next, { callback, ms }); return next++; }, clear: (handle) => { active.delete(handle as number); } };
  return { timers, active, tick: () => { for (const timer of [...active.values()]) timer.callback(); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("refresh interval is clamped, disabled at zero and defaults for invalid values", () => {
  assert.equal(usageRefreshIntervalMs(60), 60_000);
  assert.equal(usageRefreshIntervalMs(1), 15_000);
  assert.equal(usageRefreshIntervalMs(120), 120_000);
  assert.equal(usageRefreshIntervalMs(0), null);
  assert.equal(usageRefreshIntervalMs(-5), null);
  assert.equal(usageRefreshIntervalMs("x"), 60_000);
  assert.equal(usageRefreshIntervalMs(Number.NaN), 60_000);
});

test("scheduler refreshes once on becoming ready, then on every interval while ready", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60);
  clock.tick(); await settle(); assert.equal(calls, 0, "no refresh before the host is ready");
  scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setReady(true); await settle(); assert.equal(calls, 1, "repeated ready does not refresh again");
  clock.tick(); await settle(); assert.equal(calls, 2);
  scheduler.setReady(false); clock.tick(); await settle(); assert.equal(calls, 2);
  scheduler.setReady(true); await settle(); assert.equal(calls, 3, "reconnect refreshes again");
});

test("configuration changes restart the timer and zero disables it", () => {
  const clock = fakeTimers(); const scheduler = new UsageRefreshScheduler(async () => {}, clock.timers);
  scheduler.configure(60); assert.deepEqual([...clock.active.values()].map((timer) => timer.ms), [60_000]);
  scheduler.configure(60); assert.equal(clock.active.size, 1);
  scheduler.configure(30); assert.deepEqual([...clock.active.values()].map((timer) => timer.ms), [30_000]);
  scheduler.configure(0); assert.equal(clock.active.size, 0);
  scheduler.configure(5); assert.deepEqual([...clock.active.values()].map((timer) => timer.ms), [15_000]);
  scheduler.dispose(); assert.equal(clock.active.size, 0);
  scheduler.configure(60); assert.equal(clock.active.size, 0, "disposed scheduler stays stopped");
});

test("failed or overlapping refreshes neither throw nor stack", async () => {
  const clock = fakeTimers(); let calls = 0; let release!: () => void;
  const scheduler = new UsageRefreshScheduler(() => { calls += 1; return new Promise<void>((resolve, reject) => { release = () => reject(new Error("offline")); void resolve; }); }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); clock.tick(); await settle();
  assert.equal(calls, 1, "in-flight refresh is not duplicated");
  release(); await settle(); clock.tick(); await settle();
  assert.equal(calls, 2);
});
