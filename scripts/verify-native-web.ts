/** Feasibility check only: original server UI, isolated browser storage, no product UI replacement. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright-core";
import { EnvironmentId } from "@t3tools/contracts";
import { deriveLogicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import type { PairedSession } from "../src/host/pairing.js";
import type { HostStateSnapshot } from "../src/shared/bridge.js";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Usage: node --import tsx scripts/verify-native-web.ts --base-dir <isolated-home>");
const home = await realpath(resolve(process.argv[flag + 1]!));
const live = await realpath(join(homedir(), ".t3"));
if (home === live || home.startsWith(`${live}/`)) throw new Error("Never run verification against live ~/.t3.");
const runtime = JSON.parse(await readFile(join(home, "userdata/server-runtime.json"), "utf8")) as { origin: string; environmentId: string };
const evidence = process.env.T3_VSCODE_UI_EVIDENCE ?? "/tmp/t3-vscode-native-web";
await mkdir(evidence, { recursive: true });
let session: PairedSession | null = null;
const client = new T3Client();
const host = new HostState({ home, workspaceRoot: () => join(home, "workspace"), credentials: {
  get: async () => session, save: async (value) => { session = value; }, clear: async () => { session = null; },
}}, client);
const waitFor = (predicate: (state: HostStateSnapshot) => boolean) => new Promise<void>((resolve, reject) => {
  let off = () => {}; const timer = setTimeout(() => { off(); reject(new Error("Native UI seed state timed out")); }, 20_000);
  off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(); } });
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let debugPage: Page | undefined;
try {
  await host.start(); assert.equal(host.snapshot().phase, "ready");
  let sourceId: string | undefined;
  for (const candidate of [...host.snapshot().threads].reverse()) {
    await host.selectThread(candidate.id); await waitFor((state) => !state.threadLoading);
    if (host.snapshot().transcript.some(({ item }) => item.type === "assistant_message" && item.text.includes("example.ts#L2-L3"))) { sourceId = candidate.id; break; }
  }
  assert.ok(sourceId, "Run verify-edh first to create a completed provider response with a file link.");
  await host.threadAction(sourceId, "rename", "Native UI source");
  const secondId = host.snapshot().threads.find((thread) => thread.title === "Native UI second")?.id ?? await host.newThread(); await host.threadAction(secondId, "rename", "Native UI second");
  const thirdId = host.snapshot().threads.find((thread) => thread.title === "Native UI third")?.id ?? await host.newThread(); await host.threadAction(thirdId, "rename", "Native UI third");
  const projectId = host.snapshot().threads.find((thread) => thread.id === sourceId)!.projectId;
  const outside = join(home, "outside-workspace"); await mkdir(outside, { recursive: true });
  const shell = await client.snapshotShell();
  const foreignProject = shell.projects.find((project) => project.workspaceRoot === outside)?.id ?? await client.createProject(outside, "Unrelated native experiment");
  if (!shell.threads.some((thread) => thread.projectId === foreignProject)) await client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId: randomUUID(), projectId: foreignProject, title: "Unrelated native conversation",
    modelSelection: host.snapshot().threads.find((thread) => thread.id === sourceId)!.modelSelection, runtimeMode: "auto", interactionMode: "default",
    branch: null, worktreePath: null, createdBy: "user", creationSource: "web" });
  const envId = host.snapshot().environment!.environmentId;
  const project = (await client.snapshotShell()).projects.find((project) => project.id === projectId)!;
  const scopeKey = deriveLogicalProjectKey({ ...project, environmentId: EnvironmentId.make(envId) });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  await context.addInitScript(({ origin, scopeKey }) => {
    if (location.origin === origin) localStorage.setItem("t3code:ui-state:v1", JSON.stringify({ sidebarProjectScopeKey: scopeKey }));
  }, { origin: runtime.origin, scopeKey });
  const page = await context.newPage();
  debugPage = page;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("T3")));
  const pair = await promisify(execFile)("t3", ["pair", "--base-dir", home, "--label", "Native UI experiment"], { env });
  const token = /Token:\s*([0-9A-Z]{6,})/.exec(pair.stdout)?.[1]; assert.ok(token);
  await page.goto(`${runtime.origin}/pair#token=${token}`);
  const urlFor = (id: string) => `${runtime.origin}/${envId}/${id}`;
  await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
  await page.goto(urlFor(sourceId));
  await page.getByText("VSCODE-EDH-M1-OK", { exact: true }).first().waitFor();
  await page.getByText("Native UI second", { exact: true }).first().waitFor();
  assert.equal(await page.getByText("Unrelated native conversation", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Unrelated native experiment", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("t3code:ui-state:v1")!).sidebarProjectScopeKey), scopeKey);
  const second = await context.newPage(); await second.goto(urlFor(secondId));
  await second.getByText("Native UI second", { exact: true }).first().waitFor();
  await page.locator(`[data-thread-item="${envId}:${thirdId}"]`).click();
  await page.waitForURL(urlFor(thirdId)); assert.equal(second.url(), urlFor(secondId));
  await page.goto(urlFor(sourceId));
  const firstDraft = page.locator('[contenteditable="true"]').first();
  const secondDraft = second.locator('[contenteditable="true"]').first();
  await firstDraft.fill("Draft belongs to the source window"); await secondDraft.fill("Draft belongs to the second window");
  assert.equal(await firstDraft.textContent(), "Draft belongs to the source window");
  await page.locator('a[href*="example.ts"]').first().click();
  await page.locator('pre, code').filter({ hasText: "export const selected" }).first().waitFor();
  await page.screenshot({ path: join(evidence, "native-ui-file-panel.png") });
  await second.screenshot({ path: join(evidence, "native-ui-independent-window.png") });
  await writeFile(join(home, "native-web-experiment.json"), JSON.stringify({ origin: runtime.origin, projectId, scopeKey, sourceId, secondId, thirdId, url: urlFor(sourceId) }, null, 2));
  console.log("PASS: original T3 UI loads with a preset project filter; unrelated projects stay hidden and windows keep independent routes and drafts.");
  console.log("CONFIRMED: original file links open T3's file panel. A cooperative adapter is required to route them through VS Code's host bridge.");
  console.log(`Evidence: ${evidence}`);
} catch (cause) {
  await debugPage?.screenshot({ path: join(evidence, "native-web-failure.png") }).catch(() => {});
  if (debugPage) console.error((await debugPage.locator("body").innerText()).slice(0, 2500));
  throw new Error(cause instanceof Error ? cause.message : String(cause));
}
finally { await browser?.close(); await host.dispose(); }
