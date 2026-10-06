import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectAssistantCitations, withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { createAssistantTextSelector, findAssistantCitationText } from "../webview/components/t3/assistantTextSelection.js";
import { formatComposerMessage } from "./composerContext.js";

test("Quotes preserve code whitespace, rendered UTF-16 offsets and exact text through T3 citation encoding", () => {
  const text = "Before 😀\n\nconst  value = 42;\nAfter.";
  const quote = "const  value = 42;";
  const selector = createAssistantTextSelector(text, text.indexOf(quote), text.indexOf(quote) + quote.length)!;
  const citation = withAssistantCitationComment({ version: 1, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), ...selector }, " Why 42? ");
  const message = formatComposerMessage("Discuss this", [{ type: "assistant", citation }]);
  assert.deepEqual(collectAssistantCitations(message).map((match) => match.citation), [citation]);
  assert.ok(message.includes("Why 42?")); assert.ok(message.includes("const  value = 42;"));
  assert.equal(selector.start, "Before 😀 ".length);
  assert.deepEqual(findAssistantCitationText(text, selector), { start: selector.start, end: selector.end });
  assert.equal(formatComposerMessage("", [{ type: "assistant", citation }]).length > 0, true);
});
test("Repeated quotes use surrounding context, including after offsets drift", () => {
  const text = "First quote and second quote with different context.";
  const start = text.indexOf("quote", 10); const selector = createAssistantTextSelector(text, start, start + 5)!;
  assert.equal(findAssistantCitationText("Prefix. " + text, selector)?.start, start + 8);
  assert.equal(findAssistantCitationText("quote quote", { text: "quote", start: 0, end: 5, prefix: "", suffix: "" }), null);
  assert.equal(createAssistantTextSelector(" \n\t ", 0, 4), null);
});
test("Removing or editing a comment preserves the citation source and exact selection", () => {
  const selector = createAssistantTextSelector("The selected text.", 4, 12)!;
  const citation = { version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), ...selector };
  const withComment = withAssistantCitationComment(citation, "A comment\nwith a second line.");
  assert.equal(withComment.comment, "A comment\nwith a second line.");
  assert.deepEqual(withAssistantCitationComment(withComment, "  "), citation);
  assert.deepEqual(collectAssistantCitations(formatComposerMessage("Follow up", [{ type: "assistant", citation: withComment }]))[0]?.citation, withComment);
});
