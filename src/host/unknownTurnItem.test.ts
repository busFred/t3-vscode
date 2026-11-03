import test from "node:test";
import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { OrchestrationV2ThreadStreamItem, OrchestrationV2TurnItem } from "@t3tools/contracts";

// T3 0.1.5+ skips turn items of unknown types (snapshots and history drop them; live events
// become `unknown-event` so the cursor still advances). The extension adopts that behavior.
const NOW = "2026-06-20T00:00:00.000Z";
const base = (id: string, extra: object = {}) => ({
  id, threadId: "first", runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
  ordinal: 7, status: "completed", title: null, startedAt: NOW, completedAt: null, updatedAt: NOW, ...extra,
});
const decodeStream = Schema.decodeUnknownSync(OrchestrationV2ThreadStreamItem as unknown as Schema.Codec<{ kind: string; sequence?: number; eventType?: string }, unknown>);
const event = (item: object) => ({ kind: "event", sequence: 12, event: { id: "event-1", threadId: "first", occurredAt: NOW, type: "turn-item.updated", payload: item } });

test("A live update for an unknown item type becomes an unknown event that advances the cursor", () => {
  const decoded = decodeStream(event(base("u1", { type: "brand_new_thing", payload: { a: 1 } })));
  assert.equal(decoded.kind, "unknown-event");
  assert.equal(decoded.sequence, 12);
  assert.equal(decoded.eventType, "turn-item.updated");
});

test("Unknown event types are skipped the same way", () => {
  const decoded = decodeStream({ kind: "event", sequence: 13, event: { id: "event-2", threadId: "first", occurredAt: NOW, type: "thread.brand-new", payload: {} } });
  assert.equal(decoded.kind, "unknown-event");
  assert.equal(decoded.sequence, 13);
});

test("A malformed item of a known type still fails instead of being skipped", () => {
  assert.throws(() => decodeStream(event(base("k1", { type: "assistant_message", text: "no messageId or streaming" }))));
  assert.throws(() => Schema.decodeUnknownSync(OrchestrationV2TurnItem)({ ...base("k2"), startedAt: DateTime.makeUnsafe(NOW), updatedAt: DateTime.makeUnsafe(NOW), type: "brand_new_thing" }));
});

test("Known items decode unchanged, including link and secret requests", () => {
  const decoded = decodeStream(event(base("m1", { type: "assistant_message", messageId: "msg", text: "hi", streaming: false })));
  assert.equal(decoded.kind, "event");
});
