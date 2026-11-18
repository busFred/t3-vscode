import test from "node:test";
import assert from "node:assert/strict";
import { detectComposerTrigger, slashSuggestions } from "./composerSuggestions.js";

test("/model is a slash-command trigger whose query selects the local /model action", () => {
  const text = "/model";
  const trigger = detectComposerTrigger(text, text.length);
  assert.deepEqual(trigger, { kind: "slash-command", query: "model", rangeStart: 0, rangeEnd: text.length });
  const items = slashSuggestions(undefined, null, trigger!.query, trigger!.rangeStart === 0);
  assert.equal(items[0]?.kind, "model");
});

test("a bare slash lists the local actions", () => {
  const trigger = detectComposerTrigger("/", 1);
  assert.equal(trigger?.kind, "slash-command");
  assert.deepEqual(slashSuggestions(undefined, null, trigger!.query, true).map((item) => item.id), ["model", "usage"]);
});

test("a slash word later in the prompt is a trigger that is not at the prompt start", () => {
  const text = "please /mod";
  const trigger = detectComposerTrigger(text, text.length);
  assert.deepEqual(trigger, { kind: "slash-command", query: "mod", rangeStart: 7, rangeEnd: text.length });
});

test("paths stay out of the slash menu", () => {
  for (const text of ["/tmp/file.ts", "see /usr/bin", "C:\\x /a\\b"]) assert.equal(detectComposerTrigger(text, text.length), null, text);
});
