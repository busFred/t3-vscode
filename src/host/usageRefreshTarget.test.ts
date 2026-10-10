import assert from "node:assert/strict";
import test from "node:test";
import { RunId } from "@t3tools/contracts";
import { viewsHarness, provider } from "./testing/fakeTransport.js";
import { turnFixture } from "./testing/turnFixture.js";

test("Background usage refreshes target one instance while explicit ones still sweep every instance", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.refreshUsage(provider.instanceId);
  await host.refreshUsage();
  assert.deepEqual(client.providerRefreshes, [{ instanceId: provider.instanceId, cwd: undefined }, { instanceId: undefined, cwd: undefined }],
    "The status bar refreshes its own provider; the Account & Usage button and provider setup check rediscover everything");
});

test("The host reports itself busy while a message is in flight so background refreshes can wait", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  assert.equal(host.busy, false);
  let finish!: () => void; let started!: () => void;
  const reached = new Promise<void>((resolve) => { started = resolve; });
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async (command) => { await dispatch(command); if (client.commands.at(-1)?.type === "message.dispatch") { started(); await blocked; } };
  const sending = host.sendMessage("Hello", "first");
  await reached;
  assert.equal(host.busy, true, "Sending blocks a refresh for the whole dispatch, which is the window that was delaying messages");
  finish(); await sending;
  assert.equal(host.busy, false, "A completed dispatch with no observed run releases the refresh");
});

test("A running response keeps the host busy until the run leaves the thread shell", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const shell = await client.snapshotShell();
  const running = shell.threads.map((thread) => thread.id === "first" ? { ...thread, activeRunId: RunId.make("run-first-1") } : thread);
  client.shellHandler?.({ kind: "snapshot", snapshot: { ...shell, threads: running } });
  assert.equal(host.busy, true);
  client.threadHandlers.get("first")?.({ kind: "snapshot", snapshotSequence: 3, projection: turnFixture("first", 1) });
  assert.equal(host.busy, true, "The projection alone does not clear the shell's active run");
  client.shellHandler?.({ kind: "snapshot", snapshot: shell });
  assert.equal(host.busy, false);
});

test("An archived session carrying a stale active run cannot defer refreshes forever", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const shell = await client.snapshotShell();
  const stuck = shell.threads.map((thread) => thread.id === "first" ? { ...thread, activeRunId: RunId.make("run-first-1"), archivedAt: thread.updatedAt } : thread);
  client.shellHandler?.({ kind: "snapshot", snapshot: { ...shell, threads: stuck } });
  assert.ok(host.snapshot().threads.some((thread) => thread.id === "first" && thread.archived), "The archived session is still visible");
  assert.equal(host.busy, false, "Archived sessions cannot run, so their run id must not gate background work");
});
