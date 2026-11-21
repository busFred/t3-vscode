import test from "node:test";
import assert from "node:assert/strict";
import { coalescedRun } from "./coalescedRun.js";

test("Catalog syncs run one at a time, and a change during a sync gets exactly one fresh pass after it", async () => {
  const applied: number[] = []; let version = 0, inFlight = 0, maxInFlight = 0;
  const releases: Array<() => void> = [];
  const sync = coalescedRun(async () => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    const seen = version;
    await new Promise<void>((resolve) => releases.push(resolve));
    applied.push(seen); inFlight -= 1;
  });
  const first = sync();
  version = 1; void sync(); version = 2; void sync(); // a removal lands while the first read is in flight
  releases.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  releases.shift()!();
  await first;
  assert.deepEqual(applied, [0, 2], "the newest state is applied last, once");
  assert.equal(maxInFlight, 1);
});

test("A failed sync does not stop later ones", async () => {
  let calls = 0;
  const sync = coalescedRun(async () => { calls += 1; if (calls === 1) throw new Error("secret storage unavailable"); });
  await sync(); await sync();
  assert.equal(calls, 2);
});
