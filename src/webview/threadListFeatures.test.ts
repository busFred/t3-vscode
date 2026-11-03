import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationActivity } from "./components/ConversationActivity";
import type { HostStateSnapshot } from "../shared/bridge";

const state = { activeThreadId: "thread", queue: { entries: [{ runId: "queued", text: "Follow up", attachmentNames: [] }], canSendNow: true, canSteer: false, canReorder: false, held: true, activeRunId: null }, tasks: null } as unknown as HostStateSnapshot;
test("Queue rows offer Send now for idle or steerable turns, retaining edit/cancel/reorder controls", () => {
  for (const queue of [state.queue!, { ...state.queue!, canSendNow: false, canSteer: true }]) {
    const html = renderToStaticMarkup(createElement(ConversationActivity, { state: { ...state, queue } }));
    assert.match(html, /Send now/); assert.match(html, /Edit queued message/); assert.match(html, /Cancel queued message/); assert.match(html, /Reorder queued message/);
  }
  const html = renderToStaticMarkup(createElement(ConversationActivity, { state: { ...state, queue: { ...state.queue!, canSendNow: false, canSteer: false } } }));
  assert.doesNotMatch(html, /Send now/);
});

test("Tag filtering matches any selected tag and inherits parent visibility", async () => {
  const { filterThreadListTags } = await import("../shared/threadListTags");
  const threads = [
    { id: "work", tags: ["work"] },
    { id: "child", parentThreadId: "work", relationshipToParent: "subagent", tags: ["other"] },
    { id: "review", tags: ["review"] },
    { id: "other", tags: ["other"] },
  ] as unknown as HostStateSnapshot["threads"];
  assert.deepEqual(filterThreadListTags(threads, ["work", "review"]).map(thread => thread.id), ["work", "child", "review"]);
  assert.equal(filterThreadListTags(threads, []).length, 4);
});
