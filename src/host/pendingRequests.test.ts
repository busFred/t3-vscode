import test from "node:test";
import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import { OrchestrationV2TurnItem, OrchestrationV2RuntimeRequest, PeerLinkRequestAnswerInput, ThreadId } from "@t3tools/contracts";
import { seedUserInputDraftAnswers } from "@t3tools/client-runtime/state/thread-requests";
import { resolvePendingUserInputAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { linkRequestAnswerInput, linkRequestDisplay } from "@t3tools/client-runtime/link-request";
import { v2Now, v2Projection } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { viewsHarness, type FakeTransport } from "./testing/fakeTransport.js";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";
import { FakeWebview } from "./testing/fakeWebview.js";

const base = { threadId: "first", runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
  ordinal: 0, status: "pending", title: null, startedAt: v2Now, completedAt: null, updatedAt: v2Now };
const item = (fields: object) => Schema.decodeUnknownSync(OrchestrationV2TurnItem)({ ...base, ...fields });
const request = (fields: object = {}) => Schema.decodeUnknownSync(OrchestrationV2RuntimeRequest)({ id: "approval", nodeId: "node", providerTurnId: null, nativeRequestRef: null,
  kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: "session", supportsFeedback: true }, createdAt: v2Now, resolvedAt: null, ...fields });
function publish(client: FakeTransport, items: OrchestrationV2TurnItem[], requests: OrchestrationV2RuntimeRequest[] = [], visibility: "local" | "inherited" | "synthetic" = "local") {
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make("first") }, turnItems: items, runtimeRequests: requests,
    visibleTurnItems: items.map((item, position) => ({ item, position, sourceItemId: item.id, sourceThreadId: item.threadId, visibility })) } });
}

test("Host derivation retains approval metadata, question previews/defaults and secret delivery", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  const question = { id: "q", header: "Edit", question: "Use this text?", options: [{ label: "Yes", description: "Use it", preview: "Preview content" }], initialAnswer: "  draft\ntext  " };
  publish(client, [item({ id: "a", type: "approval_request", requestId: "approval", requestKind: "command", prompt: "rm file", reason: "Remove generated output", fullAccessOverride: "ask_rule" }),
    item({ id: "q", type: "user_input_request", requestId: "questions", questions: [question] }),
    item({ id: "s", type: "secret_request", label: "Token", reason: "Authenticate", delivery: "file", secretStatus: "pending" })], [request(), request({ id: "questions", kind: "user_input" })]);
  const pending = host.snapshot().pending;
  assert.equal(pending.approvals[0]?.reason, "Remove generated output"); assert.equal(pending.approvals[0]?.fullAccessOverride, "ask_rule"); assert.equal(pending.approvals[0]?.supportsFeedback, true);
  const q = pending.userInputs[0]!.questions[0]!;
  assert.equal(q.options[0]?.preview, "Preview content");
  assert.equal(resolvePendingUserInputAnswer(q, seedUserInputDraftAnswers([q], {})[q.id]), question.initialAnswer);
  assert.deepEqual(seedUserInputDraftAnswers([{ ...q, allowCustomAnswer: false }], {}), {});
  assert.equal(pending.secrets[0]?.delivery, "file");
});

test("Decline feedback crosses the bridge only for a live approval advertising support", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  const registry = new WebviewRegistry(), bridge = new BridgeHandler(host, registry), view = new FakeWebview(); registry.add(SIDEBAR_VIEW_ID, view.webview); bridge.attach(view.webview, SIDEBAR_VIEW_ID);
  for (const [decision, supportsFeedback, feedback, expected] of [["decline", true, "  try another way  ", "try another way"], ["accept", true, "why", undefined], ["decline", false, "why", undefined], ["decline", true, "  ", undefined]] as const) {
    publish(client, [], [request({ responseCapability: { type: "live", providerSessionId: "session", supportsFeedback } })]);
    await view.request("respondToRequest", { threadId: "first", requestId: "approval", decision, feedback });
    const command = client.commands.at(-1)!; assert.equal(command.type, "runtime-request.respond");
    assert.equal(command.type === "runtime-request.respond" ? command.feedback : null, expected);
  }
  await assert.rejects(view.request("respondToRequest", { threadId: "first", requestId: "approval", decision: "decline", feedback: 1 }), /feedback/);
});

test("Link answers use the dedicated RPC, preserve payloads and reject non-local/resolved cards", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  const card = item({ id: "link", type: "link_request", reason: "Work on build machine", url: "https://build.example", linkStatus: "pending" });
  assert.equal(card.type, "link_request"); if (card.type !== "link_request") return;
  const registry = new WebviewRegistry(), bridge = new BridgeHandler(host, registry), view = new FakeWebview(); registry.add(SIDEBAR_VIEW_ID, view.webview); bridge.attach(view.webview, SIDEBAR_VIEW_ID);
  for (const answer of [{ type: "decline" }, { type: "use-existing", environmentId: "build" }, { type: "link", urls: ["https://build.example"], access: "approval-required", pairingCode: "private-code" }]) {
    publish(client, [card]);
    const input = Schema.decodeUnknownSync(PeerLinkRequestAnswerInput)({ threadId: "first", turnItemId: "link", answer });
    await view.request("answerLinkRequest", input); assert.deepEqual(client.linkAnswers.at(-1), input);
    assert.equal(JSON.stringify(host.snapshot()).includes("private-code"), false);
  }
  assert.equal(client.linkAnswers.length, 3);
  assert.equal(client.commands.length, 0);
  for (const visibility of ["inherited", "synthetic"] as const) {
    publish(client, [card], [], visibility); assert.equal(host.snapshot().transcript[0]?.visibility, visibility);
    await assert.rejects(view.request("answerLinkRequest", { threadId: "first", turnItemId: "link", answer: { type: "decline" } }), /pending here/);
    assert.equal(linkRequestDisplay(card, visibility, String).kind, "pending-elsewhere");
  }
  for (const status of ["linked", "declined", "failed", "cancelled"] as const) {
    const resolved: Extract<OrchestrationV2TurnItem, { type: "link_request" }> = { ...card, linkStatus: status }; publish(client, [resolved]);
    assert.equal(linkRequestDisplay(resolved, "local", String).kind, "answered");
    await assert.rejects(view.request("answerLinkRequest", { threadId: "first", turnItemId: "link", answer: { type: "decline" } }), /pending here/);
  }
  await assert.rejects(view.request("answerLinkRequest", { threadId: "first", turnItemId: "link", answer: { type: "link", pairingCode: "private-code" } }), error => error instanceof Error && !error.message.includes("private-code"));
  assert.equal(linkRequestAnswerInput(card, { type: "link", target: { url: card.url! }, access: "full-access", pairingCode: " " }), null);
});
