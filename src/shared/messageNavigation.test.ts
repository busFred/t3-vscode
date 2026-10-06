import test from "node:test";
import assert from "node:assert/strict";
import type { TranscriptItem, WireTurnItem } from "./bridge.js";
import { messageExchanges, exchangeAtRow, exchangeAtPointer, resolveMessageNavigation } from "./messageNavigation.js";
import { transcriptRows, workSummary } from "./transcriptRows.js";
const row = (key: string, type: string, text = key): TranscriptItem => ({ key, sourceThreadId: "thread", toolLabel: null, output: null, needsDetail: false,
  item: { id: key, type, status: "completed", text, attachments: [] } as unknown as WireTurnItem });

test("Message navigation pairs prompts with their last response, skipping activity and retaining source whitespace", () => {
  const rows = [row("orphan", "assistant_message"), row("first", "user_message", "  First\n prompt  "), row("commentary", "assistant_message"), row("command", "command_execution"), row("final", "assistant_message", "Final\nanswer"), row("second", "user_message"), row("streaming", "assistant_message", "Partial")];
  const stops = messageExchanges(rows);
  assert.deepEqual(stops, [{ key: "first", rowIndex: 1, prompt: "  First\n prompt  ", response: "Final\nanswer" }, { key: "second", rowIndex: 5, prompt: "second", response: "Partial" }]);
  assert.equal(exchangeAtRow(stops, 3), 0); assert.equal(exchangeAtRow(stops, 6), 1);
  const older = [row("older", "user_message"), row("older-response", "assistant_message")];
  assert.equal(messageExchanges([...older, ...rows]).find((entry) => entry.key === "second")!.rowIndex, 7);
  assert.equal(stops[0]!.key, "first", "Pagination cannot replace a preview's stable identity");
  assert.equal(exchangeAtPointer(100, 20, 400, -20), 0); assert.equal(exchangeAtPointer(100, 20, 400, 900), 99);
  assert.equal(exchangeAtPointer(100, 20, 400, 220), 50); assert.equal(resolveMessageNavigation("unknown"), "left");
});

test("Activity groups preserve message/checkpoint boundaries and keep thought and command sequences collapsed as one row", () => {
  const rows = [row("prompt", "user_message"), row("thought", "reasoning"), row("cmd1", "command_execution"), row("cmd2", "command_execution"), row("answer", "assistant_message"), row("changes", "checkpoint"), row("cmd3", "command_execution")];
  const display = transcriptRows(rows);
  assert.deepEqual(display.map((entry) => [entry.key, entry.firstIndex, entry.rows.length]), [["prompt", 0, 1], ["thought", 1, 3], ["answer", 4, 1], ["changes", 5, 1], ["cmd3", 6, 1]]);
  assert.equal(workSummary(display[1]!.rows), "Ran 2 commands · Thought process");
  const updated = transcriptRows([...rows.slice(0, 4), row("cmd4", "command_execution"), ...rows.slice(4)]);
  assert.equal(updated[1]!.key, display[1]!.key, "Streaming activity preserves the user's disclosure state");
});
