import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, ThreadId, MessageId } from "@t3tools/contracts";
import { parseAssistantCitationHref, collectAssistantCitations, serializeAssistantCitation, withAssistantCitationComment, type AssistantCitation } from "./messageCitations.js";
import { formatComposerMessage } from "./composerContext.js";
import { renderedMessageText, stripRenderedAssistantQuotes } from "./assistantQuoteText.js";
import { parseDraftTransfer } from "./viewDraft.js";
const source: AssistantCitation = { version: 1, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text: "My own words", start: 0, end: 12, prefix: "", suffix: "", author: "user" };
test("User quotes keep authorship through comments, draft restore, serialization, rendering and copy", () => {
  const citation = withAssistantCitationComment(source, "Explain this");
  const context = { type: "assistant" as const, citation };
  const draft = parseDraftTransfer({ draftKey: "thread", draft: { text: "Discuss", contexts: [context] } }, "thread")!.draft;
  const message = formatComposerMessage(draft.text, draft.contexts);
  assert.match(message, /\[User quote\]/); assert.match(message, /> User quote:/);
  assert.doesNotMatch(message, /Assistant quote/);
  assert.deepEqual(collectAssistantCitations(message)[0]!.citation, citation);
  assert.doesNotMatch(stripRenderedAssistantQuotes(message), /> User quote:/);
  assert.equal(renderedMessageText(message), "Discuss\n\nMy own words\nComment: Explain this");
  assert.equal(withAssistantCitationComment(citation, "").author, "user");
});
test("Existing assistant links remain compatible", () => {
  const { author, ...assistant } = source;
  const link = serializeAssistantCitation(assistant);
  assert.match(link, /^\[Assistant quote\]/); assert.doesNotMatch(link, /author=/);
  assert.deepEqual(collectAssistantCitations(link)[0]!.citation, assistant);
});

test("Malformed or oversized user citation links fail closed", () => {
  const link = serializeAssistantCitation(source);
  const href = link.slice(link.indexOf("(") + 1, -1);
  assert.equal(parseAssistantCitationHref(href + "&author=user"), null);
  assert.equal(parseAssistantCitationHref(href.replace("author=user", "author=other")), null);
  assert.equal(parseAssistantCitationHref("https://example.com/"), null);
  assert.equal(parseAssistantCitationHref(href + "x".repeat(200_000)), null);
});
