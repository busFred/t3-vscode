import test from "node:test";
import assert from "node:assert/strict";
import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { viewsHarness, publishText, FakeTransport } from "./testing/fakeTransport.js";
import { relayMcpAppRequest, type McpAppNativePort } from "./mcpApps.js";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";

const app = { attachmentId: "app-html", server: "charts", tool: "plot", resourceUri: "ui://chart" };
const scope = { threadId: "source", itemId: "tool", conversationThreadId: "fork" };
const native: McpAppNativePort & { sendMessage(text: string): Promise<void> } = { confirm: async () => true, openLink: async () => {}, saveFile: async () => {}, sendMessage: async () => {} };
async function fixture() {
  const f = await viewsHarness(); await f.host.selectThread("first"); publishText(f.client, "first", "seed");
  const projection = await f.client.getThreadProjection("first");
  const item = { ...projection.turnItems[0], id: TurnItemId.make("app-item"), threadId: ThreadId.make("first"), type: "dynamic_tool", toolName: "charts.plot", input: { chart: 1 }, output: { t3McpApp: app, result: { content: [{ type: "text", text: "chart result" }] } } } as OrchestrationV2TurnItem;
  f.client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection: { ...projection, turnItems: [item], visibleTurnItems: [{ position: 0, visibility: "local", sourceThreadId: item.threadId, sourceItemId: item.id, item }] } });
  return { ...f, item, source: { sourceThreadId: "first", itemId: "app-item" } };
}

test("MCP relay maps every server intent and prevents app-supplied scope overrides", async () => {
  const client = new FakeTransport();
  for (const [method, params] of [["tools/info", { name: "plot" }], ["tools/call", { name: "plot", arguments: { x: 1 } }], ["resources/read", { uri: "ui://chart" }], ["ui/update-model-context", { content: [{ type: "text", text: "selected" }], structuredContent: { selected: 1 } }]] as const) {
    await relayMcpAppRequest(client, scope, app, method, { ...params, threadId: "evil", itemId: "evil", conversationThreadId: "evil" }, native);
  }
  assert.deepEqual(client.mcpAppRequests.map((call) => call.method), ["mcpApps.toolInfo", "mcpApps.toolInfo", "mcpApps.callTool", "mcpApps.readResource", "mcpApps.updateModelContext"]);
  for (const call of client.mcpAppRequests) assert.deepEqual([(call.input as typeof scope).threadId, (call.input as typeof scope).itemId], ["source", "tool"]);
  assert.deepEqual(client.mcpAppRequests.at(-1)?.input, { ...scope, content: [{ type: "text", text: "selected" }], structuredContent: { selected: 1 } });
  await relayMcpAppRequest(client, scope, app, "ui/update-model-context", {}, native);
  assert.deepEqual(client.mcpAppRequests.at(-1)?.input, scope, "empty context clears the previous context");
  const count = client.mcpAppRequests.length;
  for (const method of ["evil", "filesystem.read", "tools/list", "mcpApps.callTool"]) await assert.rejects(relayMcpAppRequest(client, scope, app, method, {}, native), /Unsupported/);
  await assert.rejects(relayMcpAppRequest(client, scope, app, "tools/call", { name: "plot", arguments: [] }, native));
  assert.equal(client.mcpAppRequests.length, count);
});

test("MCP relay enforces callable, read-only and user approval and propagates server denials", async () => {
  const client = new FakeTransport(); let prompts = 0;
  const port = { ...native, confirm: async () => { prompts++; return false; } };
  client.mcpAppToolInfo = async () => ({ callable: false, readOnly: true });
  await assert.rejects(relayMcpAppRequest(client, scope, app, "tools/call", { name: "hidden", arguments: {} }, port), /cannot call/);
  assert.equal(prompts, 0);
  client.mcpAppToolInfo = async () => ({ callable: true, readOnly: false, title: "Write chart" });
  await assert.rejects(relayMcpAppRequest(client, scope, app, "tools/call", { name: "write", arguments: {} }, port), /Declined/);
  assert.equal(prompts, 1); assert.equal(client.mcpAppRequests.length, 0);
  await relayMcpAppRequest(client, scope, app, "tools/call", { name: "write", arguments: {} }, native);
  assert.equal(client.mcpAppRequests[0]?.method, "mcpApps.callTool");
  client.mcpAppCallTool = async () => { throw new Error("The app's thread is not running."); };
  await assert.rejects(relayMcpAppRequest(client, scope, app, "tools/call", { name: "write", arguments: {} }, native), /not running/);
});

test("MCP app assets, full tool calls and relay are scoped to a visible producing item", async (t) => {
  const { host, client, source, item } = await fixture(); t.after(() => host.dispose());
  await host.chatAsset("first", source, { kind: "mcp-app" });
  assert.deepEqual(client.assetRequests[0], { _tag: "attachment", attachmentId: "app-html", fileName: "plot.html", mimeType: "text/html", disposition: "inline", renderIntent: "mcp-app" });
  assert.deepEqual(await host.mcpAppRequest("first", source, "tool-call", {}, native), { arguments: { chart: 1 }, result: ((item as Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>).output as { result: unknown }).result });
  await host.mcpAppRequest("first", source, "resources/read", { uri: "ui://chart" }, native);
  assert.deepEqual(client.mcpAppRequests[0]?.input, { threadId: "first", itemId: "app-item", uri: "ui://chart" });
  await assert.rejects(host.mcpAppRequest("second", source, "resources/read", { uri: "ui://chart" }, native), /no MCP app/);
  await assert.rejects(host.mcpAppRequest("first", { ...source, itemId: "other" }, "tools/info", { name: "plot" }, native), /no MCP app/);
  const webview = new FakeWebview(); const registry = new WebviewRegistry(); registry.add(SIDEBAR_VIEW_ID, webview.webview); new BridgeHandler(host, registry).attach(webview.webview, SIDEBAR_VIEW_ID);
  await webview.request("mcpAppRequest", { threadId: "first", ...source, appMethod: "tools/info", input: { name: "plot" } });
  assert.equal(client.mcpAppRequests.at(-1)?.method, "mcpApps.toolInfo");
  await assert.rejects(webview.request("mcpAppRequest", { threadId: "first", ...source, appMethod: "filesystem.read", input: {} }), /Unsupported/);
});

test("MCP messages, downloads and external links preserve upstream approvals and restrictions", async () => {
  const client = new FakeTransport(); const sent: string[] = [], saved: string[] = [], opened: string[] = [];
  const port = { ...native, sendMessage: async (text: string) => { sent.push(text); }, saveFile: async (name: string, bytes: Uint8Array) => { saved.push(`${name}:${new TextDecoder().decode(bytes)}`); }, openLink: async (url: string) => { opened.push(url); } };
  await assert.rejects(relayMcpAppRequest(client, scope, app, "ui/message", { text: "hi" }, { ...port, confirm: async () => false }), /Declined/);
  assert.deepEqual(sent, []);
  await relayMcpAppRequest(client, scope, app, "ui/message", { text: "hi" }, port); assert.deepEqual(sent, ["hi"]);
  await relayMcpAppRequest(client, scope, app, "ui/download-file", { files: [{ name: "chart.txt", uri: "data://chart" }] }, port);
  assert.deepEqual(saved, ["chart.txt:fixture"]);
  await assert.rejects(relayMcpAppRequest(client, scope, app, "ui/download-file", { files: [{ name: "../bad", bytes: [1] }] }, port), /name/);
  await relayMcpAppRequest(client, scope, app, "ui/open-link", { url: "https://example.org" }, port);
  await assert.rejects(relayMcpAppRequest(client, scope, app, "ui/open-link", { url: "file:///etc/passwd" }, port), /http/);
  assert.deepEqual(opened, ["https://example.org"]);
});


test("Inherited apps send requests to the source thread and model context to the viewing fork", async (t) => {
  const { host, client, source, item } = await fixture(); t.after(() => host.dispose());
  await host.selectThread("second"); publishText(client, "second", "fork seed");
  const projection = await client.getThreadProjection("second");
  client.threadHandlers.get("second")!({ kind: "snapshot", snapshotSequence: 2, projection: { ...projection, visibleTurnItems: [{ position: 0, visibility: "inherited", sourceThreadId: ThreadId.make("first"), sourceItemId: item.id, item }] } });
  await host.mcpAppRequest("second", source, "ui/update-model-context", { structuredContent: { selected: 1 }, conversationThreadId: "third" }, native);
  assert.deepEqual(client.mcpAppRequests.at(-1)?.input, { threadId: "first", itemId: "app-item", conversationThreadId: "second", structuredContent: { selected: 1 } });
});
