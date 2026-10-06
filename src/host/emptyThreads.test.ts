import test from "node:test";
import assert from "node:assert/strict";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";

test("Closing an untouched new conversation removes it; preexisting empty conversations remain", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("empty"); const id = await host.newThread(undefined, "empty");
  await host.removeView("empty");
  assert.ok(client.commands.some((command) => command.type === "thread.delete" && command.threadId === id));
  assert.equal(host.snapshot().threads.some((thread) => thread.id === id), false);
  host.registerView("preexisting"); await host.selectThread("second", "preexisting"); await host.removeView("preexisting");
  assert.ok(host.snapshot().threads.some((thread) => thread.id === "second"));
});

test("Typing, references, sent content and an explicit rename preserve a new conversation", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  for (const reason of ["typed-and-cleared", "reference", "sent", "renamed", "external-rename", "external-pin", "external-message"]) {
    host.registerView(reason); const id = await host.newThread(undefined, reason);
    if (reason === "typed-and-cleared" || reason === "reference") await host.composerState(id, undefined, true, reason);
    if (reason === "sent") await host.sendMessage("A message", id, reason);
    if (reason === "renamed") await host.threadAction(id, "rename", "Keep this conversation");
    if (reason === "external-rename" || reason === "external-pin") {
      client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((thread) => thread.id === id ? { ...thread, ...(reason === "external-rename" ? { title: "Renamed in web UI" } : { pinnedAt: thread.updatedAt }) } : thread) };
      client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
    }
    if (reason === "external-message") publishText(client, id, "Sent from the web UI");
    await host.removeView(reason);
    assert.ok(host.snapshot().threads.some((thread) => thread.id === id), reason);
  }
});

test("Cleanup waits for the last chat surface; Sessions and Usage are not open chats", async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  const id = await host.newThread(undefined, SIDEBAR_VIEW_ID);
  await host.composerState(id, true, false);
  host.registerView("copy", SIDEBAR_VIEW_ID); host.registerView("usage", SIDEBAR_VIEW_ID, false);
  await host.composerState(id, false, false);
  assert.ok(host.snapshot().threads.some((thread) => thread.id === id), "The editor chat still owns this conversation");
  await host.removeView("copy");
  assert.equal(host.snapshot().threads.some((thread) => thread.id === id), false);
  assert.equal(host.snapshot("usage").activeThreadId, undefined);
});

test("A cleanup in flight rechecks typing and reopening before deleting", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("first-close"); const id = await host.newThread(undefined, "first-close");
  const projection = await client.getThreadProjection(id);
  let checking!: () => void; const started = new Promise<void>((resolve) => { checking = resolve; });
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  client.getThreadProjection = async () => { checking(); await blocked; return projection; };
  const closing = host.composerState(id, false, false, "first-close"); await started;
  await host.composerState(id, undefined, true, "first-close"); release(); await closing;
  assert.ok(host.snapshot().threads.some((thread) => thread.id === id));
  assert.equal(client.commands.filter((command) => command.type === "thread.delete").length, 0);
});

test("Switching from an untouched new conversation cleans it up, and offline closure preserves it", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("navigation"); const id = await host.newThread(undefined, "navigation");
  await host.selectThread("second", "navigation");
  assert.equal(host.snapshot().threads.some((thread) => thread.id === id), false);
  const offline = await host.newThread(undefined, "navigation"); client.connected = false;
  await host.removeView("navigation");
  assert.ok(host.snapshot().threads.some((thread) => thread.id === offline));
});
