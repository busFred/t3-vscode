import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptItem, WireTurnItem } from "./bridge.js";
import { transcriptRows, responseBoundaries, workElapsed, isWorkItem, foldSettledRounds } from "./transcriptRows.js";
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

test("MCP app results occupy their own timeline row using upstream source validation", () => {
  const app = { attachmentId: "app-html", server: "charts", tool: "plot", resourceUri: "ui://chart" };
  const before = row("before", "reasoning"), after = row("after", "command_execution");
  for (const output of [{ t3McpApp: app }, JSON.stringify({ t3McpApp: app }), { structuredContent: { t3McpApp: app } }, [{ type: "text", text: JSON.stringify({ t3McpApp: app }) }]]) {
    const visual = row("app", "dynamic_tool", { toolName: "charts.plot", output });
    assert.equal(isWorkItem(visual), false);
    assert.deepEqual(transcriptRows([before, visual, after]).map((group) => group.rows.map((item) => item.key)), [["before"], ["app"], ["after"]]);
  }
  for (const [toolName, output] of [["other.plot", { t3McpApp: app }], ["charts.plot", { t3McpApp: { ...app, resourceUri: "https://bad" } }], ["charts.plot", { t3McpApp: { ...app, attachmentId: "" } }], ["charts.plot", {}]] as const) {
    assert.equal(isWorkItem(row("plain", "dynamic_tool", { toolName, output })), true);
  }
});

const shape = (rows: ReturnType<typeof foldSettledRounds>) => rows.map((group) => group.fold ? { fold: group.fold.map((inner) => inner.rows.map((item) => item.key).join("+")) } : group.rows.map((item) => item.key).join("+"));

test("A settled round folds its working steps and keeps the prompt, the steer reply and the answer", () => {
  const items = [row("question", "user_message"), row("thought", "reasoning"), row("command", "command_execution"), row("progress", "assistant_message"), row("viewed", "dynamic_tool", { viewedImagePath: "shot.png" }),
    row("reply", "assistant_message"), row("steer", "user_message", { inputIntent: "steer" }), row("more", "reasoning"), row("note", "assistant_message"), row("tool", "file_change"), row("answer", "assistant_message")];
  assert.deepEqual(shape(foldSettledRounds(transcriptRows(items), null)), [
    "question", { fold: ["thought+command", "progress", "viewed"] }, "reply",
    "steer", { fold: ["more", "note", "tool"] }, "answer",
  ], "The reply to the steer and the final answer must stay visible; the folds keep their nested work groups");
});

test("The live run, an unfinished step, and a lone step are never folded", () => {
  const items = [row("question", "user_message"), row("thought", "reasoning"), row("progress", "assistant_message"), row("answer", "assistant_message")];
  const rows = transcriptRows(items);
  assert.deepEqual(shape(foldSettledRounds(rows, "run")), ["question", "thought", "progress", "answer"]);
  const running = transcriptRows(items.map((item) => item.key === "thought" ? { ...item, item: { ...item.item, status: "running" as const } } : item));
  assert.deepEqual(shape(foldSettledRounds(running, null)), ["question", "thought", "progress", "answer"]);
  assert.deepEqual(shape(foldSettledRounds(transcriptRows([row("q", "user_message"), row("t", "reasoning"), row("a", "assistant_message")]), null)), ["q", "t", "a"]);
  assert.deepEqual(shape(foldSettledRounds(transcriptRows([row("q", "user_message"), row("t", "reasoning"), row("c", "command_execution", { runId: "other" })]), null)), ["q", "t", "c"], "No answer, nothing to fold toward");
});

test("Requests and visuals stay in place and split a fold around them", () => {
  const items = [row("q", "user_message"), row("t1", "reasoning"), row("p1", "assistant_message"), row("approval", "approval_request"), row("t2", "reasoning"), row("p2", "assistant_message"),
    row("html", "dynamic_tool", { toolName: "mcp.html_render" }), row("answer", "assistant_message")];
  assert.deepEqual(shape(foldSettledRounds(transcriptRows(items), null)), ["q", { fold: ["t1", "p1"] }, "approval", { fold: ["t2", "p2"] }, "html", "answer"]);
});
