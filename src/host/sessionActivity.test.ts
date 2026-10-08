import test from "node:test";
import assert from "node:assert/strict";
import * as DateTime from "effect/DateTime";
import { v2ThreadShell } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { sessionActivityAt } from "./sessionActivity.js";

test("Session age follows messages and run completion, not visits or metadata", () => {
  const early = DateTime.makeUnsafe("2026-06-20T00:00:00Z");
  const latest = DateTime.makeUnsafe("2026-06-20T08:00:00Z");
  const later = DateTime.makeUnsafe("2026-06-21T00:00:00Z");
  const thread = { ...v2ThreadShell, itemCount: 3, latestVisibleMessage: null, latestUserMessageAt: early,
    latestRunRequestedAt: early, latestRunStartedAt: early, latestRunCompletedAt: latest, activityRunStartedAt: null,
    updatedAt: later, lastVisitedAt: later, pinnedAt: later, settledAt: later };
  assert.equal(sessionActivityAt(thread), DateTime.formatIso(latest));
  assert.equal(sessionActivityAt({ ...thread, title: "Renamed", updatedAt: DateTime.nowUnsafe() }), DateTime.formatIso(latest));
  assert.equal(sessionActivityAt({ ...thread, latestUserMessageAt: later }), DateTime.formatIso(later));
});
test("Empty sessions use creation; unknown historical activity stays unknown", () => {
  const thread = { ...v2ThreadShell, latestUserMessageAt: null, latestVisibleMessage: null,
    latestRunRequestedAt: null, latestRunStartedAt: null, latestRunCompletedAt: null, activityRunStartedAt: null, pendingRuntimeRequest: null };
  assert.equal(sessionActivityAt({ ...thread, itemCount: 0 }), DateTime.formatIso(thread.createdAt));
  assert.equal(sessionActivityAt({ ...thread, itemCount: 10 }), null);
});
