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
import { ProviderInstanceId, ProviderDriverKind, RunId, ThreadId, ProjectId, RuntimeRequestId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { v2Now } from "../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { collectAssistantCitations, serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { publishTurn, turnPatch } from "../src/host/testing/turnFixture.js";
import { publishActivity } from "../src/host/testing/activityFixture.js";
import type { TurnDiff } from "../src/host/turnDiff.js";

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
let renamesRequested = 0;
let deleteConfirmed = false;
const openedSessions: Array<string | undefined> = [];
const openedDiffs: Array<{ turn: number; path: string; old: string; current: string }> = [];
const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry, async () => { settingsOpened += 1; }, {
  rename: async () => { renamesRequested += 1; return "Renamed through history"; }, confirmDelete: async () => deleteConfirmed,
}, async (diff: TurnDiff, load, path) => { const file = diff.files.find((file) => path === undefined || file.newPath === path)!; const result = await load(file); openedDiffs.push({ turn: diff.turnNumber, path: file.newPath, old: result.oldContents, current: result.newContents }); }, { openInTab: (id) => { openedSessions.push(host.snapshot(id).activeThreadId); }, showUsage: (_id, key) => { registry.postWhenReady(SIDEBAR_VIEW_ID, Events.showUsage, key); } });
const views = new Map<string, FakeWebview>(); const sinks = new Map<string, Set<ServerResponse>>();
for (const id of [SIDEBAR_VIEW_ID, "tab-one", "tab-two", "tab-three", "tab-narrow"]) {
  if (id !== SIDEBAR_VIEW_ID) host.registerView(id);
  const view = new FakeWebview(); const listeners = new Set<ServerResponse>();
  view.onPostMessage = (message) => {
    if (typeof message === "object" && message !== null && "event" in message) {
      for (const response of listeners) response.write(`data: ${JSON.stringify(message)}\n\n`);
    }
  };
  views.set(id, view); sinks.set(id, listeners);
  registry.add(id, view.webview, id !== SIDEBAR_VIEW_ID); bridge.attach(view.webview, id);
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
async function checkSessionFind(second: Page, third: Page, selectInView: (page: Page, id: string) => Promise<void>) {
  // Search pages older history separately and reveals one result without replacing the draft.
  await selectInView(second, "first");
  await selectInView(third, "second");
  await second.getByRole("textbox", { name: "Message", exact: true }).fill("Keep my search draft");
  publishText(client, "first", "Rate rate rates $\\eta=0.01$", 60);
  const searchProjection = await client.getThreadProjection("first"), seed = searchProjection.visibleTurnItems[0]!;
  if (seed.item.type !== "assistant_message") throw new Error("Expected message fixture");
  const oldId = TurnItemId.make("search-old-command");
  const oldRow = { ...seed, sourceItemId: oldId, position: 0, item: { ...seed.item, id: oldId, type: "command_execution" as const, title: "Training output", input: "train model", output: "rate 0.01", ordinal: 0, exitCode: 0 } };
  client.getHistory = async () => ({ snapshotSequence: 61, items: [oldRow], hasMoreHistory: false, nextCursor: null });
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 61, projection: searchProjection, hasMoreHistory: true, historyCursor: "older-search" });
  await second.getByRole("button", { name: "Find in session", exact: true }).click();
  await second.getByRole("textbox", { name: "Find in this session", exact: true }).fill("rate");
  await second.getByText("Entire session searched", { exact: true }).waitFor();
  assert.equal(await second.locator(".session-find").count(), 1, "Search and composer must retain distinct React identities across host updates");
  assert.equal(await second.locator(".find-count").textContent(), "1 / 4");
  assert.equal(await third.locator(".session-find").count(), 0);
  await second.getByRole("button", { name: "Next match", exact: true }).click();
  await second.locator(".session-match-row .tool-output").filter({ hasText: "rate 0.01" }).waitFor();
  await second.waitForFunction(() => CSS.highlights.has("t3-session-match"));
  await second.getByRole("button", { name: "Whole word", exact: true }).click();
  await second.waitForFunction(() => document.querySelector(".find-count")?.textContent === "1 / 3");
  await second.getByRole("button", { name: "Match case", exact: true }).click();
  await second.waitForFunction(() => document.querySelector(".find-count")?.textContent === "1 / 2");
  await second.getByRole("combobox", { name: "Search content", exact: true }).selectOption("messages");
  await second.waitForFunction(() => document.querySelector(".find-count")?.textContent === "1 / 1");
  await second.getByRole("textbox", { name: "Find in this session", exact: true }).fill("\\eta");
  await second.waitForFunction(() => document.querySelector(".find-count")?.textContent === "1 / 1");
  await second.getByRole("button", { name: "Next match", exact: true }).click();
  await second.locator(".session-match-row .assistant-message").waitFor();
  await second.getByRole("button", { name: "Close session search", exact: true }).click();
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Keep my search draft");
  await second.waitForFunction(() => !CSS.highlights.has("t3-session-match"));
  await second.getByRole("textbox", { name: "Message", exact: true }).press("Control+f");
  await second.getByRole("textbox", { name: "Find in this session", exact: true }).waitFor();
  await second.getByRole("textbox", { name: "Find in this session", exact: true }).press("Escape");
  assert.equal(await second.locator(".session-find").count(), 0);
  const renamesBefore = renamesRequested;
  await second.locator(".chat-heading strong").dblclick();
  await second.locator(".chat-heading strong").filter({ hasText: "Renamed through history" }).waitFor();
  assert.equal(renamesRequested, renamesBefore + 1);
  assert.equal(host.snapshot("tab-three").activeThreadId, "second");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Keep my search draft");
  await second.screenshot({ path: `${evidence}/session-search-preserved-draft.png` });
  console.log("PASS: full-session search, case/word/content filters, older command reveal and highlight, math source lookup, keyboard find and double-click renaming preserve per-tab state and drafts.");
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
    assert.equal(await page.locator(".projects-sidebar").count(), 0);
    assert.equal(await page.locator(".project-heading").count(), 0);
    assert.equal(await page.getByText("Outside workspace", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Outside conversation", exact: true }).count(), 0);
    return page;
  }));
  debugPages = pages;
  const manager = await browser.newPage({ viewport: { width: 360, height: 820 } });
  manager.on("pageerror", (error) => errors.push(error.message));
  await manager.goto(`http://127.0.0.1:${address.port}/?view=${SIDEBAR_VIEW_ID}`);
  await manager.locator(".dedicated-sessions").waitFor();
  assert.equal(await manager.locator(".sidebar-modes, textarea, .chat-header").count(), 0);
  assert.equal(await manager.locator(".account-usage > summary").textContent(), "ACCOUNT & USAGE");
  await manager.getByRole("button", { name: "first conversation", exact: true }).click();
  await manager.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "openInTab"));
  assert.deepEqual(openedSessions, ["first"]);
  const selectInView = async (page: Page, threadId: string) => {
    await host.selectThread(threadId, new URL(page.url()).searchParams.get("view")!);
    await page.waitForFunction(id => document.querySelector('.chat-main')?.getAttribute('data-thread-id') === id, threadId);
  };
  if (!process.argv.includes("--search-only")) {
  for (const [index, name] of ["first", "second", "third"].entries()) {
    await selectInView(pages[index]!, name);
    await pages[index]!.locator(".chat-heading strong").filter({ hasText: `${name} conversation` }).waitFor();
    publishText(client, name, `Live **reply** in ${name} conversation\n\nInline \`value\`.\n\n\`\`\`ts\nconst value = 42;\n\`\`\``);
    await pages[index]!.getByText(`Live reply in ${name} conversation`, { exact: true }).waitFor();
    await pages[index]!.getByRole("textbox", { name: "Message", exact: true }).fill(`Draft in ${name} tab`);
  }
  const [first, second, third] = pages; assert.ok(first && second && third);
  await selectInView(first, "third");
  await first.locator(".chat-heading strong").filter({ hasText: "third conversation" }).waitFor();
  assert.equal(await first.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "");
  assert.equal(await second.locator(".chat-heading strong").textContent(), "second conversation");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in second tab");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in third tab");
  await selectInView(first, "first");
  await first.locator(".chat-heading strong").filter({ hasText: "first conversation" }).waitFor();
  assert.equal(await first.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in first tab");
  await host.newThread(undefined, "tab-one");
  await first.locator(".chat-heading strong").filter({ hasText: "New thread" }).waitFor();
  assert.deepEqual([host.snapshot("tab-two").activeThreadId, host.snapshot("tab-three").activeThreadId], ["second", "third"]);

  // Preferences are shared; conversation navigation, composer drafts and the server connection are not changed.
  const selections = ["tab-one", "tab-two", "tab-three"].map((id) => host.snapshot(id).activeThreadId);
  const subscriptionsBeforeFonts = client.threadStarts; const commandsBeforeFonts = client.commands.length;
  const drafts = await Promise.all(pages.map((page) => page.getByRole("textbox", { name: "Message", exact: true }).inputValue()));
  await manager.getByRole("button", { name: "T3 VSCode settings", exact: true }).click();
  await manager.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "openSettings"));
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
  const sidebar = manager;
  assert.equal(await sidebar.locator(".account-usage").evaluate((element) => (element as HTMLDetailsElement).open), false);
  const originalShell = client.shell;
  client.shell = { ...client.shell, threads: client.shell.threads.map((thread) => thread.id === "second" ? { ...thread, pendingRuntimeRequest: { id: RuntimeRequestId.make("browser-input"), kind: "user_input", createdAt: v2Now } } : thread.id === "third" ? { ...thread, status: "running", activityRunStartedAt: DateTime.makeUnsafe(new Date(Date.now() - 20 * 60_000).toISOString()) } : thread) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  await sidebar.locator('[data-thread-id="second"] .thread-input').waitFor();
  await sidebar.locator('[data-thread-id="third"] .thread-working time').waitFor();
  assert.equal(await sidebar.locator('.thread-working svg').evaluate((node) => getComputedStyle(node).animationName), "none");
  assert.equal(await sidebar.locator('.thread .provider-icon').first().evaluate((node) => node.getBoundingClientRect().width), 12);
  assert.equal(await sidebar.locator('.thread-input svg').first().evaluate((node) => node.getBoundingClientRect().width), 13);
  assert.equal(await sidebar.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await sidebar.screenshot({ path: `${evidence}/sessions-input-working.png` });
  client.shell = originalShell; client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const narrowChat = await browser.newPage({ viewport: { width: 360, height: 820 } });
  await narrowChat.goto(`http://127.0.0.1:${address.port}/?view=tab-narrow`);
  await selectInView(narrowChat, "first");
  await narrowChat.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await expectFonts(narrowChat, preferences);
  assert.equal(await narrowChat.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  preferences = DEFAULT_APPEARANCE; host.refreshAppearance();
  await Promise.all([...pages, narrowChat].map((page) => expectFonts(page, preferences)));
  assert.equal(await narrowChat.locator(".composer-box select, .composer-box .model-trigger").count(), 0, "Plain selectors must live below the input");
  assert.equal(await narrowChat.locator(".composer-box").evaluate((node) => getComputedStyle(node).borderRadius), "3px");
  assert.equal(await narrowChat.locator(".model-trigger svg").count(), 1, "Model only needs its dropdown arrow");
  await narrowChat.setViewportSize({ width: 170, height: 820 });
  await narrowChat.getByLabel("Effort and permissions", { exact: true }).click();
  await narrowChat.getByRole("combobox", { name: "Effort level" }).selectOption("high");
  await narrowChat.getByRole("combobox", { name: "Permission mode" }).selectOption("auto");
  await narrowChat.waitForFunction(() => (document.querySelector('select[aria-label="Effort level"]') as HTMLSelectElement).value === "high");
  assert.equal(await third.getByRole("combobox", { name: "Effort level" }).inputValue(), "max");
  await narrowChat.locator(".assistant-message p").first().click();
  assert.equal(await narrowChat.locator("details[open]").count(), 0);
  assert.equal(await narrowChat.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await narrowChat.screenshot({ path: `${evidence}/composer-170-light.png` });
  await narrowChat.evaluate(() => {
    document.body.className = "vscode-dark";
    const vars = { 'editor-background': '#1f1f1f', foreground: '#cccccc', 'sideBar-background': '#181818', 'input-background': '#313131', 'input-foreground': '#cccccc', 'descriptionForeground': '#9da5b4', 'textLink-foreground': '#4daafc', 'panel-border': '#444444', 'input-border': '#666666' };
    for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--vscode-${key}`, value);
  });
  await narrowChat.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await narrowChat.screenshot({ path: `${evidence}/composer-170-dark.png` });
  await narrowChat.setViewportSize({ width: 360, height: 820 });
  await narrowChat.waitForFunction(() => !document.querySelector(".composer-options-overflow"));
  assert.equal(await narrowChat.getByRole("combobox", { name: "Effort level" }).inputValue(), "high");
  console.log("PASS: footer selectors remain outside the compact input, narrow overflow retains model/effort/permission settings and closes outside; light and dark layouts fit.");
  await narrowChat.close();
  // The quote spans bold and plain DOM nodes; native mouse selection captures rendered positions.
  const quoteInput = second.getByRole("textbox", { name: "Message", exact: true });
  await quoteInput.fill("Before replace after.");
  await quoteInput.press("Home");
  for (let index = 0; index < 7; index++) await quoteInput.press("ArrowRight");
  for (let index = 0; index < 7; index++) await quoteInput.press("Shift+ArrowRight");
  await selectAssistantText(second, "reply in second conversation");
  await second.getByRole("button", { name: "Cite selection in composer" }).click();
  await second.getByRole("textbox", { name: "Comment on selected text" }).fill("Explain why this stays in the second tab.");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await second.getByRole("button", { name: "Assistant quote · Comment", exact: true }).waitFor();
  const inlineText = await quoteInput.inputValue();
  const quoteReference = collectComposerContextReferences(inlineText)[0]!;
  assert.equal(quoteReference.kind, "assistant-quote");
  assert.equal(inlineText.slice(0, quoteReference.start), "Before ");
  assert.equal(inlineText.slice(quoteReference.end), " after.");
  await second.waitForFunction(cursor => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.selectionStart === cursor, quoteReference.end);
  assert.equal(await first.locator(".context-chip").count(), 0); assert.equal(await third.locator(".context-chip").count(), 0);
  await selectInView(second, "third");
  await second.locator(".chat-heading strong").filter({ hasText: "third conversation" }).waitFor();
  assert.equal(await second.locator(".context-chip").count(), 0);
  await selectInView(second, "second");
  assert.equal(await quoteInput.inputValue(), inlineText);
  await quoteInput.evaluate((input, position) => { (input as HTMLTextAreaElement).setSelectionRange(position, position); input.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, quoteReference.start + 3);
  await second.getByRole("textbox", { name: "Comment on selected text" }).fill("Changed comment");
  await second.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok((await second.locator(".context-label").getAttribute("title"))?.includes("Explain why"));
  await second.getByRole("button", { name: "Assistant quote · Comment", exact: true }).click();
  await second.getByRole("textbox", { name: "Comment on selected text" }).fill("Updated comment");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await quoteInput.focus(); await quoteInput.press("Control+End");
  registry.postWhenReady("tab-two", Events.insertReference, { draftKey: "second", reference: { type: "file", uri: "file:///tmp/t3-vscode/example.ts", path: "/tmp/t3-vscode/example.ts", label: "example.ts", range: { start: { line: 5, column: 3 }, end: { line: 8, column: 1 } }, text: "unsaved selected text" } });
  await second.getByRole("button", { name: "@example.ts:5-7", exact: true }).waitFor();
  assert.equal(await quoteInput.inputValue(), inlineText + " @example.ts:5-7 ");
  assert.equal(await first.locator(".context-chip").count(), 0); assert.equal(await third.locator(".context-chip").count(), 0);
  await second.getByRole("button", { name: "Send message", exact: true }).click();
  await second.waitForFunction(() => document.querySelectorAll(".context-chip").length === 0 && (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value === "");
  const message = client.commands.findLast((command) => command.type === "message.dispatch"); assert.ok(message);
  assert.equal(message.threadId, "second"); assert.ok(message.text.includes("unsaved selected text")); assert.ok(message.text.includes("5:3–8:1 (end exclusive)"));
  const citation = collectAssistantCitations(message.text)[0]?.citation; assert.ok(citation);
  assert.equal(citation.threadId, "second"); assert.equal(citation.environmentId, "audit"); assert.equal(citation.messageId, "message");
  assert.equal(citation.text, "reply in second conversation"); assert.equal(citation.comment, "Updated comment");
  const sentQuote = collectAssistantCitations(message.text)[0]!;
  assert.equal(message.text.slice(0, sentQuote.start), "Before ");
  assert.ok(message.text.slice(sentQuote.end).startsWith(" after."));
  assert.ok(!message.text.includes("t3-context://v1/assistant-quote"));
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
  await selectInView(third, "third");
  await third.locator(".chat-heading strong").filter({ hasText: "third conversation" }).waitFor();
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft in third tab");
  console.log("PASS: mouse-selected assistant quotes across inline formatting, optional comments, cancel/edit, independent draft contexts, scoped file references and exact send payloads; provider-instance search, favorites, keyboard selection, effort, legacy and unavailable models.");
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `${evidence}/tab-${index + 1}.png` });
  await manager.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await manager.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "reconnect"));
  await second.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  assert.equal(await second.locator(".chat-heading strong").textContent(), "second conversation");
  assert.equal(await second.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft after sending references");
  assert.equal(client.connections, 2); assert.equal(client.shellStarts, 2);
  await first.close(); registry.remove("tab-one"); await host.removeView("tab-one");
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  assert.equal(host.snapshot("tab-three").activeThreadId, "third");
  const contextTarget = manager.getByRole("button", { name: "third conversation", exact: true });
  await contextTarget.click({ button: "right" });
  await manager.getByRole("menuitem", { name: "Pin thread", exact: true }).click();
  await manager.waitForFunction(() => document.querySelector('[data-thread-id="third"] svg.lucide-pin'));
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  await contextTarget.focus(); await contextTarget.press("Shift+F10");
  await manager.getByRole("menuitem", { name: "Rename thread", exact: true }).waitFor();
  await manager.keyboard.press("Escape"); assert.equal(await contextTarget.evaluate((node) => document.activeElement === node), true);
  await contextTarget.click({ button: "right" });
  await manager.getByRole("menuitem", { name: "Rename thread", exact: true }).click();
  await manager.getByRole("button", { name: "Renamed through history", exact: true }).waitFor();
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
  // New navigation, command menus and per-turn diffs use the same actual bridge.
  client.config = { providers: client.config.providers.map((provider) => ({ ...provider, workspaceSnapshots: [{ cwd: "/tmp/t3-vscode", checkedAt: "2026-10-06T12:00:00Z", slashCommands: [{ name: "compact", description: "Summarize the conversation" }], skills: [{ name: "Review", description: "Review code changes", path: "/tmp/review", enabled: true }] }],
    ...(provider.instanceId === "codex-personal" ? { usageLimits: { checkedAt: "2026-10-06T12:00:00Z", windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 9, resetsAt: "2026-10-13T12:00:00Z" }] } } : {}) })) };
  client.onConfig?.(client.config as Parameters<NonNullable<typeof client.onConfig>>[0]);
  const accountSidebar = await browser.newPage({ viewport: { width: 360, height: 820 } });
  accountSidebar.on("pageerror", (error) => errors.push(error.message));
  await accountSidebar.goto(`http://127.0.0.1:${address.port}/?view=${SIDEBAR_VIEW_ID}`);
  await accountSidebar.locator(".dedicated-sessions").waitFor();
  assert.equal(await accountSidebar.locator(".account-usage").evaluate(element => (element as HTMLDetailsElement).open), false);
  await accountSidebar.locator(".account-usage > summary").click();
  await accountSidebar.getByRole("combobox", { name: "Usage account" }).selectOption({ label: "Codex Personal" });
  await accountSidebar.locator('.account-usage time[datetime="2026-10-06T12:00:00Z"]').waitFor();
  client.config = { ...client.config, providers: client.config.providers.map(provider => provider.instanceId === "codex-personal" ? { ...provider, usageLimits: { ...provider.usageLimits!, checkedAt: "2026-10-06T12:01:00Z" } } : provider) };
  const refreshesBefore = client.providerRefreshes.length;
  await accountSidebar.locator(".account-usage").getByRole("button", { name: "Refresh usage", exact: true }).click();
  await accountSidebar.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "refreshUsage"));
  assert.equal(client.providerRefreshes.length, refreshesBefore + 1);
  await accountSidebar.locator('.account-usage time[datetime="2026-10-06T12:01:00Z"]').waitFor();
  assert.equal(await accountSidebar.locator(".account-usage").getByRole("button", { name: "Refresh usage", exact: true }).isEnabled(), true);
  await accountSidebar.screenshot({ path: `${evidence}/sessions-usage-refresh.png` });
  await accountSidebar.locator(".account-usage > summary").click();
  client.pathEntries = { entries: [{ path: "src/example.ts", kind: "file" }, { path: "src/utils", kind: "directory" }], truncated: false };
  const input = second.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("/");
  await second.getByRole("option").filter({ hasText: "/compact" }).waitFor();
  await second.getByRole("option").filter({ hasText: "/compact" }).click();
  assert.equal(await input.inputValue(), "/compact ");
  await input.fill("Please inspect @example");
  await second.getByRole("option").filter({ hasText: "example.ts" }).waitFor();
  await input.press("Enter"); assert.equal(await input.inputValue(), "Please inspect [example.ts](src/example.ts) ");
  assert.equal(client.pathSearches.at(-1)?.cwd, "/tmp/t3-vscode");
  await input.fill("/usage"); await second.getByRole("option").filter({ hasText: "/usage-limits" }).click();
  await accountSidebar.waitForFunction(() => (document.querySelector('.account-usage') as HTMLDetailsElement).open);
  await accountSidebar.getByText("91% left", { exact: true }).waitFor();
  assert.equal(host.snapshot("tab-two").activeThreadId, "second");
  assert.equal(await second.locator('.usage-panel, .usage-overlay').count(), 0);
  await accountSidebar.screenshot({ path: `${evidence}/usage-limits.png` });
  await input.fill("Draft survives navigation");
  client.searchMatches = { matches: [{ threadId: ThreadId.make("second"), projectId: ProjectId.make("project-v2"), source: "assistant", snippet: "Switch the model in the composer", messageCreatedAt: null }, { threadId: ThreadId.make("outside-thread"), projectId: ProjectId.make("outside"), source: "user", snippet: "model", messageCreatedAt: null }] };
  await accountSidebar.getByRole("textbox", { name: "Search threads" }).fill("model");
  await accountSidebar.locator('.thread[data-thread-id="second"] .thread-match').waitFor();
  assert.equal(await accountSidebar.locator('.thread[data-thread-id="outside-thread"]').count(), 0);
  await accountSidebar.screenshot({ path: `${evidence}/history-message-search.png` });
  await accountSidebar.getByRole("button", { name: "Clear search" }).click();
  await host.threadAction("first", "settle"); await host.threadAction("third", "archive");
  await accountSidebar.getByText("Settled", { exact: true }).click();
  await accountSidebar.locator('.history-shelf').filter({ hasText: "Settled" }).locator('[data-thread-id="first"]').waitFor();
  await accountSidebar.getByText("Archive", { exact: true }).click();
  await accountSidebar.locator('.history-shelf').filter({ hasText: "Archive" }).locator('[data-thread-id="third"]').waitFor();
  assert.equal(await accountSidebar.locator('.session-list [data-thread-id="first"], .session-list [data-thread-id="third"]').count(), 0);
  await accountSidebar.screenshot({ path: `${evidence}/history-separate-shelves.png` });
  assert.equal(await input.inputValue(), "Draft survives navigation");
  publishTurn(client, "second");
  client.getSavedTurnDiff = async (range) => { client.savedDiffRequests.push(range); return turnPatch; };
  await second.getByText("1 changed file", { exact: true }).click();
  await second.locator('.change-directory > summary').click();
  await second.getByRole("button", { name: "Open turn diff: src/example.ts" }).click();
  await second.waitForFunction(() => (window as unknown as { __completed: Array<{ method: string }> }).__completed.some((entry) => entry.method === "openTurnDiff"));
  assert.deepEqual(openedDiffs, [{ turn: 2, path: "src/example.ts", old: "before\n", current: "after\n" }]);
  assert.equal(client.savedDiffRequests[0]?.headRef, "refs/t3/checkpoints/second/2");
  assert.equal(await second.locator('.chat-header').evaluate((element) => element.getBoundingClientRect().height), 36);
  assert.equal(await second.locator('.chat-heading strong').evaluate((element) => getComputedStyle(element).fontSize), "14px");
  await second.screenshot({ path: `${evidence}/compact-header-turn-changes.png` });
  await third.setViewportSize({ width: 300, height: 700 });
  await third.getByRole("textbox", { name: "Message", exact: true }).fill("/");
  await third.getByRole("option").filter({ hasText: "/skill:Review" }).waitFor();
  await third.screenshot({ path: `${evidence}/sidebar-slash-menu.png` });
  assert.equal(await third.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await third.keyboard.press("Escape");
  console.log("PASS: sessions-only sidebar, compact chat header, scoped message snippets, separate settlement/archive, keyboard slash and file menus, account-specific quota windows, adjacent-turn file diffs and narrow editor without overflow.");
  publishActivity(client, "second");
  await second.getByRole("button", { name: "Collapse queued messages" }).waitFor();
  await second.getByRole("button", { name: "Expand tasks: 1 of 3 complete" }).click();
  await second.getByText("Read the source", { exact: true }).waitFor();
  await second.getByRole("button", { name: "Edit queued message", exact: true }).first().click();
  await second.getByRole("textbox", { name: "Edit queued message", exact: true }).fill("Edited queued follow-up");
  await second.getByRole("button", { name: "Save queued message" }).click();
  await second.getByText("Edited queued follow-up", { exact: true }).waitFor();
  await second.getByRole("button", { name: "Reorder queued message" }).nth(1).press("ArrowUp");
  await second.waitForFunction(() => document.querySelector('.queued-preview')?.textContent === "Queued follow-up 2");
  assert.equal(await second.getByRole("combobox", { name: "Follow-up delivery" }).count(), 0);
  const submitFollowUp = async (page: Page, text: string, shortcut: string, mode: "auto" | "queue" | "steer") => {
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill(text); await message.press(shortcut);
    await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement)?.value === "");
    const command = client.commands.findLast((item) => item.type === "message.dispatch");
    assert.equal(command?.type, "message.dispatch");
    if (command?.type === "message.dispatch") {
      assert.equal(command.text, text);
      assert.equal(command.dispatchMode.type, mode === "queue" ? "queue_after_active" : "start_immediately");
      assert.equal(command.deliveryIntent, mode === "queue" ? undefined : mode);
    }
  };
  await submitFollowUp(second, "Queued from the editor", "Enter", "queue");
  await submitFollowUp(second, "Steering from the editor", "Control+Enter", "steer");
  await submitFollowUp(second, "Steering with the macOS modifier", "Meta+Enter", "steer");
  await input.fill("Independent draft after queue actions");
  await second.screenshot({ path: `${evidence}/queue-and-running-tasks.png` });
  await host.selectThread("second", "tab-three");
  await third.getByRole("button", { name: "Collapse queued messages" }).waitFor();
  await submitFollowUp(third, "Queued from a narrow editor", "Enter", "queue");
  await submitFollowUp(third, "Steering from a narrow editor", "Control+Enter", "steer");
  await third.getByRole("textbox", { name: "Message", exact: true }).fill("Narrow editor queue draft");
  await third.screenshot({ path: `${evidence}/narrow-editor-queue-and-tasks.png` });
  assert.equal(await third.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await second.getByRole("button", { name: "Steer with queued message" }).first().click();
  await third.waitForFunction(() => document.querySelectorAll('.queued-message').length === 1);
  await second.getByRole("button", { name: "Cancel queued message" }).click();
  await third.getByRole("button", { name: "Collapse queued messages" }).waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "Independent draft after queue actions");
  assert.equal(await third.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Narrow editor queue draft");
  publishActivity(client, "second", false);
  await second.waitForFunction(() => (document.querySelector('[aria-label="Steer with queued message"]') as HTMLButtonElement)?.disabled);
  await submitFollowUp(second, "Unsupported steering safely queues", "Control+Enter", "queue");
  assert.equal((await input.getAttribute("title"))?.includes("to steer"), false);
  publishTurn(client, "second");
  await second.waitForFunction(() => document.querySelector('textarea[aria-label="Message"]')?.getAttribute("title")?.startsWith("Enter to send"));
  await submitFollowUp(second, "Idle Enter sends immediately", "Enter", "auto");
  await submitFollowUp(second, "Idle Ctrl+Enter sends immediately", "Control+Enter", "auto");
  console.log("PASS: Enter queues and Ctrl/Cmd+Enter steers in wide/narrow editor chat, unsupported steering queues, idle shortcuts send normally; queued-message editing, reordering and promotion/cancellation preserve independent drafts.");
  }
  await checkSessionFind(pages[1]!, pages[2]!, selectInView);
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
