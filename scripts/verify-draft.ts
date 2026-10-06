/** Verify new-conversation settings and No project against a fresh, isolated server; no provider turn runs. */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import type { PairedSession } from "../src/host/pairing.js";
import type { HostStateSnapshot } from "../src/shared/bridge.js";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Usage: pnpm exec tsx scripts/verify-draft.ts --base-dir <fresh-isolated-home>");
const home = await realpath(resolve(process.argv[flag + 1]!));
const live = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
if (home === live || home.startsWith(`${live}/`)) throw new Error("Verification must not use the live ~/.t3 home.");
const workspace = join(home, "workspace");
let session: PairedSession | null = null;
let pickerCalls = 0;
const host = new HostState({ home, credentials: {
  get: async () => session, save: async (next) => { session = next; }, clear: async () => { session = null; },
}, pickProject: async () => { pickerCalls += 1; return { workspaceRoot: workspace }; } }, new T3Client());
function waitFor(predicate: (state: HostStateSnapshot) => boolean): Promise<HostStateSnapshot> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error("Timed out waiting for the isolated server's thread projection.")); }, 30_000);
    off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(state); } });
  });
}
try {
  await host.start();
  const initial = host.snapshot();
  assert.equal(initial.phase, "ready", initial.notice);
  assert.equal(initial.threads.length, 0, "Use a fresh isolated server for this verification.");
  assert.equal(initial.projects.length, 0, "Use a fresh isolated server for this verification.");
  assert.equal(initial.draft.supportsNoProject, true, "The isolated home must be outside a Git checkout.");
  const current = initial.draft.modelSelection;
  assert.ok(current, "Configure an installed provider with models.");
  const provider = initial.providers.find((entry) => entry.instanceId === current.instanceId)!;
  const model = provider.models.find((entry) => entry.slug !== current.model) ?? provider.models[0]!;
  const selection = { instanceId: provider.instanceId, model: model.slug };
  await host.setModel(undefined, selection);
  await host.setModes(undefined, { interactionMode: "plan", runtimeMode: provider.supportedRuntimeModes?.includes("full-access") ? "full-access" : initial.draft.runtimeMode });
  const draft = host.snapshot().draft;
  assert.equal(host.snapshot().projects.length, 0, "Editing draft controls must not create projects.");
  const id = await host.newThread();
  const created = await waitFor((state) => state.activeThreadId === id && !state.threadLoading);
  const thread = created.threads.find((entry) => entry.id === id)!;
  assert.deepEqual(thread.modelSelection, selection);
  assert.equal(thread.runtimeMode, draft.runtimeMode);
  assert.equal(thread.interactionMode, "plan");
  assert.equal(created.projects.find((entry) => entry.id === thread.projectId)?.title, "No project");
  assert.equal(pickerCalls, 0, "No project must not prompt for a folder.");
  await host.reconnect();
  const reconnected = await waitFor((state) => state.phase === "ready" && state.activeThreadId === id && !state.threadLoading);
  assert.deepEqual(reconnected.threads.find((entry) => entry.id === id)?.modelSelection, selection);
  assert.equal(reconnected.threads.find((entry) => entry.id === id)?.interactionMode, "plan");
  console.log("PASS: empty-window draft controls, No project creation, model/modes persisted across reconnect; no folder prompt");
  await mkdir(workspace, { recursive: true });
  await host.chooseProject();
  const folderThreadId = await host.newThread();
  const folderState = await waitFor((state) => state.activeThreadId === folderThreadId && !state.threadLoading);
  const folderThread = folderState.threads.find((entry) => entry.id === folderThreadId)!;
  assert.equal(folderState.projects.find((entry) => entry.id === folderThread.projectId)?.workspaceRoot, workspace);
  assert.equal(folderState.projects.length, 2);
  assert.equal(folderState.threads.length, 2);
  assert.equal(pickerCalls, 1);
  await writeFile(join(home, "verified-draft.json"), JSON.stringify(folderState, null, 2));
  console.log("PASS: optional folder selection creates a project and keeps No project conversations visible");
} finally { await host.dispose(); }
