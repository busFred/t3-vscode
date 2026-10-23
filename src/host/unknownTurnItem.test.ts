import test from "node:test";
import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { OrchestrationV2ProjectedTurnItem, OrchestrationV2TurnItem, OrchestrationV2TurnItemJson } from "@t3tools/contracts";

const NOW = "2026-06-20T00:00:00.000Z";
const DATE = DateTime.makeUnsafe(NOW);
/** `OrchestrationV2TurnItem` takes DateTime values; the Json twin takes ISO strings. */
const base = (id: string, extra: object = {}, at: unknown = DATE) => ({
  id, threadId: "first", runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
  ordinal: 7, status: "completed", title: null, startedAt: at, completedAt: null, updatedAt: at, ...extra,
});
const codecs = [["OrchestrationV2TurnItem", OrchestrationV2TurnItem, DATE], ["OrchestrationV2TurnItemJson", OrchestrationV2TurnItemJson, NOW]] as const;

for (const [name, codec, at] of codecs) {
  const wire = (id: string, extra: object = {}) => base(id, extra, at);
  test(`${name} turns an unknown item type into a system_notice placeholder`, () => {
    const decode = Schema.decodeUnknownSync(codec as Schema.Codec<{ type: string; id: string; ordinal: number; message?: string }, unknown>);
    const item = decode(wire("u1", { type: "brand_new_thing", payload: { a: 1 } }));
    assert.equal(item.type, "system_notice");
    assert.equal(item.message, "Unsupported item (type brand_new_thing)");
    assert.equal(item.id, "u1");
    assert.equal(item.ordinal, 7);
    assert.equal(decode(wire("u2")).message, "Unsupported item (type unknown)");
    assert.equal(decode(wire("u3", { type: 5 })).message, "Unsupported item (type unknown)");
  });

  test(`${name} still rejects malformed items`, () => {
    const decode = Schema.decodeUnknownSync(codec as Schema.Codec<unknown, unknown>);
    assert.throws(() => decode(wire("k1", { type: "assistant_message", text: "no messageId or streaming" })));
    assert.throws(() => decode(wire("k2", { type: "secret_request", label: "x", reason: "y", secretStatus: "bogus" })));
    assert.throws(() => decode({ type: "brand_new_thing", id: "k3" }), /./);
    assert.throws(() => Schema.encodeSync(codec as Schema.Codec<unknown, unknown>)({ ...wire("k4"), type: "brand_new_thing" }));
  });

  test(`${name} decodes known types unchanged`, () => {
    const decode = Schema.decodeUnknownSync(codec as Schema.Codec<{ type: string; text?: string; secretStatus?: string }, unknown>);
    const message = decode(wire("m1", { type: "assistant_message", messageId: "msg", text: "hi", streaming: false }));
    assert.equal(message.type, "assistant_message");
    assert.equal(message.text, "hi");
    const secret = decode(wire("m2", { type: "secret_request", label: "Token", reason: "push", secretStatus: "pending" }));
    assert.equal(secret.type, "secret_request");
    assert.equal(secret.secretStatus, "pending");
    assert.equal(decode(wire("m3", { type: "system_notice", message: "real" })).text, undefined);
  });
}

test("A projected turn item carrying an unknown item decodes with its placeholder", () => {
  const projected = Schema.decodeUnknownSync(OrchestrationV2ProjectedTurnItem)({
    position: 3, visibility: "local", sourceThreadId: "first", sourceItemId: "u1", item: base("u1", { type: "brand_new_thing" }),
  });
  assert.equal(projected.item.type, "system_notice");
  assert.equal(projected.item.type === "system_notice" && projected.item.message, "Unsupported item (type brand_new_thing)");
  assert.equal(projected.item.ordinal, 7);
});
