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
const commandOutput = `Typecheck passed\n${Array.from({ length: 80 }, (_, line) => `Output line ${line}`).join('\n')}`;
const command = { ...row("command_execution", { input: "pnpm run typecheck", output: commandOutput, exitCode: 0 }), output: commandOutput };
const diff = row("file_change", { fileName: "src/host/t3Client.ts", additions: 2, deletions: 1, diffStr: "@@ -1,2 +1,3 @@\n-const thread = oldThread;\n+const thread = createdThread;\n+subscribe(thread);" });
const fixtures = { user, assistant, command, diff };
const initial = {
  revision: 1, phase: "ready", home: "/tmp/t3-vscode-fixture", workspaceRoots: [], appearance, environment: { environmentId: "fixture", label: "Local development", serverVersion: "0.0.46" },
  projects: [{ id: "project-one", title: "t3-vscode", workspaceRoot: "/tmp/t3-vscode" }, { id: "project-two", title: "myt3code", workspaceRoot: "/tmp/myt3code" }],
  threads: [{ id: "thread-one", projectId: "project-one", title: "Migrate the T3 chat experience", status: "idle", modelSelection: selection, runtimeMode: "auto", interactionMode: "default", updatedAt: now, archived: false, pinned: true, activeRunId: null }, { id: "thread-two", projectId: "project-two", title: "Server integration checks", status: "idle", modelSelection: selection, runtimeMode: "auto", interactionMode: "default", updatedAt: now, archived: false, pinned: false, activeRunId: null }],
  favoriteModels: [],
  providers: [{ instanceId: "codex", driver: "codex", displayName: "Codex", installed: true, enabled: true, supportedRuntimeModes: ["approval-required", "auto", "full-access"], models: [{ slug: "gpt-6-astra", name: "GPT-6 Astra", isCustom: false, capabilities }] }, { instanceId: "kimi-acp", driver: "acp", displayName: "Kimi via ACP", installed: true, enabled: true, models: [{ slug: "kimi-for-coding", name: "Kimi for Coding", isCustom: false, capabilities }] }],
  draft: { projectId: "project-one", workspaceRoot: "/tmp/t3-vscode", supportsNoProject: true, modelSelection: selection, runtimeMode: "auto", interactionMode: "default" },
  reader: { mode: "off", sensitivity: 5 }, activeThreadId: "thread-one", transcript: [user, assistant, command, diff], pending: { approvals: [], userInputs: [] }, history: { hasMore: false, loading: false, error: null }, threadLoading: false, sending: false,
};
function mockBridge() {
  window.__requests = [];
  window.__initialForWide = window.__state;
  window.__replace = (patch) => { window.__state = { ...window.__state, ...patch, revision: window.__state.revision + 1 }; window.postMessage({ event: "stateChanged", data: window.__state }, "*"); };
  window.acquireVsCodeApi = () => ({ getState: () => null, setState: () => {}, postMessage: (request) => {
    window.__requests.push(request);
    const params = request.params ?? {};
    if (request.method === "uploadAttachment") { const image = { key: 'pasted-upload', name: params.name, mimeType: params.mimeType, sizeBytes: atob(params.base64).length, previewUrl: `data:${params.mimeType};base64,${params.base64}`, environmentId: 'fixture', attachment: { type: 'image', id: 'pending-pasted', name: params.name, mimeType: params.mimeType, sizeBytes: atob(params.base64).length } }; setTimeout(() => window.postMessage({ id: request.id, result: image }, '*'), 50); return; }
    if (request.method === "pickAttachments") { const file = { key: 'picked-upload', name: 'outside-workspace.txt', mimeType: 'text/plain', sizeBytes: 3, environmentId: 'fixture', attachment: { type: 'file', id: 'pending-picked', name: 'outside-workspace.txt', mimeType: 'text/plain', sizeBytes: 3 } }; window.postMessage({ id: request.id, result: { attachments: [file], errors: [] } }, '*'); return; }
    if (request.method === "chatAsset") { setTimeout(() => window.postMessage({ id: request.id, result: { url: `${location.origin}/${params.reference.kind === "media" || params.reference.kind === "attachment" ? "image.svg" : "visual.html"}`, expiresAt: Date.now() + 60_000 } }, "*"), 0); return; }
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
    if (request.method === "loadHistory") window.__replace({ ...(window.__historyRows ? { transcript: [...window.__historyRows, ...window.__state.transcript] } : {}), history: { hasMore: false, loading: false, error: null } });
    setTimeout(() => window.postMessage({ id: request.id, result: window.__state }, "*"), 0);
  } });
}
const visualsJs = await readFile(new URL("../dist/mermaid.js", import.meta.url));
const js = await readFile(new URL("../dist/webview.js", import.meta.url));
const json = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const server = createServer((request, response) => {
  if (request.url?.startsWith("/math/") && !request.url.includes("..")) {
    readFile(new URL(`../dist${request.url}`, import.meta.url)).then((content) => { response.writeHead(200, { "Content-Type": request.url.endsWith('.css') ? 'text/css' : 'font/woff2' }); response.end(content); }, () => { response.writeHead(404); response.end(); }); return;
  }
  if (request.url === "/mermaid.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(visualsJs); return; }
  if (request.url === "/image.svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#165ba8"/><text x="20" y="48" fill="white">Inline graphic</text></svg>'); return; }
  if (request.url === "/visual.html") {
    response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<!doctype html><html><style>html{background:var(--background);color:var(--foreground);font-family:var(--font-sans)}body{margin:0}canvas{display:block;width:100%;height:100px}</style><body><h2>Interactive graphic</h2><canvas id="chart" width="500" height="100"></canvas><button id="counter">Count: 0</button><script>
      const button=document.getElementById('counter');let count=0;button.onclick=()=>button.textContent='Count: '+(++count);
      const ctx=document.getElementById('chart').getContext('2d');ctx.fillStyle='#165ba8';ctx.fillRect(20,20,250,70);
      function theme(t){for(const[k,v]of Object.entries(t.variables||{}))document.documentElement.style.setProperty(k,v)}
      if(location.hash.startsWith('#t3-theme='))theme(JSON.parse(decodeURIComponent(location.hash.slice(10))));
      addEventListener('message',e=>{if(e.data?.method==='ui/notifications/host-context-changed')theme({variables:e.data.params.styles.variables})});
      window.parent.postMessage({event:'showNavigation'},'*');
      document.getElementById('counter').dataset.escaped=String(typeof acquireVsCodeApi!=='undefined');
    </script></body></html>`); return;
  }
  if (request.url === "/webview.js") { response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(js); return; }
  if (request.url === "/native-host") {
    response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><iframe title="Native host" src="/native-content" style="width:100%;height:900px"></iframe><script>addEventListener("message",event=>{const frame=document.querySelector("iframe");if(event.source===frame.contentWindow&&event.data?.id)frame.contentWindow.postMessage({id:event.data.id,result:' + json(initial) + '},location.origin)})</script>'); return;
  }
  if (request.url === "/native-content") {
    response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><body data-surface="panel"><div id="root"></div><script>const nativeParent=window.parent;window.parent=window;window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:message=>nativeParent.postMessage(message,location.origin)})</script><script src="/webview.js"></script>'); return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-preview'; style-src 'self' 'unsafe-inline'; img-src data: http: https:; font-src 'self'; connect-src 'self'; frame-src http://127.0.0.1:*; media-src data: http: https:"><link rel="stylesheet" href="/math/katex.css"></head><body class="vscode-dark" data-surface="panel"><div id="root"></div><script nonce="preview">window.__state=${json(initial)};window.__fixtures=${json(fixtures)};(${mockBridge.toString()})();</script><script nonce="preview" src="/webview.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/native-host`);
  const nativeContent = page.frameLocator('iframe[title="Native host"]');
  await nativeContent.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  assert.equal(await nativeContent.locator('body').evaluate(() => window.parent === window), true);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await page.getByText("The core chat is ready.", { exact: false }).waitFor();
  assert.ok(await page.locator(".markdown strong").count());
  await page.getByRole("button", { name: "Ran 1 command · 1 tool call" }).click();
  await page.getByRole("button", { name: "pnpm run typecheck" }).click();
  await page.getByText("Typecheck passed", { exact: false }).waitFor();
  assert.equal(await page.locator('.command-input').evaluate(element => {
    const style = getComputedStyle(element);
    return element.clientHeight + 1 >= parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  }), true, 'A command remains at least one full line tall beside long output');
  assert.equal(await page.locator('.tool-output').evaluate(element => element.scrollHeight > element.clientHeight), true);
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
  await page.evaluate(() => { document.body.dataset.surface = "sidebar"; window.__replace({}); });
  await page.getByRole("button", { name: "Server integration checks" }).click();
  await page.evaluate(() => { document.body.dataset.surface = "panel"; window.__replace({}); });
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
  assert.equal(await page.getByRole("button", { name: "Chat", exact: true }).count(), 0);
  await page.evaluate(() => { document.body.dataset.surface = "panel"; window.__replace({}); });
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
  // Message navigation must work across rows that are currently unmounted.
  await page.evaluate(() => {
    const { user, assistant } = window.__fixtures;
    window.__navigationRows = Array.from({ length: 250 }, (_, index) => [
      { ...user, key: `nav-user-${index}`, item: { ...user.item, id: `nav-user-${index}`, text: `Prompt ${index}`, messageId: `prompt-${index}` } },
      { ...assistant, key: `nav-answer-${index}`, item: { ...assistant.item, id: `nav-answer-${index}`, text: `Response ${index}`, messageId: `answer-${index}` } },
    ]).flat();
    window.__replace({ activeThreadId: 'thread-one', transcript: window.__navigationRows });
  });
  await page.getByText('Response 249', { exact: true }).waitFor();
  const rail = page.getByRole('listbox', { name: 'Past messages' });
  assert.equal(await rail.getByRole('option').count(), 250);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unsent draft');
  await rail.focus(); await rail.press('Home');
  await page.getByRole('button', { name: 'Jump to message 1', exact: true }).click();
  await page.locator('.timeline-row .user-message').getByText('Prompt 0', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const row = document.querySelector('.timeline-row[data-message-key="nav-user-0"]');
    const viewport = document.querySelector('.transcript-container');
    if (!row || !viewport) return false;
    const r=row.getBoundingClientRect(), v=viewport.getBoundingClientRect();return r.top>=v.top-1&&r.top<v.bottom;
  });
  assert.ok(await page.locator('.timeline-row').count() < 100);
  await rail.hover(); await page.mouse.wheel(0, 100);
  const wheelPreview = await page.locator('.message-nav-preview strong').textContent();
  assert.ok(wheelPreview.startsWith('Prompt '));
  await rail.focus(); await rail.press('Home'); await rail.press('ArrowDown');
  await page.getByRole('button', { name: 'Jump to message 2', exact: true }).waitFor();
  // Appending streamed text cannot pull the reader back to the end.
  await page.evaluate(() => window.__replace({ transcript: window.__navigationRows.map((row) => row.key === 'nav-answer-249' ? { ...row, item: { ...row.item, streaming: true, text: 'Response 249 is still streaming' } } : row) }));
  assert.equal(await page.locator('.timeline-row .user-message').getByText('Prompt 0', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'Keep this unsent draft');
  // Pagination prepends markers while a preview keeps its original key.
  await page.evaluate(() => {
    const { user, assistant } = window.__fixtures;
    window.__historyRows = [{ ...user, key: 'earlier-user', item: { ...user.item, id: 'earlier-user', text: 'Earlier prompt' } }, { ...assistant, key: 'earlier-answer', item: { ...assistant.item, id: 'earlier-answer', text: 'Earlier response' } }];
    window.__replace({ history: { hasMore: true, loading: false, error: null } });
  });
  await page.locator('.message-nav-earlier').click();
  await page.getByRole('button', { name: 'Jump to message 3', exact: true }).waitFor();
  assert.equal(await page.locator('.message-nav-preview strong').textContent(), 'Prompt 1');
  await rail.focus(); await rail.press('Home'); await rail.press('Enter');
  await page.locator('.timeline-row .user-message').getByText('Earlier prompt', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Jump to latest message' }).click();
  await page.getByText('Response 249 is still streaming', { exact: true }).waitFor();
  // Manually returning to the bottom after a rail jump resumes streaming follow.
  await rail.focus(); await rail.press('Home'); await rail.press('Enter');
  await page.locator('.timeline-row .user-message').getByText('Earlier prompt', { exact: true }).waitFor();
  await page.locator('.transcript-list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('button', { name: 'Jump to latest message' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => window.__replace({ transcript: [...window.__state.transcript, { ...window.__fixtures.assistant, key: 'stream-after-return', item: { ...window.__fixtures.assistant.item, id: 'stream-after-return', text: 'Streaming after manual return to bottom', streaming: true } }] }));
  await page.getByText('Streaming after manual return to bottom', { exact: true }).waitFor();
  await page.waitForFunction(() => { const item = [...document.querySelectorAll('.assistant-message')].find((entry) => entry.textContent.includes('Streaming after manual return to bottom')); const viewport = document.querySelector('.transcript-list'); return item && item.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + 2; });
  await page.evaluate(() => window.__replace({ messageNavigation: 'right' }));
  await page.locator('.message-navigator.right').waitFor();
  await page.evaluate(() => window.__replace({ messageNavigation: 'off' }));
  await rail.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.__replace({ messageNavigation: 'left' }));
  await rail.focus(); await rail.press('Home');
  await page.screenshot({ path: `${evidence}/message-navigation-sidebar.png` });
  for (const width of [170, 300, 760]) {
    await page.setViewportSize({ width, height: 820 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Rail overflows at ${width}px`);
    await page.waitForFunction(() => { const p=document.querySelector('.message-nav-preview');if(!p)return true;const r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth; });
  }
  await page.evaluate(() => { document.body.dataset.surface='panel'; window.__replace({}); });
  await page.locator('.chat-header').waitFor();
  await rail.press('End'); await rail.press('Enter');
  await page.locator('.timeline-row .user-message').getByText('Prompt 249', { exact: true }).waitFor();
  await page.screenshot({ path: `${evidence}/message-navigation-editor.png` });
  // Graphics: interactive HTML, a diagram, a local SVG and attachment images.
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.evaluate(() => {
    const { user, assistant } = window.__fixtures;
    window.__replace({ activeThreadId: 'thread-two', history: { hasMore: false, loading: false, error: null }, transcript: [
      { ...user, key: 'visual-user', item: { ...user.item, id: 'visual-user', text: 'Show chat graphics', attachments: [{ type: 'image', id: 'image-attachment', name: 'Attached image', mimeType: 'image/svg+xml', sizeBytes: 300 }] } },
      { ...assistant, key: 'visual-html', sourceItemId: 'visual-html', item: { ...assistant.item, id: 'visual-html', type: 'dynamic_tool', status: 'completed', toolName: 'mcp__t3_code__html_render', input: {}, output: { structuredContent: { htmlRender: { attachmentId: 'fixture-html', title: 'Interactive graphic', height: 220, heights: [[360, 250], [728, 220]] } } } } },
      { ...assistant, key: 'visual-answer', item: { ...assistant.item, id: 'visual-answer', streaming: false, text: '```mermaid\nflowchart LR\n A[Prompt] --> B[Response]\n```\n\n![Local graphic](assets/chart.svg)\n\n<table><tr><td>Rendered table</td></tr></table>\n<script>window.__unsafe=true</script>' } },
    ] });
  });
  await page.evaluate(() => {
    const rows=window.__state.transcript.slice(); const last=rows.at(-1);
    last.item.text += String.raw`

Inline loss $\mathcal{L}=\frac{1}{N}\sum_{i=1}^N (y_i-\hat y_i)^2$.

$$
\begin{aligned}\nabla_{\theta}\mathcal{L} &= X^\top(X\theta-y) \\\ W &= \begin{bmatrix}1&2\\3&4\end{bmatrix}\end{aligned}
$$

Escaped delimiters \(\alpha+\beta\) and \[\int_0^1 x^2\,dx=\frac{1}{3}\].`;
    window.__replace({transcript:rows});
  });
  await page.locator('.katex-display').first().waitFor();
  assert.ok(await page.locator('.katex').count() >= 4);
  const equation = page.locator('.katex').first();
  const latex = await equation.locator('annotation').textContent();
  await page.screenshot({ path: `${evidence}/chat-math-before-copy.png` });
  await equation.locator('.katex-html .mord').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy LaTeX', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__requests.findLast(request => request.method === 'copyText').params.text), latex);
  await equation.locator('.katex-html .mord').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy MathML', exact: true }).click();
  assert.ok((await page.evaluate(() => window.__requests.findLast(request => request.method === 'copyText').params.text)).startsWith('<math'));
  const displayEquation = page.locator('.katex-display .katex').first();
  await displayEquation.locator('.katex-html .mord').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy LaTeX with delimiters', exact: true }).click();
  assert.ok((await page.evaluate(() => window.__requests.findLast(request => request.method === 'copyText').params.text)).startsWith('$$\n'));
  await page.evaluate(() => { const rows=window.__state.transcript.slice();rows.at(-1).item.text+='\n\n```tex\n\\(literal code\\)\n```';window.__replace({transcript:rows}); });
  assert.equal(await page.locator('pre code.language-tex').textContent(), '\\(literal code\\)\n');
  await page.waitForFunction(() => document.fonts.check('16px KaTeX_Main') && document.fonts.check('16px KaTeX_Math'));
  assert.equal(await page.locator('.katex-error').count(), 0, 'ML equations and matrices must render without parse errors');
  await page.locator('.mermaid-svg svg').waitFor();
  assert.ok(await page.locator('.chat-image img').count() >= 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.chat-image img')].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  const visualFrame = page.frameLocator('iframe[title="Interactive graphic"]');
  await visualFrame.getByRole('button', { name: 'Count: 0' }).click();
  await visualFrame.getByRole('button', { name: 'Count: 1' }).waitFor();
  assert.equal(await visualFrame.locator('#counter').getAttribute('data-escaped'), 'false');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts allow-forms allow-popups allow-modals');
  assert.ok(await page.getByRole('textbox', { name: 'Message', exact: true }).count(), 'An HTML frame cannot send extension bridge events');
  await page.evaluate(() => document.documentElement.style.setProperty('--vscode-editor-foreground', '#121212'));
  await visualFrame.locator('body').evaluate((body) => new Promise((resolve) => { if(getComputedStyle(body).color==='rgb(18, 18, 18)')return resolve();new MutationObserver(()=>{if(getComputedStyle(body).color==='rgb(18, 18, 18)')resolve()}).observe(document.documentElement,{attributes:true}); }));
  await page.getByRole('button', { name: 'Expand diagram' }).click();
  await page.getByRole('dialog', { name: 'Mermaid diagram' }).waitFor();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.screenshot({ path: `${evidence}/chat-graphics-light.png` });
  await page.evaluate(() => { document.body.className='vscode-dark'; document.documentElement.style.setProperty('--vscode-editor-foreground','#f0f0f0'); document.documentElement.style.setProperty('--vscode-editor-background','#181818'); });
  await page.locator('.mermaid-svg svg').waitFor();
  await page.screenshot({ path: `${evidence}/chat-graphics-dark.png` });
  await page.setViewportSize({ width: 300, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Graphics must fit the sidebar');
  await page.screenshot({ path: `${evidence}/chat-graphics-narrow.png` });
  // Reflow a tall graphic after paging through a long conversation, then Latest
  // must reach the measured bottom rather than the earlier virtual estimate.
  await page.evaluate(() => {
    const { user, assistant } = window.__fixtures;
    const earlier = Array.from({ length: 25 }, (_, index) => [
      { ...user, key: `rich-prompt-${index}`, item: { ...user.item, id: `rich-prompt-${index}`, text: `Rich prompt ${index}` } },
      { ...assistant, key: `rich-answer-${index}`, item: { ...assistant.item, id: `rich-answer-${index}`, text: `Rich answer ${index}` } },
    ]).flat();
    window.__replace({ transcript: [...earlier, ...window.__state.transcript.map(row => row.key === 'visual-html' ? { ...row, item: { ...row.item, output: { htmlRender: { attachmentId: 'fixture-html', title: 'Interactive graphic', height: 1650, heights: [[360, 1422], [728, 728]] } } } } : row)] });
  });
  const richRail = page.getByRole('listbox', { name: 'Past messages' });
  await richRail.focus(); await richRail.press('Home'); await richRail.press('Enter');
  await page.locator('.timeline-row .user-message').getByText('Rich prompt 0', { exact: true }).waitFor();
  await richRail.press('End'); await richRail.press('Enter');
  await page.locator('iframe[title="Interactive graphic"]').waitFor();
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.getByRole('button', { name: 'Jump to latest message' }).click();
  await page.getByRole('button', { name: 'Jump to latest message' }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => { const scroller=document.querySelector('.transcript-list');return scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<40; });
  // Paste into the middle of a paragraph and preserve the provider reference position.
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Compare here then explain.');
  await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate(element => { element.focus(); element.setSelectionRange(12, 12); });
  // Paste the same image bytes a browser supplies for a system screenshot.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a53sAAAAASUVORK5CYII=';
  await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate((element, bytes) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await page.getByRole('button', { name: 'Preview clipboard.png', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.composer-attachment img')].some(image => image.complete && image.naturalWidth > 0));
  assert.match(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), /^Compare here!\[clipboard\.png\]\(t3-context:\/\/v1\/image\/image_[a-z0-9_-]+\) then explain\.$/);
  await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate(element => { element.setSelectionRange(30, 30); element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.getByRole('dialog', { name: 'clipboard.png', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await page.getByRole('button', { name: 'Remove outside-workspace.txt', exact: true }).waitFor();
  await page.screenshot({ path: `${evidence}/composer-attachments.png` });
  await page.getByRole('button', { name: 'Remove outside-workspace.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => window.__requests.some(request => request.method === 'sendMessage' && request.params.text.includes('t3-context://v1/image/') && request.params.attachmentIds?.includes('pending-pasted') && request.params.attachmentReferences?.[0]?.attachmentId === 'pending-pasted'));
  await page.waitForFunction(() => !document.querySelector('.composer-attachment'));
  assert.equal(await page.locator('.composer-attachment').count(), 0, 'Only a successful send clears attachment thumbnails');
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
  assert.equal(await page.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Draft survives server setup");
  // Subagent cards stay live after their parent transcript is already mounted.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.evaluate((initial) => {
    document.body.dataset.surface = 'panel';
    const parent = initial.threads[0];
    const child = { ...parent, id: 'subagent-one', title: 'Regression Audit', pinned: false, parentThreadId: parent.id, relationshipToParent: 'subagent', activityRunStatus: 'running', providerNativeSubagent: true };
    window.__replace({ ...initial, threads: [...initial.threads, child], transcript: [{ ...window.__fixtures.assistant, key: 'subagent-task', item: { ...window.__fixtures.assistant.item, id: 'subagent-task', type: 'subagent', status: 'completed', subagentId: 'task', origin: 'provider_native', driver: 'codex', providerInstanceId: 'codex', childThreadId: child.id, prompt: 'Check existing features', progress: 'Reviewing current changes', result: null, title: 'Regression Audit' } }] });
  }, initial);
  await page.getByRole('button', { name: 'Open subagent Regression Audit', exact: true }).hover();
  await page.getByRole('tooltip').getByText('Running', { exact: true }).waitFor();
  await page.evaluate(() => window.__replace({ threads: window.__state.threads.map((thread) => thread.id === 'subagent-one' ? { ...thread, activityRunStatus: null, pendingRuntimeRequest: { id: 'input', kind: 'user_input', createdAt: '2026-10-06T12:00:00Z' } } : thread) }));
  await page.getByRole('tooltip').getByText('Input needed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open subagent Regression Audit', exact: true }).click();
  await page.locator('.subagent-parent-link').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).isDisabled(), true);
  await page.locator('.subagent-parent-link').click();
  await page.waitForFunction(() => document.querySelector('.chat-main').dataset.threadId === 'thread-one');
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).isDisabled(), false);
  await page.evaluate(() => { document.body.dataset.surface = 'sidebar'; window.__replace({ threads: [...window.__state.threads, { ...window.__state.threads.find((thread) => thread.id === 'subagent-one'), id: 'subagent-archive', title: 'Archived Audit', archived: true, pendingRuntimeRequest: null }, { ...window.__state.threads.find((thread) => thread.id === 'subagent-one'), id: 'subagent-settled', title: 'Settled Audit', settled: true, pendingRuntimeRequest: null }], archiveLoaded: true }); });
  await page.setViewportSize({ width: 360, height: 820 });
  await page.locator('.dedicated-sessions').waitFor();
  await page.evaluate(() => {
    document.body.className = 'vscode-light';
    for (const [key, value] of Object.entries({ foreground: '#202020', 'editor-foreground': '#202020', 'editor-background': '#ffffff', 'sideBar-background': '#f3f3f3', 'sideBar-foreground': '#202020', 'list-activeSelectionBackground': '#005fb8', 'list-activeSelectionForeground': '#ffffff', 'input-background': '#ffffff', 'input-foreground': '#202020' })) document.documentElement.style.setProperty(`--vscode-${key}`, value);
  });
  assert.equal(await page.locator('.project-heading').count(), 0);
  assert.equal(await page.locator('.session-list > .session-tree-node').count() > 0, true);
  assert.equal(await page.locator('.history-heading').getByRole('button', { name: 'New thread', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /^New thread in / }).count(), 0);
  assert.equal(await page.locator('.session-list .thread[data-thread-id="subagent-one"]').count(), 0);
  await page.locator('.session-list').getByRole('button', { name: 'Expand subagents of Migrate the T3 chat experience', exact: true }).click();
  await page.locator('.session-list .thread[data-thread-id="subagent-one"]').waitFor();
  assert.equal(await page.locator('.session-list .thread[data-thread-id="subagent-archive"]').count(), 0);
  const archiveShelf = page.locator('.history-shelf').filter({ hasText: 'Archive' });
  await archiveShelf.locator('summary').click();
  await archiveShelf.getByRole('button', { name: 'Expand subagents of Migrate the T3 chat experience', exact: true }).click();
  await archiveShelf.locator('.thread[data-thread-id="subagent-archive"]').waitFor();
  assert.equal(await archiveShelf.locator('.thread[data-thread-id="subagent-one"]').count(), 0);
  const settledShelf = page.locator('.history-shelf').filter({ hasText: 'Settled' });
  await settledShelf.locator('summary').click();
  // Branch expansion follows the same parent within this session-manager surface.
  if (await settledShelf.getByRole('button', { name: 'Expand subagents of Migrate the T3 chat experience', exact: true }).count()) await settledShelf.getByRole('button', { name: 'Expand subagents of Migrate the T3 chat experience', exact: true }).click();
  await settledShelf.locator('.thread[data-thread-id="subagent-settled"]').waitFor();
  await page.getByRole('textbox', { name: 'Search threads' }).fill('Regression Audit');
  await page.locator('.session-list .thread[data-thread-id="subagent-one"]').waitFor();
  assert.equal(await page.locator('.session-list .thread[data-thread-id="subagent-archive"]').count(), 0);
  await page.screenshot({ path: `${evidence}/subagent-session-tree.png` });
  await page.getByRole('textbox', { name: 'Search threads' }).fill('');
  // Wide editors retain the virtualized single-column layout after removing the reader.
  await page.setViewportSize({ width: 1640, height: 920 });
  await page.evaluate(() => {
    document.body.dataset.surface = 'panel';
    const { user, assistant } = window.__fixtures;
    const transcript = [];
    for (let index = 0; index < 30; index++) {
      transcript.push({ ...user, key: `wide-user-${index}`, item: { ...user.item, id: `wide-user-${index}`, text: `Reading prompt ${index}`, attachments: [] } });
      transcript.push({ ...assistant, key: `wide-reply-${index}`, item: { ...assistant.item, id: `wide-reply-${index}`, messageId: `wide-message-${index}`, text: `Reading response ${index}. The equation stays with its explanation.\n\n$$\n${Array.from({ length: 50 }, (_, term) => `x_{${term}}`).join('+')}\n$$\n\nContinue reading in one column.`, streaming: false } });
    }
    window.__replace({ ...window.__initialForWide, activeThreadId: 'thread-one', transcript, history: { hasMore: false, loading: false, error: null }, pending: { approvals: [], userInputs: [] } });
  });
  await page.locator('[data-reading-layout="one"] .transcript-list').waitFor();
  assert.equal(await page.locator('.reader-flow, .reader-toggle, .composer-layout-control').count(), 0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft preserved while resizing the editor');
  const originalTextarea = await page.getByRole('textbox', { name: 'Message', exact: true }).elementHandle();
  assert.ok(await page.locator('.timeline-row').count() < 60, 'Wide conversations must remain virtualized');
  const wideMath = page.locator('.katex-display').last();
  assert.equal(await wideMath.evaluate(element => element.scrollWidth > element.clientWidth), true, 'Wide equations retain horizontal scrolling');
  await wideMath.locator('.katex').click();
  await page.getByRole('dialog', { name: 'Equation preview', exact: true }).waitFor();
  await page.locator('.equation-preview .katex').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy LaTeX with delimiters', exact: true }).click();
  assert.ok((await page.evaluate(() => window.__requests.findLast(request => request.method === 'copyText').params.text)).startsWith('$$\n'), 'Preview copying preserves display-equation delimiters');
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.screenshot({ path: `${evidence}/single-column-wide.png` });
  await page.setViewportSize({ width: 620, height: 900 });
  await page.locator('[data-reading-layout="one"] .transcript-list').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'Draft preserved while resizing the editor');
  assert.equal(await originalTextarea.evaluate(element => element === document.querySelector('textarea[aria-label="Message"]')), true);
  assert.equal(await page.locator('.reader-flow, .reader-toggle, .composer-layout-control').count(), 0);
  console.log('PASS: virtualized single-column chat in wide/narrow editors, draft retention on resize, wide equation scrolling, preview and delimiter-aware copying');
  assert.deepEqual(errors, []);
  console.log("PASS: configurable instant message rail, pagination, virtualized jumps, streaming read position, nested subagents/live hover cards/parent return, native frame bridge, interactive HTML, images, Mermaid, KaTeX and equation copying; markdown, collapsed work groups, tool details, diff, model catalog, modes, send, approvals, questions, narrow navigation, themes, virtualization, projectless first message, draft controls, folder selection, empty model catalog");
  console.log(`Screenshots: ${evidence}`);
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
