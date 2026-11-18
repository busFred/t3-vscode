import assert from "node:assert/strict";
import test from "node:test";
import { turnAnnouncement, type AnnouncementState } from "./turnAnnouncements.js";

const state = (over: Partial<AnnouncementState> = {}): AnnouncementState => ({ running: false, items: [], ...over });

test("An idle conversation with nothing to say stays silent", () => {
  assert.equal(turnAnnouncement(state()), null);
});

test("Anything waiting on the person outranks the work in flight", () => {
  const running = { running: true, items: [{ type: "command_execution", label: "pnpm test", status: "running" }] };
  assert.equal(turnAnnouncement(state({ ...running, pendingQuestions: 1 })), "A question is waiting");
  assert.equal(turnAnnouncement(state({ ...running, pendingApprovals: 1, pendingQuestions: 1 })), "Approval needed");
  assert.equal(turnAnnouncement(state({ ...running, pendingApprovals: 1, pendingSecrets: 1 })), "A secret is requested");
});

test("Several waiting requests are counted", () => {
  assert.equal(turnAnnouncement(state({ pendingApprovals: 3 })), "3 approvals needed");
  assert.equal(turnAnnouncement(state({ pendingQuestions: 2 })), "2 questions are waiting");
});

test("A streaming reply is not narrated chunk by chunk", () => {
  const streaming = state({ running: true, items: [{ type: "assistant_message", streaming: true }] });
  assert.equal(turnAnnouncement(streaming), "Replying");
  const settled = state({ items: [{ type: "assistant_message", streaming: false }] });
  assert.equal(turnAnnouncement(settled), "Assistant replied");
});

test("Work in flight is announced by its own label", () => {
  assert.equal(turnAnnouncement(state({ running: true, items: [{ type: "command_execution", label: "pnpm run build", status: "running" }] })), "pnpm run build");
});

test("Unlabelled work still says what kind it is", () => {
  for (const [type, expected] of [["command_execution", "Running a command"], ["file_change", "Editing files"], ["file_search", "Searching files"], ["web_search", "Searching the web"], ["reasoning", "Thinking"], ["subagent", "Delegating to a subagent"], ["dynamic_tool", "Working"]] as const) {
    assert.equal(turnAnnouncement(state({ running: true, items: [{ type, status: "running" }] })), expected, type);
  }
});

test("A failure and an interruption are both announced", () => {
  assert.equal(turnAnnouncement(state({ items: [{ type: "error" }] })), "The turn failed");
  assert.equal(turnAnnouncement(state({ items: [{ type: "run_interrupt" }] })), "The turn was interrupted");
});

test("A completed work row on an idle conversation says nothing new", () => {
  assert.equal(turnAnnouncement(state({ running: false, items: [{ type: "command_execution", label: "pnpm test", status: "completed" }] })), null);
});

test("A running conversation with no items yet reports that it is working", () => {
  assert.equal(turnAnnouncement(state({ running: true })), "Working");
});

test("Only the newest item is announced", () => {
  const items = [{ type: "command_execution", label: "old", status: "completed" }, { type: "assistant_message", streaming: false }];
  assert.equal(turnAnnouncement(state({ items })), "Assistant replied");
});

test("A run that only waits on subagents says so instead of delegating or working", () => {
  const delegating = { running: true, items: [{ type: "subagent", status: "running" }] };
  assert.equal(turnAnnouncement(state(delegating)), "Delegating to a subagent");
  assert.equal(turnAnnouncement(state({ ...delegating, waitingOnSubagents: 1 })), "Waiting on a subagent");
  assert.equal(turnAnnouncement(state({ ...delegating, waitingOnSubagents: 2 })), "Waiting on 2 subagents");
  assert.equal(turnAnnouncement(state({ ...delegating, waitingOnSubagents: 2, pendingQuestions: 1 })), "A question is waiting", "a request for the person still wins");
  assert.equal(turnAnnouncement(state({ items: delegating.items, waitingOnSubagents: 1 })), "Delegating to a subagent", "a stopped run is not waiting");
});
