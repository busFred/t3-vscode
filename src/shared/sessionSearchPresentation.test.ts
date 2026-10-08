import test from "node:test";
import assert from "node:assert/strict";
import { findSessionMatches } from "./sessionSearch.js";
import type { TranscriptItem, WireTurnItem } from "./bridge.js";
import { DEFAULT_SEARCH_PREFERENCES, groupSessionMatches, resolveSearchPreferences, searchPreferencePatch, sessionPreviewLines, sessionSearchPreview, previewHighlightRanges } from "./sessionSearchPresentation.js";
const options = { query: "needle", caseSensitive: false, wholeWord: false, scope: "all" as const };
const row = (key: string, text: string, kind = "assistant_message"): TranscriptItem => ({ key, sourceThreadId: "thread", output: null, toolLabel: null, needsDetail: false, item: { type: kind, text, input: text } as unknown as WireTurnItem });

test("Panel preferences reject invalid bridge patches and normalize stored values without creating settings", () => {
  assert.deepEqual(resolveSearchPreferences(), DEFAULT_SEARCH_PREFERENCES);
  assert.deepEqual(resolveSearchPreferences({ contextLines: 99, resultsHeight: -4, layout: "side", order: "newest" }), { contextLines: 10, resultsHeight: 120, layout: "side", order: "newest" });
  assert.equal(resolveSearchPreferences({ resultsHeight: NaN }).resultsHeight, 280);
  assert.deepEqual(searchPreferencePatch({ contextLines: 0, order: "newest" }), { contextLines: 0, order: "newest" });
  for (const patch of [{ layout: "left" }, { contextLines: 11 }, { contextLines: 1.5 }, { resultsHeight: Infinity }, { resultsHeight: 0 }, { query: "other" }]) assert.throws(() => searchPreferencePatch(patch), /Invalid/);
});

test("Chronological groups retain every occurrence and separate command fields from message text", () => {
  const old = findSessionMatches(row("old", "needle"), options).matches;
  const command = findSessionMatches({ ...row("command", "needle", "command_execution"), output: "needle needle" }, options).matches;
  const recent = findSessionMatches(row("recent", "needle needle"), options).matches;
  const oldest = groupSessionMatches([...old, ...command, ...recent], "oldest");
  const newest = groupSessionMatches([...old, ...command, ...recent], "newest");
  assert.deepEqual(oldest.map(e => e.matches[0]!.rowKey), ["old", "recent", "command", "command"]);
  assert.deepEqual(newest.map(e => e.matches[0]!.rowKey), ["recent", "old", "command", "command"]);
  assert.equal(oldest[1]!.matches.length, 2);
  assert.equal(oldest.flatMap(e => e.matches).length, 6);
  assert.deepEqual(new Set(oldest.flatMap(e => e.matches.map(m => m.id))), new Set(newest.flatMap(e => e.matches.map(m => m.id))));
  assert.ok(oldest.slice(2).every(e => e.group === "activity"));
});

test("Preview context preserves line breaks and exact source offsets around each occurrence", () => {
  const text = "before two\nbefore one\nneedle here\nafter one\nafter two";
  const match = findSessionMatches(row("source", text), options).matches[0]!;
  const preview = sessionSearchPreview(text, match);
  const compact = sessionPreviewLines(preview, match, 0, 80, s => s.length);
  assert.deepEqual(compact.lines.map(l => l.text), ["needle here"]);
  assert.equal(compact.before, true); assert.equal(compact.after, true);
  const contextual = sessionPreviewLines(preview, match, 1, 80, s => s.length);
  assert.deepEqual(contextual.lines.map(l => l.text), ["before one", "needle here", "after one"]);
  assert.equal(contextual.lines[1]!.start, match.start);
  const full = sessionPreviewLines(preview, match, 10, 80, s => s.length);
  assert.equal(full.before, false); assert.equal(full.after, false);
});

test("Preview limits bound long command output while wrapping paragraphs and keeping the selected later occurrence", () => {
  const text = "a".repeat(30_000) + " needle " + "b".repeat(30_000) + " needle end";
  const match = findSessionMatches(row("source", text), options).matches[1]!;
  const preview = sessionSearchPreview(text, match);
  assert.ok(preview.text.length <= 16_384 + options.query.length);
  assert.equal(preview.text.slice(match.start - preview.start, match.end - preview.start), "needle");
  const result = sessionPreviewLines(preview, match, 2, 40, s => s.length);
  assert.ok(result.lines.some(l => l.text.includes("needle")));
  assert.ok(result.lines.length <= 6);
  assert.equal(result.before, true); assert.equal(result.after, false);
  for (const line of result.lines) assert.equal(text.slice(line.start, line.end), line.text);
});

test("Multiline matches include the entire matching range, even with zero extra context", () => {
  const text = "top\none\ntwo\nbottom";
  const match = findSessionMatches(row("source", text), { ...options, query: "one\ntwo" }).matches[0]!;
  const result = sessionPreviewLines(sessionSearchPreview(text, match), match, 0, 80, s => s.length);
  assert.deepEqual(result.lines.map(l => l.text), ["one", "two"]);
});

test("Highlights retain whole-word boundaries and source offsets when a match wraps across preview lines", () => {
  const text = "prefix needlessly needle suffix";
  const exact = { ...options, wholeWord: true };
  const match = findSessionMatches(row("source", text), exact).matches[0]!;
  const preview = sessionSearchPreview(text, match), ranges = previewHighlightRanges(preview, exact);
  assert.deepEqual(ranges, [{ start: match.start, end: match.end }]);
  const wrapped = sessionPreviewLines(preview, match, 0, 3, s => s.length);
  const fragments = wrapped.lines.flatMap(line => ranges.filter(range => range.end > line.start && range.start < line.end).map(range => text.slice(Math.max(line.start, range.start), Math.min(line.end, range.end))));
  assert.equal(fragments.join(""), "needle");
  assert.ok(fragments.length > 1);
});
