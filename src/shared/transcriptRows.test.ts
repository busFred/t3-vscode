import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptItem, WireTurnItem } from "./bridge.js";
import { transcriptRows, responseBoundaries, workElapsed, isWorkItem } from "./transcriptRows.js";
const row = (key: string, type: string, extra: Record<string, unknown> = {}): TranscriptItem => ({ key, sourceThreadId: "thread", toolLabel: null, output: null, needsDetail: false,
  item: { id: key, type, runId: "run", status: "completed", text: key, attachments: [], startedAt: "2026-10-07T12:00:00Z", completedAt: "2026-10-07T12:00:32Z", ...extra } as unknown as WireTurnItem });
test("Partial answers and steers always separate activity, with one author boundary per run", () => {
  const items = [row("question", "user_message"), row("thought-before", "reasoning"), row("command-before", "command_execution", { status: "running", completedAt: null }), row("partial-answer", "assistant_message"), row("thought-middle", "reasoning"), row("steer", "user_message", { inputIntent: "steer" }), row("thought-after", "reasoning"), row("command-after", "command_execution"), row("answer", "assistant_message")];
  const before = transcriptRows(items);
  assert.deepEqual(before.map(group => group.rows.map(row => row.key)), [["question"], ["thought-before", "command-before"], ["partial-answer"], ["thought-middle"], ["steer"], ["thought-after", "command-after"], ["answer"]]);
  const after = transcriptRows(items.map(item => item.key === "command-before" ? { ...item, item: { ...item.item, status: "completed" as const } } : item));
  assert.deepEqual(after.map(group => group.key), before.map(group => group.key), "Late command completion must update its original pre-steer group");
  const boundaries = responseBoundaries(items);
  assert.equal(boundaries.size, 1); assert.equal(boundaries.get("thread:run")?.first, "thought-before"); assert.equal(boundaries.get("thread:run")?.answer?.key, "answer");
  assert.equal(workElapsed(before[1]!.rows, Date.parse("2026-10-07T12:01:02Z")), "Working for 1m 2s");
  assert.equal(workElapsed(after[1]!.rows), "Worked for 32s");
});
test("Tool visuals and requests stay visible and different runs cannot share an activity fold", () => {
  for (const item of [row("image", "dynamic_tool", { viewedImagePath: "plot.png" }), row("html", "dynamic_tool", { toolName: "mcp.html_render" }), row("approval", "approval_request"), row("input", "user_input_request"), row("plan", "proposed_plan"), row("progress", "assistant_message")]) assert.equal(isWorkItem(item), false);
  assert.equal(transcriptRows([row("a", "reasoning"), row("b", "reasoning", { runId: "next" })]).length, 2);
});
