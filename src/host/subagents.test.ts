import test from "node:test";
import assert from "node:assert/strict";
import { ThreadId } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";

test("Subagent lineage remains scoped and native children are read-only while app-owned children can receive messages", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("editor");
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, lineage: { ...entry.lineage, parentThreadId: ThreadId.make("first"), relationshipToParent: "subagent" as const }, creationSource: "provider" as const, activityRunStatus: "running" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.selectThread("second", "editor");
  const child = host.snapshot("editor").threads.find((entry) => entry.id === "second")!;
  assert.equal(child.parentThreadId, "first"); assert.equal(child.providerNativeSubagent, true); assert.equal(child.activityRunStatus, "running");
  const sidebarId = host.snapshot().activeThreadId;
  await assert.rejects(host.sendMessage("Cannot send to native child", "second", "editor"), /controlled by its provider/);
  await host.selectThread("first", "editor"); assert.equal(host.snapshot().activeThreadId, sidebarId);
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, creationSource: "mcp" as const } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await host.selectThread("second", "editor"); await host.sendMessage("App-owned follow-up", "second", "editor");
  assert.ok(client.commands.some((command) => command.type === "message.dispatch" && command.threadId === "second"));
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((entry) => entry.id === "second" ? { ...entry, lineage: { ...entry.lineage, parentThreadId: ThreadId.make("outside-thread") } } : entry) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.equal(host.snapshot("editor").threads.find((entry) => entry.id === "second")!.parentThreadId, null);
});
