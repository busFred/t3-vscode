/** Verify both real VS Code surfaces against an explicitly isolated T3 server. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
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
await writeFile(join(profile, "User/settings.json"), JSON.stringify({
  "t3-vscode.t3Home": home, "workbench.startupEditor": "none", "workbench.colorTheme": "Default Dark Modern",
  "security.workspace.trust.enabled": false, "update.mode": "none", "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false, "window.zoomLevel": 0,
}));
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const log = createWriteStream(join(profile, "code.log"));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("T3") && !["ELECTRON_RUN_AS_NODE", "VITE_HTTP_URL", "VITE_WS_URL"].includes(key)));
const child = spawn(process.env.VSCODE_BIN ?? "/usr/share/code/code", [
  "--no-sandbox", "--disable-gpu", "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust",
  `--user-data-dir=${profile}`, `--extensions-dir=${profile}/extensions`, `--remote-debugging-port=${port}`,
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
const sessions = [];
async function findWebview(surface) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`${origin}/json/list`)).json();
    for (const target of targets.filter((target) => target.url.startsWith("vscode-webview:"))) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
      const session = new WebviewSession(socket); await session.send("Runtime.enable");
      for (const contextId of session.contexts) {
        if (await session.evaluate(`document.body?.dataset.surface === ${JSON.stringify(surface)}`, contextId).catch(() => false)) {
          session.contextId = contextId; sessions.push(session); return session;
        }
      }
      session.close();
      // Content frames may still be loading, so an unmatched target is retried.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No ${surface} webview. Inspect ${profile}/logs.`);
}
let browser;
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`VS Code exited; inspect ${profile}/code.log`);
    try { await fetch(`${origin}/json/version`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  browser = await chromium.connectOverCDP(origin);
  const workbench = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().includes("workbench"));
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
  await nativeAction("New Thread").click();
  await sidebar.wait('document.querySelector(".chat-empty")');
  await sidebar.evaluate(`(() => {
    const input = document.querySelector('textarea[aria-label="Message"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Reply with exactly: VSCODE-EDH-M1-OK');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sidebar.wait('!document.querySelector(".send-button").disabled');
  await sidebar.evaluate('document.querySelector(".send-button").click()');
  const reply = '[...document.querySelectorAll(".assistant-message")].some(node => node.textContent.includes("VSCODE-EDH-M1-OK") && !node.querySelector(".streaming-label"))';
  await sidebar.wait(reply, 150_000);
  const selectedTitle = await sidebar.evaluate('document.querySelector(".thread.active .thread-title")?.textContent');
  assert.ok(selectedTitle);
  console.log("PASS: native thread navigation, new thread, real message/reply, no duplicate sidebar header");
  await workbench.screenshot({ path: join(evidence, "edh-sidebar.png") });
  await nativeAction("Open Chat in Editor Tab").click();
  const panel = await findWebview("panel");
  await panel.wait('document.querySelector(".chat-empty")');
  assert.equal(await panel.evaluate('document.querySelector(".chat-heading strong")?.textContent'), "New conversation");
  await panel.evaluate(`(() => {
    const thread = [...document.querySelectorAll('.thread')].find(button => button.querySelector('.thread-title')?.textContent === ${JSON.stringify(selectedTitle)});
    if (!thread) throw new Error('Sidebar conversation missing from the scoped thread list.');
    thread.click();
  })()`);
  await panel.wait(reply);
  assert.equal(await panel.evaluate('!!document.querySelector(".chat-header")'), true);
  await panel.evaluate(`document.querySelector('.chat-header [aria-label="New thread"]').click()`);
  await panel.wait('document.querySelector(".chat-empty")');
  await sidebar.wait(reply);
  console.log("PASS: editor tab starts blank, can select the sidebar conversation, and creates a new thread without switching the sidebar");
  await workbench.screenshot({ path: join(evidence, "edh-both.png") });
  console.log(`Evidence: ${evidence}; isolated VS Code profile: ${profile}`);
} finally {
  for (const session of sessions) session.close();
  await browser?.close();
  if (child.pid && child.exitCode === null) child.kill("SIGTERM");
  log.end();
}
