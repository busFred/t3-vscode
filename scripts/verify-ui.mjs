/** Browser verification of the actual built webview, using deterministic host snapshots. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-ui";
await mkdir(evidence, { recursive: true });
const now = "2026-10-06T12:00:00.000Z";
const appearance = { fontSizeInterface: 16, fontSizePrompt: 14, fontSizeCode: 13 };
const selection = { instanceId: "codex", model: "gpt-6-astra" };
const capabilities = { optionDescriptors: [{ id: "effort", type: "select", label: "Effort", options: [{ id: "low", label: "Low" }, { id: "max", label: "Max", isDefault: true }] }] };
const baseItem = { threadId: "thread-one", runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null, title: null, startedAt: now, completedAt: now, updatedAt: now, status: "completed" };
let ordinal = 0;
const row = (type, fields) => { const id = `${type}-${++ordinal}`; return { key: id, sourceThreadId: "thread-one", toolLabel: null, output: null, needsDetail: false, item: { ...baseItem, id, ordinal, type, ...fields } }; };
const user = row("user_message", { messageId: "message-one", createdBy: "user", creationSource: "web", inputIntent: "turn", text: "Migrate the T3 chat experience into VS Code.", attachments: [] });
const assistant = row("assistant_message", { messageId: "message-two", text: "The core chat is ready.\n\n- **Projects and threads** stay in sync.\n- Models come from the server catalog.\n- Approvals and questions appear above the composer.\n\n```ts\nconst client = new T3Client();\nawait client.connect(server, session);\n```\n\nOpen [the client](src/host/t3Client.ts) to inspect the transport.", streaming: false });
const command = { ...row("command_execution", { input: "pnpm run typecheck", output: "Typecheck passed", exitCode: 0 }), output: "Typecheck passed" };
const diff = row("file_change", { fileName: "src/host/t3Client.ts", additions: 2, deletions: 1, diffStr: "@@ -1,2 +1,3 @@\n-const thread = oldThread;\n+const thread = createdThread;\n+subscribe(thread);" });
const fixtures = { user, assistant, command, diff };
const initial = {
  revision: 1, phase: "ready", home: "/tmp/t3-vscode-fixture", workspaceRoots: [], appearance, environment: { environmentId: "fixture", label: "Local development", serverVersion: "0.0.46" },
  projects: [{ id: "project-one", title: "t3-vscode", workspaceRoot: "/tmp/t3-vscode" }, { id: "project-two", title: "myt3code", workspaceRoot: "/tmp/myt3code" }],
  threads: [{ id: "thread-one", projectId: "project-one", title: "Migrate the T3 chat experience", status: "idle", modelSelection: selection, runtimeMode: "auto", interactionMode: "default", updatedAt: now, archived: false, pinned: true, activeRunId: null }, { id: "thread-two", projectId: "project-two", title: "Server integration checks", status: "idle", modelSelection: selection, runtimeMode: "auto", interactionMode: "default", updatedAt: now, archived: false, pinned: false, activeRunId: null }],
  favoriteModels: [],
  providers: [{ instanceId: "codex", driver: "codex", displayName: "Codex", installed: true, enabled: true, supportedRuntimeModes: ["approval-required", "auto", "full-access"], models: [{ slug: "gpt-6-astra", name: "GPT-6 Astra", isCustom: false, capabilities }] }, { instanceId: "kimi-acp", driver: "acp", displayName: "Kimi via ACP", installed: true, enabled: true, models: [{ slug: "kimi-for-coding", name: "Kimi for Coding", isCustom: false, capabilities }] }],
  draft: { projectId: "project-one", workspaceRoot: "/tmp/t3-vscode", supportsNoProject: true, modelSelection: selection, runtimeMode: "auto", interactionMode: "default" },
  activeThreadId: "thread-one", transcript: [user, assistant, command, diff], pending: { approvals: [], userInputs: [] }, history: { hasMore: false, loading: false, error: null }, threadLoading: false, sending: false,
};
function mockBridge() {
  window.__requests = [];
  window.__replace = (patch) => { window.__state = { ...window.__state, ...patch, revision: window.__state.revision + 1 }; window.postMessage({ event: "stateChanged", data: window.__state }, "*"); };
  window.acquireVsCodeApi = () => ({ getState: () => null, setState: () => {}, postMessage: (request) => {
    window.__requests.push(request);
    const params = request.params ?? {};
    if (request.method === "selectThread") window.__replace({ activeThreadId: params.threadId });
    if (request.method === "setModel") window.__replace(params.threadId
      ? { threads: window.__state.threads.map((thread) => thread.id === params.threadId ? { ...thread, modelSelection: params.modelSelection } : thread) }
      : { draft: { ...window.__state.draft, modelSelection: params.modelSelection } });
    if (request.method === "setModelOption") {
      const selection = params.threadId ? window.__state.threads.find((thread) => thread.id === params.threadId).modelSelection : window.__state.draft.modelSelection;
      const modelSelection = { ...selection, options: [...(selection.options ?? []).filter((option) => option.id !== params.optionId), { id: params.optionId, value: params.value }] };
      window.__replace(params.threadId ? { threads: window.__state.threads.map((thread) => thread.id === params.threadId ? { ...thread, modelSelection } : thread) }
        : { draft: { ...window.__state.draft, modelSelection } });
    }
    if (request.method === "toggleFavoriteModel") {
      const exists = window.__state.favoriteModels.some((favorite) => favorite.instanceId === params.instanceId && favorite.model === params.model);
      window.__replace({ favoriteModels: exists ? window.__state.favoriteModels.filter((favorite) => favorite.instanceId !== params.instanceId || favorite.model !== params.model) : [...window.__state.favoriteModels, params] });
    }
    if (request.method === "setModes") window.__replace(params.threadId
      ? { threads: window.__state.threads.map((thread) => thread.id === params.threadId ? { ...thread, ...params } : thread) }
      : { draft: { ...window.__state.draft, ...params } });
    if (request.method === "chooseProject") window.__replace({ draft: { ...window.__state.draft, projectId: null, workspaceRoot: "/tmp/picked-project" } });
    if (request.method === "respondToRequest") window.__replace({ pending: { approvals: [], userInputs: [] } });
    if (request.method === "sendMessage") {
      if (!params.threadId) {
        const draft = window.__state.draft;
        const project = { id: "first-project", title: draft.workspaceRoot ? "picked-project" : "No project", workspaceRoot: draft.workspaceRoot ?? "/tmp/fixture/scratch" };
        const thread = { id: "first-thread", projectId: project.id, title: "First conversation", status: "idle", modelSelection: draft.modelSelection,
          runtimeMode: draft.runtimeMode, interactionMode: draft.interactionMode, updatedAt: new Date().toISOString(), archived: false, pinned: false, activeRunId: null };
        window.__replace({ activeThreadId: thread.id, projects: [project], threads: [thread] });
      }
      window.__replace({ transcript: [...window.__state.transcript, { ...window.__fixtures.assistant, key: "new-response", item: { ...window.__fixtures.assistant.item, id: "new-response", text: "UI verification reply" } }] });
    }
    if (request.method === "loadHistory") window.__replace({ history: { hasMore: false, loading: false, error: null } });
    setTimeout(() => window.postMessage({ id: request.id, result: window.__state }, "*"), 0);
  } });
}
const js = await readFile(new URL("../dist/webview.js", import.meta.url));
const json = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const server = createServer((request, response) => {
  if (request.url === "/webview.js") { response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(js); return; }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-preview'; style-src 'unsafe-inline'; img-src data:; font-src 'self'; connect-src 'self'"></head><body class="vscode-dark" data-surface="panel"><div id="root"></div><script nonce="preview">window.__state=${json(initial)};window.__fixtures=${json(fixtures)};(${mockBridge.toString()})();</script><script nonce="preview" src="/webview.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await page.getByText("The core chat is ready.", { exact: false }).waitFor();
  assert.ok(await page.locator(".markdown strong").count());
  await page.getByRole("button", { name: "pnpm run typecheck" }).click();
  await page.getByText("Typecheck passed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edited src/host/t3Client.ts" }).click();
  await page.locator(".diff-add").first().waitFor();
  await page.screenshot({ path: `${evidence}/chat-wide.png` });
  await page.getByRole("button", { name: "Choose model", exact: true }).click();
  await page.getByRole("textbox", { name: "Search models" }).fill("kimi");
  await page.getByRole("button", { name: "Kimi for Coding", exact: true }).click();
  await page.getByRole("button", { name: "Choose model", exact: true }).filter({ hasText: "Kimi for Coding" }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Interaction mode" }).count(), 0);
  await page.getByRole("combobox", { name: "Effort level" }).selectOption("low");
  assert.equal(await page.getByRole("combobox", { name: "Effort level" }).inputValue(), "low");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Browser fixture message");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("UI verification reply", { exact: true }).waitFor();
  await page.evaluate(() => window.__replace({ pending: { userInputs: [], approvals: [{ requestId: "approval", requestKind: "command", createdAt: "2026-10-06T12:00:00Z", detail: "pnpm run test", responseCapability: "live" }] } }));
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  assert.ok(await page.evaluate(() => window.__requests.some((request) => request.method === "respondToRequest" && request.params.decision === "accept")));
  await page.evaluate(() => window.__replace({ pending: { approvals: [], userInputs: [{ requestId: "question", createdAt: "2026-10-06T12:00:00Z", responseCapability: "live", dismissible: false, questions: [{ id: "layout", header: "Layout", question: "Which layout should we use?", multiSelect: false, options: [{ label: "Compact", description: "Fits the sidebar", value: "compact" }, { label: "Spacious", description: "Fits an editor tab", value: "spacious" }] }] }] } }));
  await page.getByLabel("Compact", { exact: false }).check();
  await page.getByRole("button", { name: "Submit answers" }).click();
  assert.ok(await page.evaluate(() => window.__requests.some((request) => request.method === "respondToRequest" && request.params.answers?.layout === "compact")));
  await page.evaluate(() => window.__replace({ pending: { approvals: [], userInputs: [{ requestId: "multi", createdAt: "2026-10-06T12:00:00Z", responseCapability: "message", dismissible: true, questions: [{ id: "checks", header: "Checks", question: "Which checks?", multiSelect: true, options: [{ label: "Browser", description: "Check the rendered app", value: "browser" }] }] }] } }));
  await page.getByLabel("Browser", { exact: false }).check();
  await page.getByRole("textbox", { name: "Answer: Checks" }).fill("real server");
  await page.getByRole("button", { name: "Submit answers" }).click();
  assert.deepEqual(await page.evaluate(() => window.__requests.findLast((request) => request.method === "respondToRequest").params.answers.checks), ["browser", "real server"]);
  await page.setViewportSize({ width: 360, height: 820 });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Server integration checks" }).click();
  await page.locator(".chat-heading strong").filter({ hasText: "Server integration checks" }).waitFor();
  assert.equal(await page.locator(".projects-sidebar").count(), 0);
  await page.evaluate(() => window.__replace({ transcript: [window.__fixtures.user, window.__fixtures.assistant], pending: { approvals: [], userInputs: [] } }));
  await page.getByText("The core chat is ready.", { exact: false }).waitFor();
  await page.getByPlaceholder("Ask anything, or describe a task…").waitFor();
  await page.waitForFunction(() => {
    let node = document.querySelector(".assistant-message");
    if (!node) return false;
    for (; node; node = node.parentElement) if (getComputedStyle(node).opacity === "0") return false;
    return true;
  });
  await page.evaluate(() => { document.body.dataset.surface = "sidebar"; window.__replace({}); });
  await page.waitForFunction(() => !document.querySelector(".chat-header"));
  await page.evaluate(() => window.postMessage({ event: "showNavigation" }, "*"));
  await page.getByRole("textbox", { name: "Search threads" }).waitFor();
  assert.equal(await page.locator('.account-usage').evaluate(element => element.open), false);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Search threads" }).waitFor({ state: "hidden" });
  await page.screenshot({ path: `${evidence}/chat-sidebar.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); assert.equal(overflow, false, "Sidebar must not overflow horizontally");
  await page.evaluate(() => document.body.className = "vscode-light");
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: `${evidence}/chat-light.png` });
  await page.evaluate(() => window.__replace({ transcript: Array.from({ length: 1000 }, (_, index) => ({ ...window.__fixtures.assistant, key: `long-${index}`, item: { ...window.__fixtures.assistant.item, id: `long-${index}`, text: `Message ${index}` } })) }));
  await page.getByText("Message 999", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    let node = document.querySelector(".assistant-message");
    if (!node) return false;
    for (; node; node = node.parentElement) if (getComputedStyle(node).opacity === "0") return false;
    return true;
  });
  assert.ok(await page.locator(".timeline-row").count() < 100, "Long conversations must be virtualized");
  await page.evaluate(() => window.__replace({ activeThreadId: undefined, projects: [], threads: [], transcript: [],
    draft: { projectId: null, workspaceRoot: null, supportsNoProject: true, modelSelection: { instanceId: "codex", model: "gpt-6-astra" }, runtimeMode: "auto", interactionMode: "default" } }));
  await page.getByRole("button", { name: "Choose project", exact: true }).filter({ hasText: "No project" }).waitFor();
  await page.getByRole("button", { name: "Choose model", exact: true }).click();
  await page.getByRole("textbox", { name: "Search models" }).fill("kimi");
  await page.getByRole("button", { name: "Kimi for Coding", exact: true }).click();
  await page.getByRole("combobox", { name: "Effort level" }).selectOption("max");
  await page.getByRole("combobox", { name: "Permission mode" }).selectOption("full-access");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("First message without a project");
  await page.screenshot({ path: `${evidence}/empty-sidebar.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("UI verification reply", { exact: true }).waitFor();
  const firstThread = await page.evaluate(() => window.__state.threads[0]);
  assert.equal(firstThread.modelSelection.instanceId, "kimi-acp");
  assert.equal(firstThread.runtimeMode, "full-access");
  assert.equal(firstThread.interactionMode, "default");
  assert.deepEqual(firstThread.modelSelection.options, [{ id: "effort", value: "max" }]);
  assert.equal(await page.evaluate(() => window.__state.projects[0].title), "No project");
  assert.equal(await page.evaluate(() => window.__requests.findLast((request) => request.method === "sendMessage").params.threadId), undefined);
  assert.ok(await page.evaluate(() => window.__requests.some((request) => request.method === "setModel" && !request.params.threadId)));
  await page.evaluate(() => window.__replace({ activeThreadId: undefined, projects: [], threads: [], transcript: [], draft: { ...window.__state.draft, supportsNoProject: false } }));
  await page.getByRole("button", { name: "Choose project", exact: true }).filter({ hasText: "Choose project" }).waitFor();
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  await page.getByRole("button", { name: "Choose project", exact: true }).filter({ hasText: "picked-project" }).waitFor();
  await page.evaluate(() => window.__replace({ providers: [], draft: { ...window.__state.draft, modelSelection: null } }));
  await page.getByText("No models available. Configure a provider in T3 Code.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Draft survives server setup");
  await page.evaluate(() => window.__replace({ phase: "no-server", notice: "No server-runtime.json in the configured home." }));
  await page.getByRole("heading", { name: "T3 VSCode", exact: true }).waitFor();
  assert.equal(await page.locator('.setup-command').count(), 2);
  await page.getByRole("button", { name: "Installation guide", exact: true }).click();
  await page.waitForFunction(() => window.__requests.some(request => request.method === 'openLink' && request.params.href.endsWith('/docs/user/install.md')));
  await page.getByRole("button", { name: "Copy t3 service install", exact: true }).click();
  await page.waitForFunction(() => window.__requests.some(request => request.method === 'copyText' && request.params.text === 't3 service install'));
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await page.waitForFunction(() => window.__requests.some(request => request.method === 'reconnect'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: `${evidence}/missing-server-setup.png` });
  await page.evaluate(() => window.__replace({ phase: "ready" }));
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft survives server setup");
  assert.deepEqual(errors, []);
  console.log("PASS: markdown, tool details, diff, model catalog, modes, send, approvals, questions, narrow navigation, themes, virtualization, projectless first message, draft controls, folder selection, empty model catalog");
  console.log(`Screenshots: ${evidence}`);
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
