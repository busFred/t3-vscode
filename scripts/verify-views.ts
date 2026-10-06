/** Built webview + real HostState/BridgeHandler, shared across three pages; no VS Code launch or live T3 service. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { chromium, type Page } from "playwright-core";
import { BridgeHandler, WebviewRegistry } from "../src/host/bridge.js";
import { SIDEBAR_VIEW_ID } from "../src/host/hostState.js";
import { FakeWebview } from "../src/host/testing/fakeWebview.js";
import { viewsHarness, publishText } from "../src/host/testing/fakeTransport.js";
import { Events, type RpcMessage } from "../src/shared/bridge.js";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "../src/shared/appearance.js";

const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-views-ui";
await mkdir(evidence, { recursive: true });
let preferences = DEFAULT_APPEARANCE;
const { host, client } = await viewsHarness({ appearance: () => preferences, saveAppearance: async (update) => {
  preferences = { ...preferences, ...update };
} });
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
      <body class="vscode-light" data-surface="${id === SIDEBAR_VIEW_ID ? "sidebar" : "panel"}"><div id="root"></div><script>
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
async function expectFonts(page: Page, expected: AppearanceSettings) {
  await page.waitForFunction((value) => {
    const prompt = document.querySelector("textarea");
    return prompt && getComputedStyle(document.documentElement).fontSize === `${value.fontSizeInterface}px`
      && getComputedStyle(prompt).fontSize === `${value.fontSizePrompt}px`
      && getComputedStyle(document.documentElement).getPropertyValue("--font-size-code").trim() === `${value.fontSizeCode}px`;
  }, expected);
}
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
    publishText(client, name, `Live reply in ${name} conversation\n\nInline \`value\`.\n\n\`\`\`ts\nconst value = 42;\n\`\`\``);
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

  // Preferences are shared; conversation navigation, composer drafts and the server connection are not changed.
  const selections = ["tab-one", "tab-two", "tab-three"].map((id) => host.snapshot(id).activeThreadId);
  const subscriptionsBeforeFonts = client.threadStarts; const commandsBeforeFonts = client.commands.length;
  const drafts = await Promise.all(pages.map((page) => page.getByRole("textbox", { name: "Message", exact: true }).inputValue()));
  await first.getByRole("button", { name: "Font settings", exact: true }).click();
  const dialog = first.getByRole("dialog", { name: "Font settings", exact: true });
  await dialog.getByRole("combobox", { name: "Interface font size", exact: false }).selectOption("20");
  await dialog.getByRole("combobox", { name: "Prompt font size", exact: false }).selectOption("18");
  await dialog.getByRole("combobox", { name: "Code font size", exact: false }).selectOption("17");
  await Promise.all(pages.map((page) => expectFonts(page, { fontSizeInterface: 20, fontSizePrompt: 18, fontSizeCode: 17 })));
  for (const page of [second, third]) {
    assert.equal(await page.locator(".markdown p").first().evaluate((element) => getComputedStyle(element).fontSize), "17.5px");
    assert.equal(await page.locator(".markdown pre code").first().evaluate((element) => getComputedStyle(element).fontSize), "17px");
    assert.equal(await page.locator(".markdown p code").first().evaluate((element) => getComputedStyle(element).fontSize), "15.75px");
  }
  assert.deepEqual(["tab-one", "tab-two", "tab-three"].map((id) => host.snapshot(id).activeThreadId), selections);
  assert.deepEqual(await Promise.all(pages.map((page) => page.getByRole("textbox", { name: "Message", exact: true }).inputValue())), drafts);
  assert.equal(client.connections, 1); assert.equal(client.threadStarts, subscriptionsBeforeFonts); assert.equal(client.commands.length, commandsBeforeFonts);
  await first.screenshot({ path: `${evidence}/font-settings-editor.png` });
  await first.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await first.getByRole("button", { name: "Font settings", exact: true }).evaluate((element) => document.activeElement === element), true);
  await first.reload(); await expectFonts(first, preferences);
  assert.equal(host.snapshot("tab-one").activeThreadId, selections[0]);

  const sidebar = await browser.newPage({ viewport: { width: 360, height: 820 } });
  sidebar.on("pageerror", (error) => errors.push(error.message));
  await sidebar.goto(`http://127.0.0.1:${address.port}/?view=${SIDEBAR_VIEW_ID}`);
  await expectFonts(sidebar, preferences);
  assert.equal(await sidebar.locator(".chat-header").count(), 0);
  await views.get(SIDEBAR_VIEW_ID)!.webview.postMessage({ event: Events.showAppearance });
  const sidebarDialog = sidebar.getByRole("dialog", { name: "Font settings", exact: true }); await sidebarDialog.waitFor();
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await sidebar.screenshot({ path: `${evidence}/font-settings-sidebar.png` });
  await sidebarDialog.getByRole("button", { name: "Reset font sizes", exact: true }).click();
  await Promise.all([...pages, sidebar].map((page) => expectFonts(page, DEFAULT_APPEARANCE)));
  assert.deepEqual(preferences, DEFAULT_APPEARANCE);
  preferences = { fontSizeInterface: 20, fontSizePrompt: 20, fontSizeCode: 18 }; host.refreshAppearance();
  await Promise.all([...pages, sidebar].map((page) => expectFonts(page, preferences)));
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await sidebarDialog.getByRole("button", { name: "Done", exact: true }).click(); await sidebarDialog.waitFor({ state: "hidden" });
  assert.equal(await sidebar.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "");
  assert.deepEqual(await Promise.all([second, third].map((page) => page.getByRole("textbox", { name: "Message", exact: true }).inputValue())), drafts.slice(1));
  await sidebar.close();
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
  console.log("PASS: independent conversations and drafts, workspace scope, streaming, reconnect and closing; font dialog, shared live preferences, renderer reload, reset, external edits and narrow sidebar.");
  console.log(`Screenshots: ${evidence}`);
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  await host.dispose();
}
