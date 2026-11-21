import test from "node:test";
import assert from "node:assert/strict";
import { formatComposerMessage, insertSideChatReference, sideChatRecordsForMessage } from "../shared/composerContext.js";
import { publishActivity } from "./testing/activityFixture.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";
import { viewsHarness, seedSideChatParent } from "./testing/fakeTransport.js";


test("side-chat commands use the active parent's settings and mentions carry a referenced record", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  assert.ok(!(await host.composerSuggestions("slash-command", "", true)).some(item => item.id === "side"));
  await assert.rejects(host.sendMessage("/side test", "first"), /Update this environment/);
  seedSideChatParent(client);
  const parent = client.shell.threads.find(thread => thread.id === "first")!;
  assert.deepEqual((await host.composerSuggestions("slash-command", "", true)).filter(item => ["side", "btw"].includes(item.id)).map(item => item.label), ["/side", "/btw"]);
  const child = await host.sendMessage("/btw a small question", "first", SIDEBAR_VIEW_ID, "queue");
  assert.ok(child);
  const fork = client.commands.find(command => command.type === "thread.fork");
  assert.equal(fork?.sourceThreadId, "first");
  assert.equal(fork?.targetThreadId, child);
  assert.equal(fork?.sideChat, true);
  assert.equal(fork?.title, "Side chat");
  const dispatched = client.commands.find(command => command.type === "message.dispatch");
  assert.equal(dispatched?.threadId, child);
  assert.equal(dispatched?.text, "a small question");
  assert.equal(dispatched?.titleSeed, "a small question");
  assert.deepEqual(dispatched?.modelSelection, parent.modelSelection);
  assert.deepEqual(dispatched?.dispatchMode, { type: "start_immediately" });

  const empty = await host.startSideChat("first");
  const mentions = (await host.composerSuggestions("path", "side", false)).filter(item => item.kind === "thread");
  assert.deepEqual(mentions.map(item => item.value), [child]);
  const record = mentions[0]!.threadContext!;
  await host.selectThread(child);
  assert.deepEqual(host.sideChatContext(SIDEBAR_VIEW_ID, child), { draftKey: "first", record });
  await assert.rejects(host.startSideChat(child), /Side chats cannot start side chats/);
  await host.discardUnusedSideChat(empty);
  assert.ok(client.commands.some(command => command.type === "thread.delete" && command.threadId === empty && command.onlyIfUnused));
  await host.discardUnusedSideChat(child);
  assert.ok(!client.commands.some(command => command.type === "thread.delete" && command.threadId === child));
  await host.selectThread("second");
  assert.ok(!(await host.composerSuggestions("path", "side", false)).some(item => item.kind === "thread"));

  const inserted = insertSideChatReference("Use @side", [], record, { start: 4, end: 9 });
  const text = formatComposerMessage(inserted.text, inserted.contexts);
  await host.sendMessage(text, "first", SIDEBAR_VIEW_ID, "auto", [], [], [], sideChatRecordsForMessage(text, inserted.contexts));
  const last = client.commands.at(-1);
  assert.ok(last?.type === "message.dispatch");
  assert.deepEqual(last.context?.records, [record]);
  await assert.rejects(host.sendMessage(text, "second", SIDEBAR_VIEW_ID, "auto", [], [], [], [record]), /Only this conversation's side chats/);

  await host.selectThread(child);
  host.saveComposerDraft(child, { text: "Side draft", contexts: [] }, undefined);
  await host.threadAction("first", "archive");
  assert.ok(!host.snapshot().threads.some(thread => thread.id === child));
  await host.threadAction("first", "unarchive");
  assert.equal((await host.restoreComposerDraft(child)).draft.text, "");
});

test("failed side-chat send discards the unused fork and preserves the main draft", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  seedSideChatParent(client);
  await host.selectThread("first");
  host.saveComposerDraft("first", { text: "/side retry me", contexts: [] }, undefined);
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async raw => {
    if ((raw as { type: string }).type === "message.dispatch") throw new Error("fixture rejected side turn");
    return dispatch(raw);
  };
  await assert.rejects(host.sendMessage("/side retry me", "first"), /fixture rejected side turn/);
  const fork = client.commands.find(command => command.type === "thread.fork");
  const discard = client.commands.at(-1);
  assert.ok(discard?.type === "thread.delete" && discard.onlyIfUnused && discard.threadId === fork?.targetThreadId);
  assert.equal((await host.restoreComposerDraft("first")).draft.text, "/side retry me");
  assert.ok(!host.snapshot().threads.some(thread => thread.id === fork?.targetThreadId));
});


test("a queued message cannot be edited into a side chat", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  publishActivity(client, "first");
  await assert.rejects(host.queueAction("first", "edit", "queued-first-1", "/btw question", undefined), /A queued message can't move to a side chat/);
  assert.ok(!client.commands.some(command => command.type === "queued-run.edit" || command.type === "thread.fork"));
});

test("closing an unused side chat keeps it while its draft holds typed text", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  seedSideChatParent(client);
  const empty = await host.startSideChat("first");
  await host.selectThread(empty);
  host.saveComposerDraft(empty, { text: "a question for later", contexts: [] }, undefined);
  await host.discardUnusedSideChat(empty);
  assert.ok(!client.commands.some(command => command.type === "thread.delete" && command.threadId === empty));
  host.saveComposerDraft(empty, { text: "", contexts: [] }, undefined);
  await host.discardUnusedSideChat(empty);
  assert.ok(client.commands.some(command => command.type === "thread.delete" && command.threadId === empty && command.onlyIfUnused));
});

test("archiving the main chat keeps the draft and visibility of a side chat the server leaves active", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  seedSideChatParent(client);
  const busy = await host.startSideChat("first");
  const idle = await host.startSideChat("first");
  for (const id of [busy, idle]) { await host.selectThread(id); host.saveComposerDraft(id, { text: `draft ${id}`, contexts: [] }, undefined); }
  // A side chat waiting on delegated tasks is not archived with its parent (T3 Code 0.1.11); an ordinary one is.
  client.waitingOnDelegatedTasks.add(busy);
  await host.threadAction("first", "archive");
  assert.ok(host.snapshot().threads.some(thread => thread.id === busy), "the active side chat stays reachable");
  assert.equal((await host.restoreComposerDraft(busy)).draft.text, `draft ${busy}`);
  assert.equal(host.sideChatClosed(idle), true);
  await host.threadAction("first", "unarchive");
  assert.equal((await host.restoreComposerDraft(idle)).draft.text, "", "the archived side chat's draft was discarded");
});

test("a whitespace-only side-chat draft also keeps the side chat on close, as draft recovery counts it", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  seedSideChatParent(client);
  const empty = await host.startSideChat("first");
  await host.selectThread(empty);
  host.saveComposerDraft(empty, { text: "   ", contexts: [] }, undefined);
  await host.discardUnusedSideChat(empty);
  assert.ok(!client.commands.some(command => command.type === "thread.delete" && command.threadId === empty));
});
