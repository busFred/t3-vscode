/** Built webview + real HostState/BridgeHandler, shared across three pages; no VS Code launch or live T3 service. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { chromium } from "playwright-core";
import { BridgeHandler, WebviewRegistry } from "../src/host/bridge.js";
import { SIDEBAR_VIEW_ID } from "../src/host/hostState.js";
import { FakeWebview } from "../src/host/testing/fakeWebview.js";
import { viewsHarness, publishText } from "../src/host/testing/fakeTransport.js";
import type { RpcMessage } from "../src/shared/bridge.js";

const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-views-ui";
await mkdir(evidence, { recursive: true });
const { host, client } = await viewsHarness();
const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry);
const views = new Map<string, FakeWebview>(); const sinks = new Map<string, Set<ServerResponse>>();
for (const id of [SIDEBAR_VIEW_ID, "tab-one", "tab-two", "tab-three"]) {
  if (id !== SIDEBAR_VIEW_ID) host.registerView(id);
  const view = new FakeWebview(); const listeners = new Set<ServerResponse>();
  view.onPostMessage = (message) => {
    if (typeof message === "object" && message !== null && "event" in message) {
      for (const response of listeners) response.write(`data: ${JSON.stringify(message)}\n\n`);
    }
  };
  views.set(id, view); sinks.set(id, listeners);
  registry.add(id, view.webview); bridge.attach(view.webview, id);
}
host.onDidChangeState(() => bridge.pushState());
const bundle = await readFile(new URL("../dist/webview.js", import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    const id = url.searchParams.get("view") ?? "tab-one";
    const view = views.get(id);
    if (!view) { response.writeHead(404); response.end(); return; }
    if (url.pathname === "/webview.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle); return; }
    if (url.pathname === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(": connected\n\n"); sinks.get(id)!.add(response);
      request.on("close", () => sinks.get(id)!.delete(response)); return;
    }
    if (url.pathname === "/rpc" && request.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await view.receive(JSON.parse(Buffer.concat(chunks).toString()) as RpcMessage);
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result)); return;
    }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body class="vscode-light" data-surface="panel"><div id="root"></div><script>
      const viewId = ${JSON.stringify(id)}; window.__completed = [];
      window.acquireVsCodeApi = () => ({ postMessage: (message) => {
        fetch('/rpc?view=' + viewId, { method: 'POST', body: JSON.stringify(message) }).then(response => response.json()).then(data => {
          window.__completed.push({ method: message.method, data });
          window.dispatchEvent(new MessageEvent('message', { data }));
        });
      }, getState: () => undefined, setState: () => {} });
      new EventSource('/events?view=' + viewId).onmessage = event => window.dispatchEvent(new MessageEvent('message', { data: JSON.parse(event.data) }));
      </script><script src="/webview.js?view=${id}"></script></body></html>`);
  } catch (cause) { response.writeHead(500); response.end(String(cause)); }
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const pages = await Promise.all(["tab-one", "tab-two", "tab-three"].map(async (id) => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 850 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${address.port}/?view=${id}`);
    await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
    assert.equal(await page.locator(".chat-heading strong").textContent(), "New conversation");
    assert.equal(await page.locator(".project-heading").count(), 1);
    assert.equal(await page.getByText("Outside workspace", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Outside conversation", exact: true }).count(), 0);
    return page;
  }));
  for (const [index, name] of ["first", "second", "third"].entries()) {
    await pages[index]!.getByRole("button", { name: `${name} conversation`, exact: true }).click();
    await pages[index]!.locator(".chat-heading strong").filter({ hasText: `${name} conversation` }).waitFor();
    publishText(client, name, `Live reply in ${name} conversation`);
    await pages[index]!.getByText(`Live reply in ${name} conversation`, { exact: true }).waitFor();
    await pages[index]!.getByRole("textbox", { name: "Message", exact: true }).fill(`Draft in ${name} tab`);
  }
  const [first, second, third] = pages; assert.ok(first && second && third);
  await first.getByRole("button", { name: "third conversation", exact: true }).click();
  await first.locator(".chat-heading strong").filter({ hasText: "third conversation" }).waitFor();
  assert.equal(await first.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "");
  assert.equal(await second.locator(".chat-heading strong").textContent(), "second conversation");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in second tab");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in third tab");
  await first.getByRole("button", { name: "first conversation", exact: true }).click();
  await first.locator(".chat-heading strong").filter({ hasText: "first conversation" }).waitFor();
  assert.equal(await first.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in first tab");
  await first.locator(".chat-header").getByRole("button", { name: "New thread", exact: true }).click();
  await first.locator(".chat-heading strong").filter({ hasText: "New thread" }).waitFor();
  assert.deepEqual([host.snapshot("tab-two").activeThreadId, host.snapshot("tab-three").activeThreadId], ["second", "third"]);
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `${evidence}/tab-${index + 1}.png` });
  await first.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await first.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "reconnect"));
  await second.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  assert.equal(await second.locator(".chat-heading strong").textContent(), "second conversation");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in second tab");
  assert.equal(client.connections, 2); assert.equal(client.shellStarts, 2);
  await first.close(); registry.remove("tab-one"); await host.removeView("tab-one");
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  assert.equal(host.snapshot("tab-three").activeThreadId, "third");
  assert.deepEqual(errors, []);
  console.log("PASS: three built webviews independently select, stream, keep drafts, create threads, reconnect and close; unrelated projects hidden.");
  console.log(`Screenshots: ${evidence}`);
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  await host.dispose();
}
