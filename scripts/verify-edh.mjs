/** Verify both real VS Code surfaces against an explicitly isolated T3 server. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, watch } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
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
const runtime = JSON.parse(await readFile(join(home, "userdata/server-runtime.json"), "utf8"));
assert.ok(runtime.pid && runtime.origin, "Start an isolated T3 server first.");
process.kill(runtime.pid, 0);
const profile = await mkdtemp(join(tmpdir(), "t3-vscode-edh-"));
const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-ui";
await mkdir(evidence, { recursive: true });
await mkdir(join(profile, "User"));
await mkdir(join(home, "workspace"), { recursive: true });
// Carry Default preferences into disposable storage; never share its extension catalog.
for (const file of ["settings.json", "keybindings.json"]) {
  await cp(join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Code/User", file), join(profile, "User", file)).catch((error) => { if (error.code !== "ENOENT") throw error; });
}
const require = createRequire(import.meta.url);
const jsonc = createRequire(require.resolve("@vscode/vsce"))("jsonc-parser");
const settingsFile = join(profile, "User/settings.json");
let settingsText = await readFile(settingsFile, "utf8").catch(() => "{}");
for (const [key, value] of Object.entries({ "update.mode": "none", "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "window.zoomLevel": 0, "security.workspace.trust.enabled": false })) {
  settingsText = jsonc.applyEdits(settingsText, jsonc.modify(settingsText, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
}
await writeFile(settingsFile, settingsText);
await mkdir(join(home, "workspace/.vscode"), { recursive: true });
await writeFile(join(home, "workspace/.vscode/settings.json"), JSON.stringify({
  "t3-vscode.t3Home": home, "workbench.startupEditor": "none", "workbench.colorTheme": "Default Dark Modern",
  "workbench.iconTheme": null,
  "chat.disableAIFeatures": true,
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
  }
  async send(method, params = {}) {
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
      let timer; const observer = new MutationObserver(check);
      function check() { if (${expression}) { clearTimeout(timer); observer.disconnect(); resolve(true); } }
      timer = setTimeout(() => { observer.disconnect(); reject(new Error('Webview condition timed out')); }, ${timeout});
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
          session.contextId = contextId; session.targetId = target.id; sessions.push(session); return session;
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
  await workbench.locator('.action-label[aria-label="T3 Code"]').first().click();
  const sidebar = await findWebview("sidebar");
  await sidebar.wait('document.querySelector(".composer-box")');
  assert.equal(await sidebar.evaluate('!!document.querySelector(".chat-header")'), false, "Sidebar must use the native title toolbar only");
  const nativeAction = (label) => workbench.locator(`[aria-label="${label}"]`).filter({ visible: true }).first();
  await nativeAction("Projects and Threads").click();
  await sidebar.wait('document.querySelector(".navigation-open .project-groups")');
  await nativeAction("Projects and Threads").click();
  await sidebar.wait('!document.querySelector(".navigation-open")');
  const beforeNewThread = await sidebar.evaluate('document.querySelector(".chat-main")?.dataset.threadId');
  await nativeAction("New Thread").click();
  await sidebar.wait(`document.querySelector('.chat-empty') && document.querySelector('.chat-main')?.dataset.threadId && document.querySelector('.chat-main').dataset.threadId !== ${JSON.stringify(beforeNewThread)}`);
  await sidebar.evaluate(`(() => {
    const input = document.querySelector('textarea[aria-label="Message"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Reply with exactly: VSCODE-EDH-M1-OK');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sidebar.wait('!document.querySelector(".send-button").disabled');
  await sidebar.evaluate('document.querySelector(".send-button").click()');
  console.log("Sent the test message through the actual VS Code sidebar.");
  const reply = '[...document.querySelectorAll(".assistant-message")].some(node => node.textContent.includes("VSCODE-EDH-M1-OK") && !node.querySelector(".streaming-label"))';
  await sidebar.wait(reply, 150_000);
  const selectedId = await sidebar.evaluate('document.querySelector(".chat-main")?.dataset.threadId');
  assert.ok(selectedId);
  console.log("PASS: native thread navigation, new thread, real message/reply, no duplicate sidebar header");
  await workbench.screenshot({ path: join(evidence, "edh-sidebar.png") });
  await nativeAction("Open Chat in Editor Tab").click();
  const panel = await findWebview("panel");
  await panel.wait('document.querySelector(".chat-empty")');
  assert.equal(await panel.evaluate('document.querySelector(".chat-empty h1")?.textContent'), "What would you like to build?");
  assert.equal(await panel.evaluate('document.querySelector(".chat-heading strong")?.textContent'), "New conversation");
  await panel.evaluate(`(() => {
    const thread = [...document.querySelectorAll('.thread')].find(button => button.dataset.threadId === ${JSON.stringify(selectedId)});
    if (!thread) throw new Error('Sidebar conversation missing from the scoped thread list.');
    thread.click();
  })()`);
  await panel.wait(reply);
  assert.equal(await panel.evaluate('!!document.querySelector(".chat-header")'), true);
  await panel.evaluate(`document.querySelector('.chat-header [aria-label="New thread"]').click()`);
  await panel.wait('document.querySelector(".chat-empty")');
  await sidebar.wait(reply);
  console.log("PASS: editor tab starts blank, can select the sidebar conversation, and creates a new thread without switching the sidebar");
  await panel.evaluate(`document.querySelector('.chat-header [aria-label="T3 Code settings"]').click()`);
  await workbench.locator('.settings-editor').waitFor();
  const settings = ['fontSizeInterface', 'fontSizePrompt', 'fontSizeCode'];
  for (const [index, key] of settings.entries()) {
    const row = workbench.locator('.setting-item-contents').filter({ hasText: ['Font Size Interface', 'Font Size Prompt', 'Font Size Code'][index] });
    await row.waitFor();
    const input = row.locator('input[type="number"], input[type="text"]').first();
    const value = [18, 17, 16][index]; const persisted = preferenceWritten(`t3-vscode.${key}`, value);
    await input.focus(); await input.press('Control+a'); await input.pressSequentially(String(value)); await input.press('Tab');
    await persisted;
  }
  const fonts = 'getComputedStyle(document.documentElement).fontSize === "18px" && getComputedStyle(document.querySelector("textarea[aria-label=Message]")).fontSize === "17px" && getComputedStyle(document.documentElement).getPropertyValue("--font-size-code").trim() === "16px"';
  await sidebar.wait(fonts); await panel.wait(fonts);
  assert.ok((await readFile(join(profile, 'User/settings.json'), 'utf8')).includes('t3-vscode.fontSizeInterface'));
  assert.equal(await workbench.getByText('Unable to write to User Settings', { exact: false }).count(), 0);
  await workbench.screenshot({ path: join(evidence, "edh-native-settings.png") });
  console.log("PASS: all three font settings are registered in native VS Code Settings; editing them updates both chat views and persists in the disposable Default profile");
  await workbench.keyboard.press('Escape');
  await workbench.locator('.settings-editor').waitFor({ state: 'hidden' });
  await panel.evaluate(`document.querySelector('[aria-label="Choose model"]').click()`);
  await panel.wait('document.querySelector(".model-picker")');
  await panel.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search models"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'astra'); input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await panel.wait('document.querySelectorAll(".model-choice").length > 0');
  await panel.evaluate('document.querySelector(".model-favorite").click()');
  await panel.wait('document.querySelector(".model-favorite[aria-pressed=true]")');
  await panel.wait('document.querySelector(".model-choice:not(:disabled)")');
  await panel.evaluate(`document.querySelector('.model-choice').click()`);
  await panel.wait('!document.querySelector(".model-picker")');
  assert.equal(await panel.evaluate('!!document.querySelector("select[aria-label=\\"Interaction mode\\"]")'), false);
  const level = await panel.evaluate(`(() => {
    const select = document.querySelector('select[aria-label="Effort level"]');
    if (!select) return null;
    return [...select.options].find(option => option.value === 'max')?.value ?? [...select.options].find(option => option.value === 'high')?.value;
  })()`);
  assert.ok(level, "The real Codex catalog should advertise effort options");
  await panel.evaluate(`(() => { const select = document.querySelector('select[aria-label="Effort level"]'); select.value = ${JSON.stringify(level)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await panel.wait(`document.querySelector('select[aria-label="Effort level"]').value === ${JSON.stringify(level)} && !document.querySelector('select[aria-label="Effort level"]').disabled`);
  console.log("PASS: real model search, favorite persistence and capability-driven effort; no Code/Plan toggle");
  // Native editor selection and actual Alt+K command, including unsaved document text.
  await workbench.keyboard.press('Control+p');
  await workbench.locator('.quick-input-widget input').fill('example.ts');
  await workbench.locator('.quick-input-list').getByText('example.ts', { exact: true }).first().waitFor();
  await workbench.keyboard.press('Enter');
  await workbench.locator('.monaco-editor').filter({ visible: true }).first().waitFor();
  await workbench.keyboard.press('Control+Home'); await workbench.keyboard.press('ArrowDown'); await workbench.keyboard.press('End');
  await workbench.keyboard.insertText(' // unsaved test'); await workbench.keyboard.press('Home'); await workbench.keyboard.press('Shift+End');
  await workbench.keyboard.press('Alt+k');
  await panel.wait('document.querySelector(".context-label")?.textContent === "@example.ts:2"');
  assert.ok((await panel.evaluate('document.querySelector(".context-label").title')).includes('// unsaved test'));
  assert.equal(await sidebar.evaluate('document.querySelectorAll(".context-chip").length'), 0);
  assert.ok(!(await readFile(join(home, 'workspace/example.ts'), 'utf8')).includes('unsaved test'));
  await workbench.screenshot({ path: join(evidence, "edh-editor-reference.png") });
  console.log("PASS: native Alt+K captures the selected file range and unsaved text into one chat without saving the file or changing the other conversation");
  // A real assistant response can be selected and cited through the webview's DOM selection API.
  await sidebar.evaluate(`(() => {
    const source = [...document.querySelectorAll('[data-assistant-citation-source]')].find(node => node.textContent.includes('VSCODE-EDH-M1-OK'));
    const rect = source.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(source.querySelector('p'));
    source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    source.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }));
    source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 1, clientX: rect.right - 10, clientY: rect.bottom }));
  })()`);
  await sidebar.wait('document.querySelector(".citation-selection-button")');
  await sidebar.evaluate('document.querySelector(".citation-selection-button").click()');
  await sidebar.wait('document.querySelector(".citation-comment")');
  await sidebar.evaluate(`(() => {
    const input = document.querySelector('.citation-comment textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Explain this exact response.'); input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sidebar.evaluate('document.querySelector(".citation-comment .primary").click()');
  await sidebar.wait('document.querySelector(".context-label")?.title.includes("Explain this exact response.")');
  assert.equal(await panel.evaluate('document.querySelector(".context-label")?.textContent'), '@example.ts:2');
  await workbench.screenshot({ path: join(evidence, "edh-citation.png") });
  console.log("PASS: selection of a real assistant response opens an optional comment and adds a citation to its own composer; the editor tab retains its independent file reference");
  await workbench.screenshot({ path: join(evidence, "edh-both.png") });
  console.log(`Evidence: ${evidence}; isolated VS Code profile: ${profile}`);
} catch (error) {
  await workbench?.screenshot({ path: join(evidence, "edh-failure.png") }).catch(() => {});
  console.error(`Inspect ${profile}/code.log and ${evidence}/edh-failure.png`);
  throw error;
} finally {
  for (const session of sessions) session.close();
  await browser?.close();
  if (child.pid && child.exitCode === null) child.kill("SIGTERM");
  log.end();
}
