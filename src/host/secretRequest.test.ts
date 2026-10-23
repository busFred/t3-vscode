import test from "node:test";
import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { OrchestrationV2TurnItem, OrchestrationV2TurnItemJson, SecretRequestAnswerInput, SecretRequestError, ThreadId } from "@t3tools/contracts";
import { v2Now, v2Projection } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";
import { viewsHarness, type FakeTransport } from "./testing/fakeTransport.js";
import { FakeWebview } from "./testing/fakeWebview.js";

const wire = (id: string, secretStatus: string, extra: object = {}) => ({
  id, threadId: "first", runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
  ordinal: 0, status: "completed", title: null, startedAt: v2Now, completedAt: null, updatedAt: v2Now,
  type: "secret_request", label: "GitHub token", reason: "To push the branch", secretStatus, ...extra,
});

test("Vendored contracts decode secret_request turn items and answers", () => {
  const item = Schema.decodeUnknownSync(OrchestrationV2TurnItem)(wire("s1", "pending", { placeholder: "ghp_..." }));
  assert.equal(item.type, "secret_request");
  assert.equal(item.type === "secret_request" && item.secretStatus, "pending");
  for (const status of ["saved", "declined", "cancelled"]) assert.equal(Schema.decodeUnknownSync(OrchestrationV2TurnItem)(wire("s2", status)).type, "secret_request");
  assert.throws(() => Schema.decodeUnknownSync(OrchestrationV2TurnItem)(wire("s3", "unknown")));
  const encoded = Schema.encodeSync(OrchestrationV2TurnItemJson)(item);
  assert.equal(typeof (encoded as { startedAt: unknown }).startedAt, "string");
  const json = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson)(encoded);
  assert.equal(json.type, "secret_request");
  assert.deepEqual(Schema.decodeUnknownSync(SecretRequestAnswerInput)({ threadId: "first", turnItemId: "s1", answer: { type: "save", secret: "  abc " } }).answer, { type: "save", secret: "abc" });
  assert.throws(() => Schema.decodeUnknownSync(SecretRequestAnswerInput)({ threadId: "first", turnItemId: "s1", answer: { type: "save", secret: " " } }));
  assert.equal(new SecretRequestError({ reason: "already_answered" }).message, "This secret request was already answered.");
});

function publish(client: FakeTransport, rows: Array<[string, string, "local" | "inherited"]>) {
  const items = rows.map(([id, status]) => Schema.decodeUnknownSync(OrchestrationV2TurnItem)(wire(id, status)));
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make("first") }, turnItems: items,
    visibleTurnItems: items.map((item, position) => ({ item, position, sourceItemId: item.id, sourceThreadId: item.threadId, visibility: rows[position]![2] })) } });
}

test("Only pending, locally owned secret requests are surfaced, without any secret value", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  assert.deepEqual(host.snapshot().pending.secrets, []);
  await host.selectThread("first");
  publish(client, [["pending-local", "pending", "local"], ["pending-inherited", "pending", "inherited"], ["saved", "saved", "local"], ["declined", "declined", "local"], ["cancelled", "cancelled", "local"]]);
  const secrets = host.snapshot().pending.secrets;
  assert.deepEqual(secrets, [{ turnItemId: "pending-local", label: "GitHub token", reason: "To push the branch", createdAt: DateTime.formatIso(v2Now) }]);
});

test("answerSecretRequest bridge validates, routes to the transport and keeps the secret out of errors and state", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const registry = new WebviewRegistry(), bridge = new BridgeHandler(host, registry), view = new FakeWebview();
  registry.add(SIDEBAR_VIEW_ID, view.webview); bridge.attach(view.webview, SIDEBAR_VIEW_ID);
  await host.selectThread("first");
  await view.request("answerSecretRequest", { threadId: "first", turnItemId: "s1", answer: { type: "save", secret: "  hunter2  " } });
  await view.request("answerSecretRequest", { threadId: "first", turnItemId: "s1", answer: { type: "decline" } });
  assert.deepEqual(client.secretAnswers, [
    { threadId: "first", turnItemId: "s1", answer: { type: "save", secret: "hunter2" } },
    { threadId: "first", turnItemId: "s1", answer: { type: "decline" } },
  ]);
  await assert.rejects(view.request("answerSecretRequest", { threadId: "first", turnItemId: "s1", answer: { type: "save", secret: "   " } }), /Enter the secret/);
  await assert.rejects(view.request("answerSecretRequest", { threadId: "first", turnItemId: "s1", answer: { type: "nope", secret: "hunter2" } }), (error: Error) => !error.message.includes("hunter2") && /Invalid/.test(error.message));
  await assert.rejects(view.request("answerSecretRequest", { threadId: "unknown", turnItemId: "s1", answer: { type: "decline" } }));
  client.secretAnswerError = new Error("This secret request was already answered.");
  await assert.rejects(view.request("answerSecretRequest", { threadId: "first", turnItemId: "s1", answer: { type: "save", secret: "hunter2" } }), /already answered/);
  assert.equal(JSON.stringify(host.snapshot()).includes("hunter2"), false);
});
