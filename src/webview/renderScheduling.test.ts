import test from "node:test";
import assert from "node:assert/strict";
import { retryDelay, throttle } from "./renderScheduling";

test("retry delay doubles from 1.5 seconds, caps at 30 seconds and resets with the failure count", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => retryDelay(index)), [1500, 3000, 6000, 12000, 24000, 30000, 30000, 30000]);
  assert.equal(retryDelay(0), 1500);
});
test("throttle bounds frequent calls, guarantees a trailing call, and cancels pending work", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const calls: number[] = []; const schedule = throttle(() => calls.push(Date.now()), 200);
  schedule(); schedule(); context.mock.timers.tick(100); schedule();
  assert.deepEqual(calls, [1000]); context.mock.timers.tick(100);
  assert.deepEqual(calls, [1000, 1200]);
  schedule(); context.mock.timers.tick(199); assert.equal(calls.length, 2);
  context.mock.timers.tick(1); assert.deepEqual(calls, [1000, 1200, 1400]);
  schedule(); schedule.cancel(); context.mock.timers.tick(300); assert.equal(calls.length, 3);
  schedule(); assert.equal(calls.length, 4);
});
