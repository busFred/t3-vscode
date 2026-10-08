import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchFilters, findSessionMatches, type SessionSearchOptions } from "./sessionSearch.js";
import type { TranscriptItem, WireTurnItem } from "./bridge.js";
const options: SessionSearchOptions = { query: "rate", caseSensitive: false, wholeWord: false, scope: "all" };
const row = (fields: unknown, output: string | null = null): TranscriptItem => ({ key: "thread:item", sourceThreadId: "thread", item: fields as WireTurnItem, needsDetail: false, output, toolLabel: null });
test("Session find counts each literal occurrence, preserves source offsets and supports Unicode word boundaries", () => {
  const item = row({ type: "assistant_message", text: "Rate rate rates αrate rate_ $\\eta=0.01$ [a+b]" });
  assert.equal(findSessionMatches(item, options).total, 5);
  const exact = findSessionMatches(item, { ...options, wholeWord: true });
  assert.deepEqual(exact.matches.map((match) => [match.start, match.end]), [[0, 4], [5, 9]]);
  assert.equal(findSessionMatches(item, { ...options, caseSensitive: true }).total, 4);
  assert.equal(findSessionMatches(item, { ...options, query: "[a+b]" }).total, 1);
  assert.equal(findSessionMatches(item, { ...options, query: "\\eta" }).total, 1);
  assert.equal(findSessionMatches(item, { ...options, query: "" }).total, 0);
});
test("Message-only find excludes activity while all-text includes command input, output and attachment names", () => {
  const command = row({ type: "command_execution", input: "echo rate" }, "rate rate");
  assert.equal(findSessionMatches(command, options).total, 3);
  assert.equal(findSessionMatches(command, { ...options, scope: "messages" }).total, 0);
  const attached = row({ type: "user_message", text: "See figure", attachments: [{ name: "rate.png" }] });
  assert.equal(findSessionMatches(attached, { ...options, scope: "messages" }).matches[0]!.field, "attachment:0");
  const bounded = findSessionMatches(row({ type: "assistant_message", text: "rate ".repeat(50) }), options, 3);
  assert.equal(bounded.total, 50); assert.equal(bounded.matches.length, 3);
});


test("Source/content filters intersect, while multiple content kinds use OR", () => {
  const message = row({ type: "user_message", text: "rate $x$", attachments: [{ name: "plot.png", mimeType: "image/png" }] });
  assert.equal(findSessionMatches(message, { ...options, sources: ["assistant"] }).total, 0);
  assert.equal(findSessionMatches(message, { ...options, sources: [] }).total, 0);
  assert.equal(findSessionMatches(message, { ...options, sources: ["user"], content: ["figures", "code"] }).total, 1);
  assert.equal(findSessionMatches(message, { ...options, content: ["equations"] }).total, 1);
  assert.equal(findSessionMatches(message, { ...options, content: ["code"] }).total, 0);
  assert.equal(findSessionMatches(row({ type: "reasoning", text: "rate" }), { ...options, sources: ["thought"] }).total, 1);
  assert.throws(() => parseSearchFilters({ sources: ["arbitrary"] }), /Invalid search/);
  assert.throws(() => parseSearchFilters({ content: "figures" }), /Invalid search/);
});
