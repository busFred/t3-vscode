import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_USAGE_REFRESH_SECONDS, UsageRefreshScheduler, usageRefreshIntervalMs, type UsageRefreshTimers } from "./usageRefresh.js";

function fakeTimers(...jitter: ReadonlyArray<number>) {
  const active = new Map<number, { callback: () => void; ms: number }>(); let next = 1; let clock = 0; let draw = 0;
  const timers: UsageRefreshTimers = {
    set: (callback, ms) => { active.set(next, { callback, ms }); return next++; }, clear: (handle) => { active.delete(handle as number); },
    now: () => clock, random: () => jitter.length ? jitter[Math.min(draw++, jitter.length - 1)]! : 0,
  };
  return { timers, active, advance: (ms: number) => { clock += ms; }, delays: () => [...active.values()].map((timer) => timer.ms),
    tick: () => { for (const [handle, timer] of [...active]) { active.delete(handle); timer.callback(); } } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("refresh interval is clamped, disabled at zero and defaults for invalid values", () => {
  const fallback = DEFAULT_USAGE_REFRESH_SECONDS * 1000;
  assert.equal(usageRefreshIntervalMs(60), 60_000);
  assert.equal(usageRefreshIntervalMs(1), 15_000);
  assert.equal(usageRefreshIntervalMs(120), 120_000);
  assert.equal(usageRefreshIntervalMs(0), null);
  assert.equal(usageRefreshIntervalMs(-5), null);
  assert.equal(usageRefreshIntervalMs("x"), fallback);
  assert.equal(usageRefreshIntervalMs(Number.NaN), fallback);
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
  scheduler.configure(60); assert.deepEqual(clock.delays(), [60_000]);
  scheduler.configure(60); assert.equal(clock.active.size, 1);
  scheduler.configure(30); assert.deepEqual(clock.delays(), [30_000]);
  scheduler.configure(0); assert.equal(clock.active.size, 0);
  scheduler.configure(5); assert.deepEqual(clock.delays(), [15_000]);
  scheduler.dispose(); assert.equal(clock.active.size, 0);
  scheduler.configure(60); assert.equal(clock.active.size, 0, "disposed scheduler stays stopped");
});

test("failed or overlapping refreshes neither throw nor stack", async () => {
  const clock = fakeTimers(); let calls = 0; let release!: () => void;
  const scheduler = new UsageRefreshScheduler(() => { calls += 1; return new Promise<void>((resolve, reject) => { release = () => reject(new Error("offline")); void resolve; }); }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); clock.tick(); await settle();
  assert.equal(calls, 1, "in-flight refresh is not duplicated");
  release(); await settle();
  assert.equal(calls, 1, "a completed refresh satisfies the tick that arrived while it ran, instead of running again at once");
  clock.tick(); await settle();
  assert.equal(calls, 2, "the next scheduled tick refreshes normally");
});

test("each delay draws its own jitter above the configured interval so the cadence cannot lock on", () => {
  const steady = fakeTimers(0); new UsageRefreshScheduler(async () => {}, steady.timers).configure(60);
  assert.deepEqual(steady.delays(), [60_000], "no jitter at the low end of the random range");
  const jittered = fakeTimers(0.5, 1, 0.25); const scheduler = new UsageRefreshScheduler(async () => {}, jittered.timers);
  scheduler.configure(60); assert.deepEqual(jittered.delays(), [66_000], "half of the 20% jitter band");
  jittered.tick(); assert.deepEqual(jittered.delays(), [72_000], "the next delay redraws instead of reusing the first draw");
  jittered.tick(); assert.deepEqual(jittered.delays(), [63_000]);
});

test("ticks that land while the host is busy are deferred, not dropped", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle();
  assert.equal(calls, 1, "the refresh on connect still runs");
  clock.advance(60_000); scheduler.setBusy(true);
  clock.tick(); await settle(); assert.equal(calls, 1, "no refresh while sending or running");
  clock.advance(60_000); clock.tick(); await settle(); assert.equal(calls, 1, "further ticks coalesce into the one deferred refresh");
  scheduler.setBusy(false); await settle(); assert.equal(calls, 2, "going idle releases it");
  scheduler.setBusy(false); await settle(); assert.equal(calls, 2, "staying idle does not refresh again");
});

test("a busy host still refreshes once the meters are five intervals stale", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setBusy(true);
  for (let interval = 0; interval < 4; interval += 1) { clock.advance(60_000); clock.tick(); await settle(); }
  assert.equal(calls, 1, "deferred for four intervals of continuous work");
  clock.advance(60_000); clock.tick(); await settle();
  assert.equal(calls, 2, "the staleness ceiling forces the fifth through");
});

test("a host that is busy before it connects still gets its first refresh", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setBusy(true); scheduler.setReady(true); await settle();
  assert.equal(calls, 1, "empty meters are never worth deferring");
});

test("disposal drops a deferred refresh instead of releasing it later", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setBusy(true); clock.advance(60_000); clock.tick(); await settle(); assert.equal(calls, 1);
  scheduler.dispose(); scheduler.setBusy(false); await settle();
  assert.equal(calls, 1, "a disposed scheduler stays silent");
});

test("a refresh due while no meter is displayed waits for one to appear", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setDisplayed(false); scheduler.setReady(true); await settle();
  assert.equal(calls, 0, "connecting with no meter shown refreshes nothing");
  clock.advance(60_000); clock.tick(); await settle(); assert.equal(calls, 0);
  scheduler.setDisplayed(true); await settle();
  assert.equal(calls, 1, "the deferred connect refresh runs as soon as a meter appears, not an interval later");
  scheduler.setDisplayed(true); await settle(); assert.equal(calls, 1);
});

test("the staleness ceiling re-arms, so continuous work still refreshes every five intervals", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setBusy(true);
  for (const expected of [1, 1, 1, 1, 2, 2, 2, 2, 2, 3]) {
    clock.advance(60_000); clock.tick(); await settle();
    assert.equal(calls, expected);
  }
});

test("changing the interval while a refresh is deferred keeps it queued for the new cadence", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setBusy(true); clock.advance(60_000); clock.tick(); await settle(); assert.equal(calls, 1);
  scheduler.configure(30); assert.deepEqual(clock.delays(), [30_000]);
  scheduler.setBusy(false); await settle();
  assert.equal(calls, 2, "the deferred refresh survives the restart");
});

test("going unready with a refresh deferred holds it until the host reconnects", async () => {
  const clock = fakeTimers(); let calls = 0;
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setBusy(true); clock.advance(60_000); clock.tick(); await settle(); assert.equal(calls, 1);
  scheduler.setReady(false); scheduler.setBusy(false); await settle();
  assert.equal(calls, 1, "a disconnected host is never refreshed");
  scheduler.setReady(true); await settle();
  assert.equal(calls, 2, "reconnecting refreshes once, not twice");
});

test("disposing during an in-flight refresh stops the scheduler without a late tick", async () => {
  const clock = fakeTimers(); let calls = 0; let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; await blocked; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.dispose(); release(); await settle();
  assert.equal(clock.active.size, 0, "no timer survives disposal");
  assert.equal(calls, 1);
});

test("a reconnect during a hung refresh is not swallowed by its completion", async () => {
  const clock = fakeTimers(); let calls = 0; let finish!: () => void;
  const hung = new Promise<void>((resolve) => { finish = resolve; });
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; if (calls === 1) await hung; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle();
  assert.equal(calls, 1, "the first refresh is still in flight");
  scheduler.setReady(false); scheduler.setReady(true); await settle();
  assert.equal(calls, 1, "reconnecting cannot start a second refresh while the first is in flight");
  finish(); await settle();
  assert.equal(calls, 2, "the reconnect's own refresh runs as soon as the hung one settles, not an interval later");
  finish(); await settle();
  assert.equal(calls, 2, "and only once");
});

test("a meter reappearing releases a refresh that was held while nothing was displayed", async () => {
  const clock = fakeTimers(); let calls = 0; let finish!: () => void;
  const hung = new Promise<void>((resolve) => { finish = resolve; });
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; if (calls === 1) await hung; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  scheduler.setDisplayed(false);
  clock.advance(60_000); clock.tick(); await settle();
  assert.equal(calls, 1, "the tick is held because no meter needs it");
  scheduler.setDisplayed(true); await settle();
  assert.equal(calls, 1, "and still held while the first refresh has not settled");
  finish(); await settle();
  assert.equal(calls, 2, "the held tick survives the hung refresh's completion once a meter is back");
});

test("a tick during an in-flight refresh is still satisfied by it rather than queued", async () => {
  const clock = fakeTimers(); let calls = 0; let finish!: () => void;
  const hung = new Promise<void>((resolve) => { finish = resolve; });
  const scheduler = new UsageRefreshScheduler(async () => { calls += 1; if (calls === 1) await hung; }, clock.timers);
  scheduler.configure(60); scheduler.setReady(true); await settle(); assert.equal(calls, 1);
  clock.advance(60_000); clock.tick(); await settle(); assert.equal(calls, 1);
  finish(); await settle();
  assert.equal(calls, 1, "only connect and display transitions survive a refresh's completion");
});
