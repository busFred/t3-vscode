/** Verify both real VS Code surfaces against an explicitly isolated T3 server. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, watch } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Usage: node scripts/verify-edh.mjs --base-dir <isolated-home>");
const home = await realpath(resolve(process.argv[flag + 1]));
const live = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
if (home === live || home.startsWith(`${live}/`)) throw new Error("Never run verification against live ~/.t3.");
const setupOnly = process.argv.includes('--setup-only');
const requestsOnly = process.argv.includes('--requests-only');
const referencesOnly = process.argv.includes('--references-only');
const visualsOnly = process.argv.includes('--visuals-only');
const cleanupOnly = process.argv.includes('--cleanup-only');
const screenshotsOnly = process.argv.includes('--screenshots-only');
const testModel = process.env.T3_VSCODE_TEST_MODEL || 'gpt-6-luna';
if (!setupOnly) {
  const runtime = JSON.parse(await readFile(join(home, "userdata/server-runtime.json"), "utf8"));
  assert.ok(runtime.pid && runtime.origin, "Start an isolated T3 server first.");
  process.kill(runtime.pid, 0);
}
const profile = await mkdtemp(join(tmpdir(), "t3-vscode-edh-"));
const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-ui";
await mkdir(evidence, { recursive: true });
await mkdir(join(profile, "User"));
await mkdir(join(home, "workspace"), { recursive: true });
if (process.argv.includes("--deep")) await rm(join(home, "workspace/roundtrip.txt"), { force: true });
// Carry Default preferences into disposable storage; never share its extension catalog.
for (const file of screenshotsOnly ? [] : ["settings.json", "keybindings.json"]) {
  await cp(join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Code/User", file), join(profile, "User", file)).catch((error) => { if (error.code !== "ENOENT") throw error; });
}
const require = createRequire(import.meta.url);
const jsonc = createRequire(require.resolve("@vscode/vsce"))("jsonc-parser");
const settingsFile = join(profile, "User/settings.json");
let settingsText = await readFile(settingsFile, "utf8").catch(() => "{}");
for (const [key, value] of Object.entries({ "update.mode": "none", "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "window.zoomLevel": 0, "window.dialogStyle": "custom", "t3-vscode.fontSizeInterface": 16, "t3-vscode.fontSizePrompt": 14, "t3-vscode.fontSizeCode": 13, "security.workspace.trust.enabled": false })) {
  settingsText = jsonc.applyEdits(settingsText, jsonc.modify(settingsText, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
}
if (visualsOnly) settingsText = jsonc.applyEdits(settingsText, jsonc.modify(settingsText, ['files.simpleDialog.enable'], true, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
await writeFile(settingsFile, settingsText);
await mkdir(join(home, "workspace/.vscode"), { recursive: true });
await writeFile(join(home, "workspace/.vscode/settings.json"), JSON.stringify({
  "t3-vscode.t3Home": home, "workbench.startupEditor": "none", "workbench.colorTheme": "Default Dark Modern",
  "workbench.iconTheme": null,
  "diffEditor.renderSideBySide": true, "diffEditor.useInlineViewWhenSpaceIsLimited": false,
  "chat.disableAIFeatures": true,
  ...(screenshotsOnly ? { "t3-vscode.usage.followActiveConversation": false } : {}),
}));
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const log = createWriteStream(join(profile, "code.log"));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("T3") && !["ELECTRON_RUN_AS_NODE", "VITE_HTTP_URL", "VITE_WS_URL"].includes(key)));
const child = spawn(process.env.VSCODE_BIN ?? "/usr/share/code/code", [
  "--no-sandbox", "--disable-gpu", "--new-window", "--profile=Default", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust",
  `--user-data-dir=${profile}`, `--extensions-dir=${profile}/extensions`, `--shared-data-dir=${profile}/shared-data`, `--remote-debugging-port=${port}`,
  `--extensionDevelopmentPath=${fileURLToPath(new URL("..", import.meta.url))}`, join(home, "workspace"),
], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log); child.stderr.pipe(log);
let launchError;
child.on("error", (error) => { launchError = error; });
const origin = `http://127.0.0.1:${port}`;

// Electron exposes webviews as separate iframe CDP targets. Playwright controls
// the workbench; these sessions exercise the actual postMessage app inside it.
class WebviewSession {
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map(); this.contexts = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.executionContextCreated" && message.params.context.auxData?.isDefault) this.contexts.push(message.params.context.id);
      if (!message.id) return;
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    };
    socket.onclose = () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("CDP target closed")); }
      this.pending.clear();
    };
  }
  async send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP target closed");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 160_000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, contextId = this.contextId) {
    const result = await this.send("Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  wait(expression, timeout = 30_000) {
    return this.evaluate(`new Promise((resolve, reject) => {
      let timer, poll; const observer = new MutationObserver(check);
      function check() { if (${expression}) { clearTimeout(timer); clearInterval(poll); observer.disconnect(); resolve(true); } }
      timer = setTimeout(() => { clearInterval(poll); observer.disconnect(); reject(new Error('Webview condition timed out')); }, ${timeout});
      // Form values and computed theme styles can change without a DOM mutation.
      poll = setInterval(check, 100);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); check();
    })`);
  }
  close() { this.socket.close(); }
}
function preferenceWritten(key, value) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { watcher.close(); reject(new Error(`Native setting ${key} was not saved`)); }, 10_000);
    const watcher = watch(join(profile, "User"), async () => {
      const settings = await readFile(settingsFile, "utf8").then((text) => jsonc.parse(text)).catch(() => null);
      if (settings?.[key] === value) { clearTimeout(timer); watcher.close(); resolve(); }
    });
  });
}
const sessions = [];
async function findWebview(surface) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`${origin}/json/list`)).json();
    for (const target of targets.filter((target) => target.url.startsWith("vscode-webview:") && !sessions.some((session) => session.targetId === target.id))) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
      const session = new WebviewSession(socket); await session.send("Runtime.enable");
      for (const contextId of session.contexts) {
        if (await session.evaluate(`document.body?.dataset.surface === ${JSON.stringify(surface)}`, contextId).catch(() => false)) {
          session.contextId = contextId; session.targetId = target.id; session.surface = surface; sessions.push(session);
          await session.evaluate(`window.__bridgeSeen=[];window.addEventListener('message',event=>window.__bridgeSeen.push({event:event.data?.event,id:event.data?.id,parent:event.source===window.parent,self:event.source===window,origin:event.origin}));`);
          return session;
        }
      }
      session.close();
      // Content frames may still be loading, so an unmatched target is retried.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No ${surface} webview. Inspect ${profile}/logs.`);
}
let browser; let workbench;
async function chooseLiveTestModel(view, favorite = false) {
  await view.evaluate('document.querySelector(\'[aria-label="Choose model"]\').click()');
  await view.wait('document.querySelector(".model-picker")');
  await view.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search models"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(testModel)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const selector = `.model-choice[title=${JSON.stringify(testModel)}]:not(:disabled)`;
  await view.wait(`document.querySelector(${JSON.stringify(selector)})`);
  if (favorite) {
    await view.evaluate(`(() => { const button=document.querySelector(${JSON.stringify(selector)}).closest('.model-row').querySelector('.model-favorite');if(button.getAttribute('aria-pressed') !== 'true')button.click(); })()`);
    await view.wait(`document.querySelector(${JSON.stringify(selector)})?.closest('.model-row').querySelector('.model-favorite').getAttribute('aria-pressed') === 'true'`);
  }
  await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await view.wait('!document.querySelector(".model-picker")');
  const level = await view.evaluate(`(() => { const select=document.querySelector('select[aria-label="Effort level"]'); return select && [...select.options].find(option=>option.value==='low')?.value; })()`);
  if (level) {
    await view.evaluate(`(() => { const select=document.querySelector('select[aria-label="Effort level"]');select.value=${JSON.stringify(level)};select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await view.wait(`document.querySelector('select[aria-label="Effort level"]').value === ${JSON.stringify(level)} && !document.querySelector('select[aria-label="Effort level"]').disabled`);
  }
}
async function runCommand(label) {
  await workbench.keyboard.press('F1');
  await workbench.locator('.quick-input-widget input').filter({ visible: true }).fill(`>${label}`);
  await workbench.locator('.quick-input-list .monaco-list-row').filter({ hasText: label }).first().waitFor();
  await workbench.keyboard.press('Enter');
}
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`VS Code exited; inspect ${profile}/code.log`);
    try { await fetch(`${origin}/json/version`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  browser = await chromium.connectOverCDP(origin);
  workbench = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().includes("workbench"));
  assert.ok(workbench);
  await workbench.locator('.action-label[aria-label="T3 VSCode"]').first().click();
  const sidebar = await findWebview("sidebar");
  if (setupOnly) {
    await sidebar.wait('document.querySelector(".server-setup")');
    assert.equal(await sidebar.evaluate('document.querySelector(".server-setup h1").textContent'), 'T3 VSCode');
    assert.equal(await sidebar.evaluate('document.querySelectorAll(".setup-command").length'), 2);
    assert.ok((await sidebar.evaluate('document.querySelector(".server-setup").textContent')).includes('Remote servers aren’t supported'));
    await workbench.screenshot({ path: join(evidence, 'edh-server-setup.png') });
    await sidebar.evaluate(`new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Retry did not finish')); }, 30_000);
      function receive(event) { if (event.data?.id && event.data.result?.phase === 'no-server') { clearTimeout(timer); window.removeEventListener('message', receive); resolve(true); } }
      window.addEventListener('message', receive);
      document.querySelector('.setup-actions .primary').click();
    })`);
    await sidebar.wait('document.querySelector(".server-setup")');
    await sidebar.evaluate(`document.querySelector('.setup-actions button:last-child').click()`);
    await workbench.locator('.settings-editor').waitFor();
    assert.equal(await workbench.getByText('Unable to write to User Settings', { exact: false }).count(), 0);
    console.log('PASS: missing-server setup has install/service/manual guidance, Retry and native extension Settings');
  } else if (referencesOnly) {
    await sidebar.wait('document.querySelector(".dedicated-sessions")');
    const nativeAction = (label) => workbench.locator(`[aria-label="${label}"]`).filter({ visible: true }).first();
    const selectFileLine = async (line) => {
      await workbench.keyboard.press('Control+p');
      await workbench.locator('.quick-input-widget input').filter({ visible: true }).fill(join(home, 'workspace/example.ts'));
      await workbench.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'example.ts' }).first().waitFor();
      await workbench.keyboard.press('Enter');
      await workbench.locator('.editor-instance .view-lines').filter({ visible: true }).first().waitFor();
      await workbench.keyboard.press('Control+Home');
      for (let index = 1; index < line; index++) await workbench.keyboard.press('ArrowDown');
      await workbench.keyboard.press('Home'); await workbench.keyboard.press('Shift+End');
    };
    await selectFileLine(1); await workbench.keyboard.press('Alt+k');
    const chat = await findWebview('panel'); await chat.wait('document.querySelectorAll(".context-chip").length === 1');
    assert.equal(await sidebar.evaluate('document.querySelectorAll("textarea,.context-chip").length'), 0);
    await runCommand('T3 VSCode: Account & Usage'); await sidebar.wait('document.querySelector(".account-usage").open');
    await selectFileLine(2); await workbench.keyboard.press('Alt+k');
    await chat.wait('document.querySelectorAll(".context-chip").length === 2');
    assert.equal(await sidebar.evaluate('document.querySelectorAll(".context-chip").length'), 0);
    await workbench.screenshot({ path: join(evidence, 'edh-usage-reference-routing.png') });
    console.log('PASS: native Alt+K opens an editor chat when none exists and retains that target after Account & Usage focuses the session manager');
  } else if (requestsOnly) {
    await sidebar.wait('document.querySelector(".dedicated-sessions")');
    // Remove notifications replayed on startup before generating a fresh request.
    await workbench.keyboard.press('F1');
    await workbench.locator('.quick-input-widget input').filter({ visible: true }).fill('>Notifications: Clear All Notifications');
    await workbench.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Notifications: Clear All Notifications' }).waitFor();
    await workbench.keyboard.press('Enter');
    const helperCode = `import { HostState } from './src/host/hostState.ts'; import { T3Client } from './src/host/t3Client.ts'; import { configureLiveTestModel } from './scripts/liveTestModel.ts';
      let session = null; const host = new HostState({ home: ${JSON.stringify(home)}, workspaceRoot: () => ${JSON.stringify(join(home, 'workspace'))}, credentials: { get: async () => session, save: async value => { session = value; }, clear: async () => { session = null; } } }, new T3Client());
      try { await host.start(); if (host.snapshot().phase !== 'ready') throw new Error(host.snapshot().notice); for (const thread of host.snapshot().threads.filter(thread => thread.pendingRuntimeRequest)) { await host.selectThread(thread.id); await host.interrupt(thread.id); } await configureLiveTestModel(host); const id = await host.newThread(); await host.threadAction(id, 'rename', 'Notification verification'); await host.setModes(id, { interactionMode: 'plan' });
      await host.sendMessage('This is a UI verification. Use your request_user_input tool to ask exactly one required question: choose A or B, with two options A and B. Wait for my answer. Do not ask in plain text, edit files or perform any other work. After I answer, reply exactly NOTIFICATION-ANSWERED.', id); console.log(id); } finally { await host.dispose(); }`;
    const helper = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', helperCode], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
    let helperOutput = '', helperError = ''; helper.stdout.on('data', data => { helperOutput += data; }); helper.stderr.on('data', data => { helperError += data; });
    const helperExit = await new Promise((resolve, reject) => { helper.on('error', reject); helper.on('exit', resolve); });
    assert.equal(helperExit, 0, helperError);
    const inputId = helperOutput.trim().split('\n').at(-1); assert.match(inputId, /^[a-z0-9-]+$/);
    await sidebar.wait(`document.querySelector('.thread[data-thread-id="${inputId}"] .thread-input')`, 90_000);
    assert.equal(await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${inputId}"]').getAttribute('aria-current')`), null, 'Request must notify for an unopened session');
    const notification = workbench.locator('.notification-list-item').filter({ hasText: 'needs your input' }).filter({ visible: true }).last();
    await notification.waitFor(); assert.ok((await notification.textContent()).includes('needs your input'));
    await workbench.screenshot({ path: join(evidence, 'edh-input-notification.png') });
    await sidebar.evaluate(`document.querySelector('.thread[data-thread-id="${inputId}"]').click()`);
    const inputPanel = await findWebview('panel');
    const inputTabs = workbench.locator('.tab');
    await inputTabs.first().waitFor(); assert.equal(await inputTabs.count(), 1);
    await workbench.keyboard.press('Control+p');
    await workbench.locator('.quick-input-widget input').filter({ visible: true }).fill(join(home, 'workspace/example.ts'));
    await workbench.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'example.ts' }).first().waitFor();
    await workbench.keyboard.press('Enter');
    await workbench.locator('.monaco-editor').filter({ visible: true }).first().waitFor();
    assert.equal(await inputTabs.count(), 2);
    await notification.getByRole('button', { name: 'Open session', exact: true }).click();
    const title = await inputPanel.evaluate('document.querySelector(".chat-heading strong").textContent');
    await workbench.waitForFunction(title => document.querySelector('.tab[aria-selected="true"]')?.textContent.includes(title), title);
    assert.equal(await inputTabs.count(), 2, 'Notification must reveal the existing tab instead of duplicating it');
    await inputPanel.wait(`document.querySelector('.chat-main')?.dataset.threadId === ${JSON.stringify(inputId)} && document.querySelector('.question-card')`);
    await inputPanel.evaluate(`document.querySelector('.question-card input[type=radio]').click()`);
    await inputPanel.wait('!document.querySelector(".question-card button[type=submit]").disabled');
    await inputPanel.evaluate(`document.querySelector('.question-card button[type=submit]').click()`);
    await sidebar.wait(`!document.querySelector('.thread[data-thread-id="${inputId}"] .thread-input')`);
    await inputPanel.wait(`[...document.querySelectorAll('.assistant-message')].some(node => node.textContent.includes('NOTIFICATION-ANSWERED') && !node.querySelector('.streaming-label'))`, 90_000);
    await workbench.screenshot({ path: join(evidence, 'edh-input-answered.png') });
    console.log('PASS: workspace Input badge and native notification; Open session reveals the existing conversation tab without duplication; answering clears the badge and resumes the provider');
  } else if (screenshotsOnly) {
    const { captureReadme } = await import('./capture-readme.mjs');
    await captureReadme({ home, workbench, sidebar, findWebview, runCommand });
  } else if (cleanupOnly) {
    const { verifyEmptyChat } = await import('./verify-rich-chat.mjs');
    await verifyEmptyChat({ workbench, sidebar, findWebview });
  } else if (visualsOnly) {
    const { verifyRichChat } = await import('./verify-rich-chat.mjs');
    await verifyRichChat({ home, evidence, workbench, sidebar, findWebview, chooseLiveTestModel, runCommand, async findVisualFrame() {
      const runtime = JSON.parse(await readFile(join(home, 'userdata/server-runtime.json'), 'utf8'));
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const targets = await (await fetch(`${origin}/json/list`)).json();
        for (const target of targets.filter(target => target.type === 'iframe' && target.url.startsWith(runtime.origin))) {
          const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
          const session = new WebviewSession(socket); await session.send('Runtime.enable');
          for (const contextId of session.contexts) if (await session.evaluate('!!document.querySelector(".mock")', contextId).catch(() => false)) {
            session.contextId = contextId; session.targetId = target.id; sessions.push(session); return session;
          }
          session.close();
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('No native HTML visualization frame');
    } });
  } else {
    const { verifyEditorChat } = await import('./verify-editor-chat.mjs');
    await verifyEditorChat({ home, evidence, profile, workbench, sidebar, findWebview, chooseLiveTestModel, runCommand, preferenceWritten });
  }
  console.log(`Evidence: ${evidence}; isolated VS Code profile: ${profile}`);
} catch (error) {
  await workbench?.screenshot({ path: join(evidence, "edh-failure.png") }).catch(() => {});
  console.error(`Inspect ${profile}/code.log and ${evidence}/edh-failure.png`);
  for(const session of sessions.filter(session => session.surface)) console.error(await session.evaluate('JSON.stringify({surface:document.body.dataset.surface,text:document.body.textContent.slice(0,1200),bridge:window.__bridgeSeen?.slice(-20)})').catch(()=>''));
  throw error;
} finally {
  for (const session of sessions) session.close();
  await browser?.close();
  if (child.pid && child.exitCode === null) child.kill("SIGTERM");
  log.end();
}
