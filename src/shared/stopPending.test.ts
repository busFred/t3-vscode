import assert from "node:assert/strict";
import test from "node:test";
import { idleStop, isStopDisabled, reconcileStop, STOP_PENDING_MAX_MS, stopClicked, stopKey, stopLabel, stopTimedOut } from "./stopPending.js";

const key = stopKey("thread-1", "run-1");

test("A click disables Stop and names it Stopping", () => {
  const clicked = stopClicked(key);
  assert.equal(isStopDisabled(clicked), true);
  assert.equal(stopLabel(clicked), "Stopping");
  assert.equal(stopLabel(idleStop(key)), "Stop generation");
  assert.equal(reconcileStop(clicked, key, true), clicked, "a pending stop is kept while the run still runs");
});

test("Stop re-enables after the limit if the run never stops", () => {
  assert.equal(STOP_PENDING_MAX_MS, 10_000);
  const timedOut = stopTimedOut(stopClicked(key), key);
  assert.equal(timedOut.phase, "timedOut");
  assert.equal(isStopDisabled(timedOut), false);
  assert.equal(stopLabel(timedOut), "Stop generation");
  assert.equal(reconcileStop(timedOut, key, true), timedOut, "a timed-out stop stays enabled while the run still runs");
});

test("A late timer cannot disturb another run or a settled state", () => {
  const next = stopKey("thread-1", "run-2");
  const idle = idleStop(next);
  assert.equal(stopTimedOut(idle, key), idle);
  assert.equal(stopTimedOut(idle, next), idle);
  const timedOut = stopTimedOut(stopClicked(key), key);
  assert.equal(stopTimedOut(timedOut, key), timedOut);
});

test("The state is per thread and per run", () => {
  assert.equal(reconcileStop(stopClicked(key), stopKey("thread-1", "run-2"), true).phase, null, "a new run starts enabled");
  assert.equal(reconcileStop(stopClicked(key), stopKey("thread-2", "run-1"), true).phase, null, "another thread starts enabled");
  assert.notEqual(stopKey("thread-1", null), stopKey("thread-1", "run-1"));
});

test("Once the run stops the click is acknowledged and Stop does not stay disabled", () => {
  const stopped = reconcileStop(stopClicked(key), key, false);
  assert.equal(stopped.phase, null);
  assert.equal(isStopDisabled(reconcileStop(stopped, key, true)), false, "a button that returns for the same run is enabled");
  assert.equal(reconcileStop(stopTimedOut(stopClicked(key), key), key, false).phase, null);
  const idle = idleStop(key);
  assert.equal(reconcileStop(idle, key, false), idle, "nothing to reset keeps the same object");
});
