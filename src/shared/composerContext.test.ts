import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectAssistantCitations, withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { createAssistantTextSelector, findAssistantCitationText } from "../webview/components/t3/assistantTextSelection.js";
import { contextIsReferenced, formatComposerMessage, insertAssistantQuote, removeContextReference } from "./composerContext.js";
import { insertAttachmentReferences } from "./composerAttachments.js";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { parseDraftTransfer } from "./viewDraft.js";

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

const inlineCitation = { version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text: "Keep the original source.", start: 0, end: 25, prefix: "", suffix: "", comment: "Explain this." };
const inlineQuote = { type: "assistant" as const, contextId: "quote_one", citation: inlineCitation };

test("Inline quotes replace the prompt selection, retain surrounding text and expand at the same send position", () => {
  const inserted = insertAssistantQuote("Before replace after 😀.", inlineQuote, { start: 7, end: 14 });
  const ref = collectComposerContextReferences(inserted.text)[0]!;
  assert.equal(ref.kind, "assistant-quote");
  assert.equal(inserted.text.slice(0, ref.start), "Before ");
  assert.equal(inserted.text.slice(inserted.cursor), " after 😀.");
  const sent = formatComposerMessage(inserted.text, [inlineQuote]);
  const source = collectAssistantCitations(sent)[0]!;
  assert.deepEqual(source.citation, inlineCitation);
  assert.equal(sent.slice(0, source.start), "Before ");
  assert.ok(sent.slice(source.end).startsWith(" after 😀."));
  assert.ok(!sent.includes("t3-context://v1/assistant-quote"));
});

test("Quotes and images do not split each other's references when inserting or replacing a partial token", () => {
  const first = insertAssistantQuote("Before  after.", inlineQuote, { start: 7, end: 7 });
  const file = { key: "image", contextId: "image_one", name: "plot.png", mimeType: "image/png", sizeBytes: 12 };
  const withImage = insertAttachmentReferences(first.text, [file], { start: 20, end: 20 });
  const refs = collectComposerContextReferences(withImage.text);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(ref => ref.kind), ["assistant-quote", "image"]);
  const replaced = insertAssistantQuote(withImage.text, { ...inlineQuote, contextId: "quote_two" }, { start: refs[1]!.start + 5, end: refs[1]!.start + 9 });
  assert.deepEqual(collectComposerContextReferences(replaced.text).map(ref => ref.contextId), ["quote_one", "quote_two"]);
  assert.equal(replaced.text.slice(replaced.cursor), " after.");
});

test("Deleting inline quotes omits their payload while duplicate references share the preserved source", () => {
  const inserted = insertAssistantQuote("Before  after.", inlineQuote, { start: 7, end: 7 });
  assert.equal(contextIsReferenced(inserted.text, inlineQuote), true);
  const removed = removeContextReference(inserted.text, inlineQuote);
  assert.equal(removed, "Before  after.");
  assert.equal(contextIsReferenced(removed, inlineQuote), false);
  assert.equal(formatComposerMessage(removed, [inlineQuote]), "Before  after.");
  const repeated = formatComposerMessage(`${inserted.text}\n${inserted.text}`, [inlineQuote]);
  assert.equal(collectAssistantCitations(repeated).length, 2);
  assert.equal(repeated.split("> Assistant quote:").length, 2);
  const transferred = parseDraftTransfer({ draftKey: "thread", draft: { text: inserted.text, contexts: [inlineQuote] } }, "thread")!;
  assert.deepEqual(transferred.draft.contexts, [inlineQuote]);
  assert.deepEqual(collectAssistantCitations(formatComposerMessage(transferred.draft.text, transferred.draft.contexts))[0]?.citation, inlineCitation);
  assert.throws(() => parseDraftTransfer({ draftKey: "thread", draft: { text: "", contexts: [{ ...inlineQuote, contextId: "invalid:id" }] } }, "thread"));
});
