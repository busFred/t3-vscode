import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectAssistantCitations, withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { createAssistantTextSelector, findAssistantCitationText } from "../webview/components/t3/assistantTextSelection.js";
import { contextIsReferenced, fileReferenceOccurrences, formatComposerMessage, insertAssistantQuote, insertFileReference, removeContextReference, type FileReference } from "./composerContext.js";
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
const selectedFile: FileReference = { type: "file", uri: "file:///tmp/project/README.md", path: "/tmp/project/README.md", label: "README.md", range: { start: { line: 43, column: 3 }, end: { line: 47, column: 1 } }, text: "  unsaved selected text\n```\npartial line" };

test("Editor references insert readable file/range tokens at the cursor and retain exact unsaved snapshots", () => {
  const inserted = insertFileReference("Before replace after.", [], selectedFile, { start: 7, end: 14 });
  assert.equal(inserted.text, "Before @README.md:43-46  after.");
  assert.equal(inserted.cursor, "Before @README.md:43-46 ".length);
  const sent = formatComposerMessage(inserted.text, inserted.contexts);
  assert.ok(sent.startsWith("Before [README.md:43-46](file:///tmp/project/README.md#L43-L46)  after."));
  assert.ok(sent.includes("43:3–47:1 (end exclusive)"));
  assert.ok(sent.includes("````\n" + selectedFile.text + "\n````"));
  assert.deepEqual(parseDraftTransfer({ draftKey: "file-chat", draft: { text: inserted.text, contexts: inserted.contexts } }, "file-chat")?.draft.contexts, inserted.contexts);
});

test("Deleting file tokens omits snapshots and cannot accidentally bind a longer range or an image label", () => {
  const inserted = insertFileReference("", [], selectedFile, { start: 0, end: 0 });
  const context = inserted.contexts[0]!;
  assert.equal(contextIsReferenced(inserted.text, context), true);
  assert.equal(formatComposerMessage(removeContextReference(inserted.text, context), inserted.contexts), "");
  assert.equal(contextIsReferenced("@README.md:43-460", context), false);
  assert.equal(fileReferenceOccurrences("[@README.md:43-46](t3-context://v1/image/one)", inserted.contexts).length, 0);
  assert.ok(formatComposerMessage("legacy draft", [selectedFile]).includes(selectedFile.text));
  const duplicate = formatComposerMessage(inserted.text.repeat(2), inserted.contexts);
  assert.equal(duplicate.split("Snapshot from the editor").length, 2);
});

test("Repeated editor references refresh one snapshot and disambiguate paths from different workspace folders", () => {
  const first = insertFileReference("", [], selectedFile, { start: 0, end: 0 });
  const second = insertFileReference(first.text, first.contexts, { ...selectedFile, text: "new unsaved selection" }, { start: first.cursor, end: first.cursor });
  assert.equal(second.contexts.length, 1);
  assert.ok(formatComposerMessage(second.text, second.contexts).includes("new unsaved selection"));
  assert.ok(!formatComposerMessage(second.text, second.contexts).includes(selectedFile.text));
  const other = insertFileReference(second.text, second.contexts, { ...selectedFile, uri: "file:///tmp/other/README.md", path: "/tmp/other/README.md", text: "other file" }, { start: second.cursor, end: second.cursor });
  assert.ok(other.text.includes("@/tmp/other/README.md:43:3-47:1"));
  assert.equal(fileReferenceOccurrences(other.text, other.contexts).length, 3);
  const spaced = insertFileReference("explain", [], { ...selectedFile, label: "notes with spaces.md" }, { start: 7, end: 7 });
  assert.equal(spaced.text, 'explain @"notes with spaces.md:43-46" ');
  assert.equal(fileReferenceOccurrences(spaced.text, spaced.contexts).length, 1);
});

test("Different partial selections on the same source lines preserve their own snapshots", () => {
  const first = insertFileReference("", [], selectedFile, { start: 0, end: 0 });
  const shorter: FileReference = { ...selectedFile, range: { start: { line: 43, column: 8 }, end: { line: 46, column: 12 } }, text: "different partial selection" };
  const second = insertFileReference(first.text, first.contexts, shorter, { start: first.cursor, end: first.cursor });
  assert.equal(fileReferenceOccurrences(second.text, second.contexts).length, 2);
  const sent = formatComposerMessage(second.text, second.contexts);
  assert.ok(sent.includes(selectedFile.text)); assert.ok(sent.includes(shorter.text));
  const removed = formatComposerMessage(removeContextReference(second.text, second.contexts[1]!), second.contexts);
  assert.ok(removed.includes(selectedFile.text)); assert.ok(!removed.includes(shorter.text));
});

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
