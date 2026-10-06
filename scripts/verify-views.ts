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
import type { FavoriteModel } from "../src/shared/bridge.js";
import { ProviderInstanceId, ProviderDriverKind, RunId } from "@t3tools/contracts";
import { collectAssistantCitations, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";

const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-views-ui";
await mkdir(evidence, { recursive: true });
let preferences = DEFAULT_APPEARANCE;
let favorites: ReadonlyArray<FavoriteModel> = [];
const { host, client } = await viewsHarness({ appearance: () => preferences, favoriteModels: () => favorites, saveFavoriteModels: async (value) => { favorites = value; } });
const firstProvider = client.config.providers[0]!;
const capabilities = { optionDescriptors: [{ id: "reasoningEffort", label: "Effort", type: "select" as const,
  options: [{ id: "high", label: "High" }, { id: "max", label: "Max", isDefault: true }] }] };
client.config = { providers: [
  { ...firstProvider, models: [{ ...firstProvider.models[0]!, capabilities }, { ...firstProvider.models[0]!, slug: "old-kimi", name: "Legacy Kimi", isLegacy: true }] },
  ...["Personal", "Work"].map((name) => ({ ...firstProvider, instanceId: ProviderInstanceId.make(`codex-${name.toLowerCase()}`), driver: ProviderDriverKind.make("codex"), displayName: `Codex ${name}`,
    models: [{ slug: "gpt-6-astra", name: "GPT-6 Astra", isCustom: false, capabilities }] })),
  { ...firstProvider, instanceId: ProviderInstanceId.make("unavailable"), displayName: "Unavailable provider", installed: false, models: [{ ...firstProvider.models[0]!, name: "Unavailable model" }] },
  { ...firstProvider, instanceId: ProviderInstanceId.make("claude"), driver: ProviderDriverKind.make("claudeAgent"), displayName: "Claude", models: [{ slug: "claude-sonnet", name: "Claude Sonnet", isCustom: false, capabilities: { optionDescriptors: [{ id: "effort", type: "select", label: "Effort", promptInjectedValues: ["ultrathink"], options: [{ id: "high", label: "High", isDefault: true }, { id: "ultrathink", label: "Ultrathink" }] }] } }] },
] };
let settingsOpened = 0;
let deleteConfirmed = false;
const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry, async () => { settingsOpened += 1; }, {
  rename: async () => "Renamed through history", confirmDelete: async () => deleteConfirmed,
});
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
let debugPages: Page[] = [];
async function expectFonts(page: Page, expected: AppearanceSettings) {
  await page.waitForFunction((value) => {
    const prompt = document.querySelector("textarea");
    return prompt && getComputedStyle(document.documentElement).fontSize === `${value.fontSizeInterface}px`
      && getComputedStyle(prompt).fontSize === `${value.fontSizePrompt}px`
      && getComputedStyle(document.documentElement).getPropertyValue("--font-size-code").trim() === `${value.fontSizeCode}px`;
  }, expected);
}
async function selectAssistantText(page: Page, text: string) {
  const points = await page.evaluate(`(() => {
    const source = document.querySelector('[data-assistant-citation-source]'); const quote = ${JSON.stringify(text)};
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT); const nodes = []; let node;
    while ((node = walker.nextNode())) if (!node.parentElement?.closest('button, [hidden], [aria-hidden=true]')) nodes.push(node);
    const content = nodes.map((node) => node.data).join(""); const start = content.indexOf(quote); if (start < 0) throw new Error('Quote missing');
    const position = (offset) => { for (const node of nodes) { if (offset < node.length) return { node, offset }; offset -= node.length; } throw new Error('Text position missing'); };
    const point = (offset, edge) => { const at = position(offset); const range = document.createRange(); range.setStart(at.node, at.offset); range.setEnd(at.node, at.offset + 1); const rect = range.getBoundingClientRect(); return { x: edge === 'left' ? rect.left + 0.2 : rect.right - 0.2, y: rect.top + rect.height / 2 }; };
    return { start: point(start, 'left'), end: point(start + quote.length - 1, 'right') };
  })()`) as { start: { x: number; y: number }; end: { x: number; y: number } };
  await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 }); await page.mouse.up();
  await page.getByRole("button", { name: "Cite selection in composer" }).waitFor();
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
    assert.equal(await page.locator(".chat-empty h1").textContent(), "What would you like to build?");
    assert.equal(await page.locator(".project-heading").count(), 1);
    assert.equal(await page.getByText("Outside workspace", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Outside conversation", exact: true }).count(), 0);
    return page;
  }));
  debugPages = pages;
  for (const [index, name] of ["first", "second", "third"].entries()) {
    await pages[index]!.getByRole("button", { name: `${name} conversation`, exact: true }).click();
    await pages[index]!.locator(".chat-heading strong").filter({ hasText: `${name} conversation` }).waitFor();
    publishText(client, name, `Live **reply** in ${name} conversation\n\nInline \`value\`.\n\n\`\`\`ts\nconst value = 42;\n\`\`\``);
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
  await first.getByRole("button", { name: "T3 Code settings", exact: true }).click();
  await first.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "openSettings"));
  assert.equal(settingsOpened, 1); assert.equal(await first.getByRole("dialog").count(), 0);
  preferences = { fontSizeInterface: 20, fontSizePrompt: 18, fontSizeCode: 17 }; host.refreshAppearance();
  await Promise.all(pages.map((page) => expectFonts(page, preferences)));
  for (const page of [second, third]) {
    assert.equal(await page.locator(".markdown p").first().evaluate((element) => getComputedStyle(element).fontSize), "17.5px");
    assert.equal(await page.locator(".markdown pre code").first().evaluate((element) => getComputedStyle(element).fontSize), "17px");
  }
  assert.deepEqual(["tab-one", "tab-two", "tab-three"].map((id) => host.snapshot(id).activeThreadId), selections);
  assert.deepEqual(await Promise.all(pages.map((page) => page.getByRole("textbox", { name: "Message", exact: true }).inputValue())), drafts);
  assert.equal(client.connections, 1); assert.equal(client.threadStarts, subscriptionsBeforeFonts); assert.equal(client.commands.length, commandsBeforeFonts);
  await first.reload(); await expectFonts(first, preferences);
  assert.equal(host.snapshot("tab-one").activeThreadId, selections[0]);
  const sidebar = await browser.newPage({ viewport: { width: 360, height: 820 } });
  sidebar.on("pageerror", (error) => errors.push(error.message));
  await sidebar.goto(`http://127.0.0.1:${address.port}/?view=${SIDEBAR_VIEW_ID}`); await expectFonts(sidebar, preferences);
  assert.equal(await sidebar.locator(".chat-header").count(), 0);
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  preferences = DEFAULT_APPEARANCE; host.refreshAppearance();
  await Promise.all([...pages, sidebar].map((page) => expectFonts(page, preferences)));
  assert.equal(await sidebar.locator(".composer-box select, .composer-box .model-trigger").count(), 0, "Plain selectors must live below the input");
  assert.equal(await sidebar.locator(".composer-box").evaluate((node) => getComputedStyle(node).borderRadius), "4px");
  assert.equal(await sidebar.locator(".model-trigger svg").count(), 1, "Model only needs its dropdown arrow");
  await sidebar.setViewportSize({ width: 170, height: 820 });
  await sidebar.getByLabel("Effort and permissions", { exact: true }).click();
  await sidebar.getByRole("combobox", { name: "Effort level" }).selectOption("high");
  await sidebar.getByRole("combobox", { name: "Permission mode" }).selectOption("auto");
  await sidebar.waitForFunction(() => (document.querySelector('select[aria-label="Effort level"]') as HTMLSelectElement).value === "high");
  assert.equal(await third.getByRole("combobox", { name: "Effort level" }).inputValue(), "max");
  await sidebar.locator(".assistant-message p").first().click();
  assert.equal(await sidebar.locator("details[open]").count(), 0);
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await sidebar.screenshot({ path: `${evidence}/composer-170-light.png` });
  await sidebar.evaluate(() => { document.body.className = "vscode-dark"; });
  await sidebar.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await sidebar.screenshot({ path: `${evidence}/composer-170-dark.png` });
  await sidebar.setViewportSize({ width: 360, height: 820 });
  await sidebar.waitForFunction(() => !document.querySelector(".composer-options-overflow"));
  assert.equal(await sidebar.getByRole("combobox", { name: "Effort level" }).inputValue(), "high");
  console.log("PASS: footer selectors remain outside the compact input, narrow overflow retains model/effort/permission settings and closes outside; light and dark layouts fit.");
  await sidebar.close();
  // The quote spans bold and plain DOM nodes; native mouse selection captures rendered positions.
  await selectAssistantText(second, "reply in second conversation");
  await second.getByRole("button", { name: "Cite selection in composer" }).click();
  await second.getByRole("textbox", { name: "Comment on selected text" }).fill("Explain why this stays in the second tab.");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await second.getByRole("button", { name: "Assistant quote · Comment", exact: true }).waitFor();
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in second tab");
  assert.equal(await first.locator(".context-chip").count(), 0); assert.equal(await third.locator(".context-chip").count(), 0);
  await second.getByRole("button", { name: "third conversation", exact: true }).click();
  await second.locator(".chat-heading strong").filter({ hasText: "third conversation" }).waitFor();
  assert.equal(await second.locator(".context-chip").count(), 0);
  await second.getByRole("button", { name: "second conversation", exact: true }).click();
  await second.getByRole("button", { name: "Assistant quote · Comment", exact: true }).click();
  await second.getByRole("textbox", { name: "Comment on selected text" }).fill("Changed comment");
  await second.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok((await second.locator(".context-label").getAttribute("title"))?.includes("Explain why"));
  await second.getByRole("button", { name: "Assistant quote · Comment", exact: true }).click();
  await second.getByRole("textbox", { name: "Comment on selected text" }).fill("Updated comment");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  registry.postWhenReady("tab-two", Events.insertReference, { draftKey: "second", reference: { type: "file", uri: "file:///tmp/t3-vscode/example.ts", path: "/tmp/t3-vscode/example.ts", label: "example.ts", range: { start: { line: 5, column: 3 }, end: { line: 8, column: 1 } }, text: "unsaved selected text" } });
  await second.getByRole("button", { name: "@example.ts:5-7", exact: true }).waitFor();
  assert.equal(await first.locator(".context-chip").count(), 0); assert.equal(await third.locator(".context-chip").count(), 0);
  await second.getByRole("button", { name: "Send message", exact: true }).click();
  await second.waitForFunction(() => document.querySelectorAll(".context-chip").length === 0 && (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value === "");
  const message = client.commands.findLast((command) => command.type === "message.dispatch"); assert.ok(message);
  assert.equal(message.threadId, "second"); assert.ok(message.text.includes("unsaved selected text")); assert.ok(message.text.includes("5:3–8:1 (end exclusive)"));
  const citation = collectAssistantCitations(message.text)[0]?.citation; assert.ok(citation);
  assert.equal(citation.threadId, "second"); assert.equal(citation.environmentId, "audit"); assert.equal(citation.messageId, "message");
  assert.equal(citation.text, "reply in second conversation"); assert.equal(citation.comment, "Updated comment");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in third tab");
  await second.getByRole("textbox", { name: "Message", exact: true }).fill("Draft after sending references");
  // Global search crosses provider instances, while effort changes stay with this conversation.
  await second.getByRole("button", { name: "Choose model", exact: true }).click();
  await second.getByRole("textbox", { name: "Search models" }).fill("personal asra");
  await second.getByRole("button", { name: "Favorite GPT-6 Astra", exact: true }).click();
  await second.getByRole("button", { name: "Unfavorite GPT-6 Astra", exact: true }).waitFor();
  await second.getByRole("textbox", { name: "Search models" }).press("ArrowDown");
  await second.keyboard.press("Enter");
  await second.getByRole("button", { name: "Choose model", exact: true }).filter({ hasText: "GPT-6 Astra" }).waitFor();
  await second.getByRole("combobox", { name: "Effort level" }).selectOption("high");
  await second.waitForFunction(() => (document.querySelector('select[aria-label="Effort level"]') as HTMLSelectElement).value === "high");
  assert.deepEqual(host.snapshot("tab-two").threads.find((thread) => thread.id === "second")?.modelSelection, { instanceId: "codex-personal", model: "gpt-6-astra", options: [{ id: "reasoningEffort", value: "high" }] });
  assert.equal(await third.getByRole("combobox", { name: "Effort level" }).inputValue(), "max");
  assert.equal(await second.getByRole("combobox", { name: "Interaction mode" }).count(), 0);
  await third.getByRole("button", { name: "Choose model", exact: true }).click();
  await third.locator('.model-providers button[aria-pressed="true"]').filter({ hasText: "Favorites" }).waitFor();
  await third.getByRole("button", { name: "GPT-6 Astra", exact: true }).waitFor();
  await third.getByRole("button", { name: "All providers", exact: true }).click();
  assert.equal(await third.getByRole("button", { name: "Legacy Kimi", exact: true }).count(), 0);
  await third.getByRole("checkbox", { name: "Show legacy models" }).check();
  await third.getByRole("button", { name: "Legacy Kimi", exact: true }).waitFor();
  assert.equal(await third.getByRole("button", { name: "Unavailable model", exact: true }).isDisabled(), true);
  await third.keyboard.press("Escape");
  assert.equal(await third.getByRole("dialog").count(), 0);
  await third.getByRole("button", { name: "Choose model", exact: true }).click();
  await third.getByRole("textbox", { name: "Search models" }).fill("claude");
  await third.getByRole("button", { name: "Claude Sonnet", exact: true }).click();
  await third.getByRole("combobox", { name: "Effort level" }).selectOption("ultrathink");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Ultrathink:\nDraft in third tab");
  assert.equal(await third.getByRole("combobox", { name: "Effort level" }).inputValue(), "ultrathink");
  assert.ok(!client.commands.some((command) => command.type === "thread.model-selection.set" && command.modelSelection.options?.some((option) => option.value === "ultrathink")));
  await third.getByRole("combobox", { name: "Effort level" }).selectOption("high");
  await third.waitForFunction(() => (document.querySelector('select[aria-label="Effort level"]') as HTMLSelectElement).value === "high");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in third tab");
  publishText(client, "third", `Saved source: ${serializeAssistantCitation(citation)}`, 2);
  await third.getByRole("button", { name: "Assistant quote", exact: true }).click();
  await third.getByRole("dialog", { name: "Saved assistant quote" }).waitFor();
  await third.getByRole("button", { name: "Open source", exact: true }).click();
  await third.locator(".chat-heading strong").filter({ hasText: "second conversation" }).waitFor();
  await third.waitForFunction(() => CSS.highlights?.has("t3-assistant-citation"));
  assert.equal(host.snapshot("tab-two").activeThreadId, "second"); assert.equal(host.snapshot("tab-three").activeThreadId, "second");
  await third.getByRole("textbox", { name: "Message", exact: true }).focus();
  await third.waitForFunction(() => !CSS.highlights?.has("t3-assistant-citation"));
  await third.getByRole("button", { name: "third conversation", exact: true }).click();
  await third.locator(".chat-heading strong").filter({ hasText: "third conversation" }).waitFor();
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in third tab");
  console.log("PASS: mouse-selected assistant quotes across inline formatting, optional comments, cancel/edit, independent draft contexts, scoped file references and exact send payloads; provider-instance search, favorites, keyboard selection, effort, legacy and unavailable models.");
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `${evidence}/tab-${index + 1}.png` });
  await first.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await first.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "reconnect"));
  await second.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  assert.equal(await second.locator(".chat-heading strong").textContent(), "second conversation");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft after sending references");
  assert.equal(client.connections, 2); assert.equal(client.shellStarts, 2);
  await first.close(); registry.remove("tab-one"); await host.removeView("tab-one");
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  assert.equal(host.snapshot("tab-three").activeThreadId, "third");
  const contextTarget = second.getByRole("button", { name: "third conversation", exact: true });
  await contextTarget.click({ button: "right" });
  await second.getByRole("menuitem", { name: "Pin thread", exact: true }).click();
  await second.waitForFunction(() => document.querySelector('[data-thread-id="third"] svg.lucide-pin'));
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  await contextTarget.focus(); await contextTarget.press("Shift+F10");
  await second.getByRole("menuitem", { name: "Rename thread", exact: true }).waitFor();
  await second.keyboard.press("Escape"); assert.equal(await contextTarget.evaluate((node) => document.activeElement === node), true);
  await contextTarget.click({ button: "right" });
  await second.getByRole("menuitem", { name: "Rename thread", exact: true }).click();
  await second.getByRole("button", { name: "Renamed through history", exact: true }).waitFor();
  assert.equal(await third.locator(".chat-heading strong").textContent(), "Renamed through history");
  publishText(client, "third", "Response with a persisted run for forking", 3, { runId: RunId.make("fork-run") });
  await third.getByRole("button", { name: "Fork from this response", exact: true }).click();
  await third.locator(".chat-heading strong").filter({ hasText: "Fork of Renamed through history" }).waitFor();
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft after sending references");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "");
  await third.getByText("Response with a persisted run for forking", { exact: true }).waitFor();
  const childId = host.snapshot("tab-three").activeThreadId!;
  const completedBeforeDelete = await third.evaluate(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.filter((entry) => entry.method === "threadAction").length);
  await third.getByRole("button", { name: "Thread actions", exact: true }).click();
  await third.getByRole("menuitem", { name: "Delete thread", exact: true }).click();
  await third.waitForFunction((count) => (window as unknown as { __completed: Array<{ method: string }> }).__completed.filter((entry) => entry.method === "threadAction").length > count, completedBeforeDelete);
  assert.equal(host.snapshot("tab-three").activeThreadId, childId, "Cancelled delete keeps the conversation");
  deleteConfirmed = true;
  await third.getByRole("button", { name: "Thread actions", exact: true }).click();
  await third.getByRole("menuitem", { name: "Delete thread", exact: true }).click();
  await third.locator(".chat-heading strong").filter({ hasText: "New conversation" }).waitFor();
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  assert.equal(client.threadHandlers.has(childId), false);
  console.log("PASS: right-click and keyboard history menus target their row, native rename/cancelled delete preserve selections; response fork inherits history only in its own tab; confirmed delete releases the child's projection.");
  assert.deepEqual(errors, []);
  console.log("PASS: independent conversations and drafts, workspace scope, streaming, reconnect and closing; native settings, shared live preferences, renderer reload, reset, external edits and narrow sidebar.");
  console.log(`Screenshots: ${evidence}`);
} catch (error) {
  console.error("Browser errors:", errors);
  if (debugPages[2]) {
    console.error(await debugPages[2].evaluate(() => ({ thread: document.querySelector(".chat-main")?.getAttribute("data-thread-id"), notice: document.querySelector(".citation-source-notice")?.textContent,
      sources: [...document.querySelectorAll<HTMLElement>("[data-assistant-citation-source]")].map((source) => ({ data: { ...source.dataset }, text: source.textContent, visible: source.getBoundingClientRect().height })), highlights: [...CSS.highlights.keys()] })));
    await debugPages[2].screenshot({ path: `${evidence}/citation-source-failure.png` });
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  await host.dispose();
}
