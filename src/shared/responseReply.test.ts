import assert from "node:assert/strict";
import test from "node:test";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import type { TranscriptItem } from "./bridge.js";
import { buildComposerClipboard, parseComposerClipboardHtml, planComposerPaste } from "./composerClipboard.js";
import { contextIsReferenced, formatComposerMessage, insertResponseReply, messageContextWithReplies, removeContextReference, responseContextRecord, responseRecordsForMessage, type ComposerContext } from "./composerContext.js";
import { responseSubagents } from "./responseSubagents.js";
import { parseDraftTransfer } from "./viewDraft.js";

const record = (messageId = "message-1", text = "Reviewer finished and returned blocked on one finding.") =>
  responseContextRecord({ citation: { environmentId: "env-1", threadId: "thread-1", messageId, text, start: 0, end: text.length, prefix: "", suffix: " More" }, itemId: `item-${messageId}`, subagents: [] });
const NONCE = "session-nonce";
const counter = () => { let n = 0; return () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`; };

test("A reply record matches T3's: id scoped to the message, label from the opening, subagents bounded", () => {
  const reply = record();
  assert.equal(reply.kind, "response"); assert.equal(reply.contextId, "response_message-1"); assert.equal(reply.itemId, "item-message-1");
  assert.equal(reply.label, "Reviewer finished and returned blocked on one finding.");
  assert.equal(reply.subagents, undefined);
  const many = responseContextRecord({ citation: reply.citation, itemId: "item", subagents: Array.from({ length: 25 }, (_, index) => ({ threadId: `child-${index}`, title: `[sub]\nagent ${index}` })) });
  assert.equal(many.subagents?.length, 20); assert.equal(many.subagents?.[0]?.title, "sub agent 0");
  // Over the contract's opening limit: refused here rather than at send.
  assert.throws(() => record("m", "x".repeat(9_000)));
});

test("Replying leads the draft with one reference token; replying again replaces, the same response changes nothing", () => {
  const first = record("m1", "First answer"), second = record("m2", "Second answer");
  const empty = insertResponseReply("", [], first);
  assert.equal(empty.text, "[First answer](t3-context://v1/response/response_m1) ");
  assert.equal(empty.cursor, empty.text.length);
  const typed = insertResponseReply("please also check", [], first);
  assert.equal(typed.text, "[First answer](t3-context://v1/response/response_m1) please also check");
  const again = insertResponseReply(typed.text, typed.contexts, first);
  assert.equal(again.text, typed.text); assert.equal(again.contexts.length, 1);
  const replaced = insertResponseReply(typed.text, typed.contexts, second);
  assert.equal(replaced.text, "[Second answer](t3-context://v1/response/response_m2) please also check");
  assert.deepEqual(replaced.contexts.map((context) => context.type === "response" ? context.record.contextId : context.type), ["response_m2"]);
  // A reply the user moved into the text is taken out with its space, and the new one leads.
  const moved = insertResponseReply("see [First answer](t3-context://v1/response/response_m1) here", typed.contexts, second);
  assert.equal(moved.text, "[Second answer](t3-context://v1/response/response_m2) see here");
  // Other contexts stay.
  const quote: ComposerContext = { type: "file", uri: "file:///a.ts", path: "a.ts", label: "a.ts", inlineText: "@a.ts" };
  assert.equal(insertResponseReply("@a.ts", [quote], first).contexts.length, 2);
});

test("A reply sends its token unchanged with its record; removing the chip removes both", () => {
  const reply = record("m1", "First answer");
  const { text, contexts } = insertResponseReply("go on", [], reply);
  const sent = formatComposerMessage(text, contexts);
  assert.equal(sent, "[First answer](t3-context://v1/response/response_m1) go on");
  assert.deepEqual(responseRecordsForMessage(sent, contexts), [reply]);
  assert.equal(contextIsReferenced(text, contexts[0]!), true);
  assert.equal(removeContextReference(text, contexts[0]!), "go on");
  assert.deepEqual(responseRecordsForMessage("go on", contexts), []);
  const image = { version: 1 as const, kind: "image" as const, contextId: "image_a", label: "a.png", attachmentId: "att", name: "a.png", mimeType: "image/png", sizeBytes: 3 };
  const merged = messageContextWithReplies({ version: 1, records: [image] as never }, sent, [reply, reply]);
  assert.deepEqual(merged?.records.map((entry) => entry.contextId), ["image_a", "response_m1"]);
  assert.equal(messageContextWithReplies(undefined, "go on", [reply]), undefined);
  assert.deepEqual(messageContextWithReplies(undefined, sent, [reply])?.records, [reply]);
});

test("A reply survives draft recovery, and an invalid one is refused", () => {
  const reply = record();
  const parsed = parseDraftTransfer({ draftKey: "t", draft: { text: "x", contexts: [{ type: "response", record: reply }] } }, "t")!;
  assert.deepEqual(parsed.draft.contexts, [{ type: "response", record: reply }]);
  assert.throws(() => parseDraftTransfer({ draftKey: "t", draft: { text: "x", contexts: [{ type: "response", record: { ...reply, itemId: 7 } }] } }, "t"));
  assert.throws(() => parseDraftTransfer({ draftKey: "t", draft: { text: "x", contexts: [{ type: "response" }] } }, "t"));
});

test("A copied reply pastes back with its record only when the payload carries the session nonce", () => {
  const reply = record("m1", "First answer");
  const draft = insertResponseReply("tell it more", [], reply);
  const clip = buildComposerClipboard({ text: draft.text, contexts: draft.contexts }, { start: 0, end: draft.text.length }, NONCE)!;
  assert.equal(clip.plain, "First answer tell it more");
  const trusted = parseComposerClipboardHtml(clip.html, NONCE)!;
  const pasted = planComposerPaste(trusted, { text: "", contexts: [] }, { start: 0, end: 0 }, counter());
  assert.equal(pasted.text, draft.text);
  assert.deepEqual(pasted.contexts, [{ type: "response", record: reply }]);
  // Pasting into a draft that already replies to it keeps one record.
  assert.equal(planComposerPaste(trusted, draft, { start: draft.text.length, end: draft.text.length }, counter()).contexts.length, 1);
  // Without the nonce (any web page can write this HTML) the reply is only its label.
  for (const untrusted of [parseComposerClipboardHtml(clip.html)!, parseComposerClipboardHtml(clip.html, "other")!]) {
    const plan = planComposerPaste(untrusted, { text: "", contexts: [] }, { start: 0, end: 0 }, counter());
    assert.equal(plan.text, "First answer tell it more");
    assert.deepEqual(plan.contexts, []);
    assert.equal(collectComposerContextReferences(plan.text).length, 0);
  }
});

const row = (key: string, item: Record<string, unknown>): TranscriptItem => ({ key, sourceThreadId: "thread-1", item: item as never, toolLabel: null, output: null, needsDetail: false });
test("A reply names the subagents whose results came in just before the response", () => {
  const rows = [
    row("u0", { type: "user_message", senderThreadId: "child-old" }),
    row("s1", { type: "subagent", subagentId: "task-1", childThreadId: "child-1" }),
    row("s2", { type: "subagent", subagentId: "task-2", childThreadId: null, remoteChild: { environmentId: "env-2", threadId: "remote-1", label: "vps", title: "Remote review" } }),
    row("s3", { type: "subagent", subagentId: "task-3", childThreadId: "child-3" }),
    row("a0", { type: "assistant_message" }),
    row("n1", { type: "notification", source: { kind: "delegated_task", taskIds: ["task-2"], childThreadId: "child-1" } }),
    row("u1", { type: "user_message", senderThreadId: "child-3" }),
    row("r1", { type: "reasoning" }),
    row("a1", { type: "assistant_message" }),
  ];
  const titles = (id: string) => ({ "child-1": "Search review", "child-3": " " } as Record<string, string>)[id];
  assert.deepEqual(responseSubagents(rows, "a1", titles), [
    { threadId: "child-3", title: "Agent" },
    { threadId: "child-1", title: "Search review" },
    { threadId: "remote-1", environmentId: "env-2", title: "Remote review" },
  ]);
  // A plain user message before the response: no subagents. An unknown row: none.
  assert.deepEqual(responseSubagents([row("u", { type: "user_message" }), row("a", { type: "assistant_message" })], "a", titles), []);
  assert.deepEqual(responseSubagents(rows, "missing", titles), []);
});

test("A reply label never ends inside an emoji (a surrogate pair at the 64-character limit)", () => {
  const text = `${"a".repeat(63)}😀 and more`;
  const label = record("m-emoji", text).label;
  assert.equal(label, "a".repeat(63));
  assert.ok(!/[\uD800-\uDBFF]$/.test(label));
});
