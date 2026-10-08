/** Real scheduled-task RPC/dispatch verification; requires an explicitly isolated running T3 home. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import type { PairedSession } from "../src/host/pairing.js";
import type { HostStateSnapshot } from "../src/shared/bridge.js";
import type { TaskOrigin } from "../src/shared/scheduledTasks.js";
import { liveTestSelection } from "./liveTestModel.js";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Pass --base-dir <isolated-home>.");
const home = await realpath(resolve(process.argv[flag + 1]!));
const normal = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
if (home === normal || home.startsWith(`${normal}/`)) throw new Error("Never verify against normal T3 data.");
await mkdir(join(home, "workspace"), { recursive: true });
let session: PairedSession | null = null; const origins: TaskOrigin[] = []; const client = new T3Client();
const host = new HostState({ home, workspaceRoot: () => join(home, "workspace"), taskOrigins: () => origins, saveTaskOrigin: async (origin) => { origins.push(origin); },
  credentials: { get: async () => session, save: async (value) => { session = value; }, clear: async () => { session = null; } } }, client);
const waitFor = (predicate: (state: HostStateSnapshot) => boolean) => new Promise<HostStateSnapshot>((resolve, reject) => {
  let off = () => {}; const timer = setTimeout(() => { off(); reject(new Error("Scheduled task verification timed out.")); }, 150_000);
  off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(state); } });
});
try {
  await host.start(); assert.equal(host.snapshot().phase, "ready", host.snapshot().notice);
  if (host.snapshot().scheduledTasks?.error) throw new Error(host.snapshot().scheduledTasks!.error);
  const modelSelection = liveTestSelection(host.snapshot());
  assert.ok(modelSelection.options?.some((option) => option.value === "low"), "Live task tests require advertised low effort.");
  await host.setModel(undefined, modelSelection); const threadId = await host.newThread();
  const projectId = host.snapshot().threads.find((thread) => thread.id === threadId)!.projectId;
  const id = randomUUID();
  await host.saveScheduledTask({ id, existing: false, projectId, originThreadId: threadId, title: "Isolated scheduled task verification", prompt: "Reply with exactly SCHEDULED-LUNA-OK. Do not use tools.",
    enabled: false, schedule: { type: "interval", everyMs: 3_600_000 }, threadId, workspaceStrategy: { type: "root" }, modelSelection });
  const saved = host.snapshot().scheduledTasks!.tasks.find((task) => task.id === id)!;
  assert.deepEqual(saved.modelSelection, modelSelection); assert.equal(saved.enabled, false); assert.equal(saved.originThreadId, threadId);
  await host.saveScheduledTask({ ...saved, existing: true, title: "Verified task model override" });
  const fresh = (await client.listScheduledTasks()).tasks.find((task) => task.id === id)!;
  assert.deepEqual(fresh.modelSelection, modelSelection); assert.equal(fresh.title, "Verified task model override");
  assert.equal(fresh.runCount, 0, "Saving a disabled task must not run it");
  if (process.argv.includes("--run-turn")) {
    await host.runScheduledTask(id, projectId);
    await waitFor((state) => state.transcript.some(({ item }) => item.type === "assistant_message" && !item.streaming && item.text.includes("SCHEDULED-LUNA-OK")));
    const projection = await client.getThreadProjection(threadId);
    assert.ok(projection.messages.some((message) => message.scheduledTaskId === id), "The server attributes the scheduled message");
    const scheduledRun = projection.runs.find((run) => projection.messages.some((message) => message.scheduledTaskId === id && message.id === run.userMessageId));
    assert.deepEqual(scheduledRun?.modelSelection, modelSelection, "Server dispatch uses the saved task model and low effort");
  }
  console.log(`PASS: isolated real task list/subscribe/create/edit, model and low-effort persistence, origin, disabled save${process.argv.includes("--run-turn") ? ", scheduled dispatch and completed Luna reply" : " (no provider call)"}.`);
} finally { await host.dispose(); }
