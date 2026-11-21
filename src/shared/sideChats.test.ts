import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import type { ThreadSummary } from "./bridge.js";
import { contextIsReferenced, insertSideChatReference, removeContextReference, sideChatRecordsForMessage } from "./composerContext.js";
import { sessionTree } from "./sessionTree.js";
import { parseSideChatCommand, sideChatBlockCode, sideChatBlockMessage, sideChatDisabledReason } from "./sideChats.js";

test("side-chat parsing uses whole-message slash commands and aliases", () => {
  assert.deepEqual(parseSideChatCommand("  /SIDE  compare\npaths "), { prompt: "compare\npaths" });
  assert.deepEqual(parseSideChatCommand("/btw "), { prompt: "" });
  for (const text of ["How about /side?", "/sideways text", "/btw: text"]) assert.equal(parseSideChatCommand(text), null);
});

test("side-chat availability follows lineage, the machine capability, and the first message", () => {
  const available = { capability: true, hasUserMessage: true };
  assert.equal(sideChatDisabledReason(available), null);
  assert.match(sideChatDisabledReason({ ...available, sideChat: true })!, /Side chats cannot/);
  assert.match(sideChatDisabledReason({ ...available, subagent: true })!, /Subagent threads cannot/);
  assert.match(sideChatDisabledReason({ ...available, capability: false })!, /Update this environment/);
  assert.match(sideChatDisabledReason({ ...available, capability: undefined })!, /not ready/);
  assert.match(sideChatDisabledReason({ ...available, hasUserMessage: false })!, /after the first message/);
  assert.match(sideChatDisabledReason({ ...available, worktreePending: true })!, /worktree is set up/);
});

test("side chats are children, before subagents, while ordinary forks remain roots", () => {
  const base = { projectId: "project", modelSelection: {}, status: "idle", updatedAt: "2026-01-01T00:00:00Z" } as ThreadSummary;
  const parent = { ...base, id: "parent", title: "Parent" }, child = { ...base, parentThreadId: parent.id };
  const agent = { ...child, id: "agent", title: "A subagent", relationshipToParent: "subagent" as const };
  const side = { ...child, id: "side", title: "Z side chat", relationshipToParent: "side-chat" as const };
  const fork = { ...child, id: "fork", title: "Fork", relationshipToParent: "fork" as const };
  const roots = sessionTree([agent, side, parent, fork], [agent, side, fork], "title-asc");
  assert.deepEqual(roots.map(node => node.thread.id), ["fork", "parent"]);
  assert.deepEqual(roots[1]!.children.map(node => node.thread.id), ["side", "agent"]);
  // Without its parent in the list (archived and not loaded) a side chat is its own row rather than hidden.
  assert.deepEqual(sessionTree([side]).map(node => node.thread.id), ["side"]);
});

test("a side-chat mention replaces the trigger and only sends records that remain referenced", () => {
  const record = threadContextRecord({ environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("side") }, "A side question");
  const inserted = insertSideChatReference("Read @side please", [], record, { start: 5, end: 10 });
  assert.match(inserted.text, /^Read \[A side question\]\(t3-context:\/\/v1\/thread\/thread_side\) /);
  assert.equal(inserted.text.slice(inserted.cursor).trimStart(), "please");
  assert.deepEqual(sideChatRecordsForMessage(inserted.text, inserted.contexts), [record]);
  assert.ok(contextIsReferenced(inserted.text, inserted.contexts[0]!));
  assert.deepEqual(sideChatRecordsForMessage(removeContextReference(inserted.text, inserted.contexts[0]!), inserted.contexts), []);
});

test("a leading reply stays apart from the prompt, so /side after it still starts a side chat and keeps the reply", async () => {
  const { formatComposerContextReference } = await import("@t3tools/shared/composerContextReferences");
  const { parseSideChatMessage, promptStart } = await import("./sideChats.js");
  const token = formatComposerContextReference({ kind: "response", contextId: "response_message-one" as never, label: "The core chat is ready." });
  assert.equal(promptStart(`${token} /side why?`), token.length + 1);
  assert.equal(promptStart("/side why?"), 0);
  assert.deepEqual(parseSideChatMessage(`${token} /side why?`), { prompt: `${token} why?` });
  assert.deepEqual(parseSideChatMessage("/btw why?"), { prompt: "why?" });
  assert.equal(parseSideChatMessage(`${token} plain reply`), null);
  assert.equal(parseSideChatMessage(`before ${token} /side x`), null, "only a leading reply is set apart");
});

test("A side chat block travels as a short code that maps back to the same sentences", () => {
  const blocked = { capability: true, hasUserMessage: true };
  assert.equal(sideChatBlockCode(blocked), null);
  assert.equal(sideChatBlockMessage(null), null);
  assert.equal(sideChatBlockCode({ ...blocked, sideChat: true }), "side-chat");
  assert.equal(sideChatBlockCode({ ...blocked, subagent: true }), "subagent");
  assert.equal(sideChatBlockCode({ ...blocked, capability: undefined }), "not-ready");
  assert.equal(sideChatBlockCode({ ...blocked, capability: false }), "unsupported");
  assert.equal(sideChatBlockCode({ ...blocked, hasUserMessage: false }), "no-message");
  assert.equal(sideChatBlockCode({ ...blocked, worktreePending: true }), "worktree");
  assert.equal(sideChatBlockMessage("unsupported"), "Update this environment's T3 Code server to use side chats.");
  assert.equal(sideChatBlockMessage("side-chat"), "Side chats cannot start side chats.");
});
