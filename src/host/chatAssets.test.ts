import test from "node:test";
import assert from "node:assert/strict";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";
import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";

test("Chat assets authorize only references from the selected workspace conversation", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first"); publishText(client, "first", "![diagram](assets/diagram.svg)");
  const source = { sourceThreadId: "first", itemId: "text-first" };
  const asset = await host.chatAsset("first", source, { kind: "media", path: "assets/diagram.svg" });
  assert.ok(asset.url); assert.deepEqual(client.assetRequests[0], { _tag: "media-file", threadId: "first", path: "/tmp/t3-vscode/assets/diagram.svg" });
  await assert.rejects(host.chatAsset("first", source, { kind: "media", path: "/etc/passwd" }), /does not belong/);
  await assert.rejects(host.chatAsset("first", source, { kind: "attachment", attachmentId: "unrelated" }), /does not belong/);
  await assert.rejects(host.chatAsset("outside-thread", source, { kind: "html" }), /not available/);
  assert.equal(client.assetRequests.length, 1);
  const item: OrchestrationV2TurnItem = { ...((await client.getThreadProjection("first")).turnItems[0]!),
    id: TurnItemId.make("html"), threadId: ThreadId.make("first"), type: "dynamic_tool", status: "completed", toolName: "html_render", input: {}, output: { htmlRender: { attachmentId: "owned-html", title: "Mockup", height: 400 } } } as OrchestrationV2TurnItem;
  const projection = await client.getThreadProjection("first");
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection: { ...projection, turnItems: [item], visibleTurnItems: [{ position: 0, visibility: "local", sourceThreadId: item.threadId, sourceItemId: item.id, item }] } });
  await host.chatAsset("first", { sourceThreadId: "first", itemId: "html" }, { kind: "html" });
  assert.deepEqual(client.assetRequests[1], { _tag: "attachment", attachmentId: "owned-html", fileName: "visualization.html", mimeType: "text/html", disposition: "inline" });
});

test("Relative media follows the source conversation's worktree, matching native file links", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((thread) => thread.id === "first" ? { ...thread, worktreePath: "/tmp/worktrees/feature" } : thread) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  publishText(client, "first", "![diagram](assets/diagram.svg)");
  await host.chatAsset("first", { sourceThreadId: "first", itemId: "text-first" }, { kind: "media", path: "assets/diagram.svg" });
  assert.equal(host.workspaceForThread("first"), "/tmp/worktrees/feature");
  assert.deepEqual(client.assetRequests[0], { _tag: "media-file", threadId: "first", path: "/tmp/worktrees/feature/assets/diagram.svg" });
});

test("Tool output images resolve by position and only from the item that produced them", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first"); publishText(client, "first", "before");
  const png = "iVBORw0KGgo=";
  const item: OrchestrationV2TurnItem = { ...((await client.getThreadProjection("first")).turnItems[0]!),
    id: TurnItemId.make("mcp-tool"), threadId: ThreadId.make("first"), type: "dynamic_tool", status: "completed",
    toolName: "screenshot", input: {},
    output: { content: [{ type: "text", text: "captured" }, { type: "image", mimeType: "image/png", data: png }, { type: "image", mimeType: "image/png", data: png }] },
  } as OrchestrationV2TurnItem;
  const projection = await client.getThreadProjection("first");
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection: { ...projection, turnItems: [item],
    visibleTurnItems: [{ position: 0, visibility: "local", sourceThreadId: item.threadId, sourceItemId: item.id, item }] } });
  const source = { sourceThreadId: "first", itemId: "mcp-tool" };
  const before = client.assetRequests.length;
  await host.chatAsset("first", source, { kind: "tool-output-image", index: 1 });
  assert.deepEqual(client.assetRequests[before], { _tag: "tool-output-image", threadId: "first", itemId: "mcp-tool", index: 1 });
  // The index must name an image this item actually produced; the text block is not one of them.
  await assert.rejects(host.chatAsset("first", source, { kind: "tool-output-image", index: 2 }), /does not belong/);
  await assert.rejects(host.chatAsset("first", source, { kind: "tool-output-image", index: -1 }), /does not belong/);
  assert.equal(client.assetRequests.length, before + 1);
});
