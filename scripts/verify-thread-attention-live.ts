/** Real read-state, snooze, auto-settle and duplicate verification against an explicitly isolated running T3 home (one inexpensive live turn). */
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import type { PairedSession } from "../src/host/pairing.js";
import type { HostStateSnapshot, ThreadSummary } from "../src/shared/bridge.js";
import { configureLiveTestModel } from "./liveTestModel.js";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Usage: pnpm exec tsx scripts/verify-thread-attention-live.ts --base-dir <isolated-home>");
const home = await realpath(resolve(process.argv[flag + 1]!));
const live = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
if (home === live || home.startsWith(`${live}/`)) throw new Error("Verification must not use the live ~/.t3 home.");
await mkdir(join(home, "workspace"), { recursive: true });
let session: PairedSession | null = null;
const client = new T3Client();
const host = new HostState({ home, workspaceRoot: () => join(home, "workspace"), credentials: {
  get: async () => session, save: async (next) => { session = next; }, clear: async () => { session = null; },
}}, client);
const waitFor = (predicate: (state: HostStateSnapshot) => boolean, what: string, timeoutMs = 150_000) => new Promise<HostStateSnapshot>((resolve, reject) => {
  let off = () => {};
  const timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for: ${what}`)); }, timeoutMs);
  off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(state); } });
});
const thread = (state: HostStateSnapshot, id: string): ThreadSummary | undefined => state.threads.find((entry) => entry.id === id);
try {
  await host.start();
  if (host.snapshot().phase !== "ready") throw new Error(host.snapshot().notice ?? `Host phase: ${host.snapshot().phase}`);
  console.log(`Server ${host.snapshot().environment?.serverVersion ?? "?"}`);
  await configureLiveTestModel(host);
  await host.newThread();
  await host.sendMessage("Reply with exactly ATTENTION-OK and nothing else.");
  // The first send can create the conversation, so read its id from the view that sent it.
  const replied = await waitFor((state) => !!state.activeThreadId && state.transcript.some(({ item }) => item.type === "assistant_message" && !item.streaming && item.text.includes("ATTENTION-OK")) && !thread(state, state.activeThreadId)?.activeRunId, "the live reply");
  const id = replied.activeThreadId!;
  const capable = thread(host.snapshot(), id)!;
  assert.deepEqual([capable.tracksVisits, capable.canSnooze, capable.autoSettle], [true, true, true], "T3 advertises read state, snooze and auto-settle");
  console.log("PASS: the server advertises visit tracking, snooze and the auto-settle opt-out");

  // The thread was never visited, so a finished run is not unread yet (T3's rule).
  await waitFor((state) => thread(state, id)?.canMarkUnread === true, "the run's completion recorded");
  host.registerView("tab"); await host.selectThread(id, "tab");
  host.setWindowFocused(true); host.setViewVisible("tab", true);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(thread(host.snapshot(), id)?.unseen, undefined);
  await host.threadAction(id, "mark-unread");
  await waitFor((state) => thread(state, id)?.unseen === "done", "Mark unread shows Done");
  console.log("PASS: a visible tab records the visit; Mark unread brings back Done and holds while the tab stays on screen");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(thread(host.snapshot(), id)?.unseen, "done", "the hold keeps it unread while unchanged");
  host.setViewVisible("tab", false); host.setViewVisible("tab", true);
  await waitFor((state) => thread(state, id)?.unseen === undefined, "looking again clears it");
  console.log("PASS: leaving and returning to the tab reads it again");

  await host.threadAction(id, "snooze", new Date(Date.now() + 3_600_000).toISOString());
  await waitFor((state) => !!thread(state, id)?.snoozedUntil, "snoozed");
  await host.threadAction(id, "unsnooze");
  await waitFor((state) => thread(state, id)?.snoozedUntil === undefined, "woken");
  console.log("PASS: snooze and wake round-trip through the server");

  await host.threadAction(id, "auto-settle-off");
  await waitFor((state) => thread(state, id)?.autoSettle === false, "auto-settle off");
  await host.threadAction(id, "auto-settle-on");
  await waitFor((state) => thread(state, id)?.autoSettle === true, "auto-settle on");
  console.log("PASS: the per-thread auto-settle opt-out round-trips");

  const copy = await host.threadAction(id, "duplicate");
  assert.ok(copy);
  await waitFor((state) => thread(state, copy)?.title.endsWith("(copy)") === true, "duplicate listed");
  await host.selectThread(copy, "tab");
  await waitFor((state) => state.activeThreadId === copy && state.transcript.some(({ item }) => item.type === "assistant_message" && item.text.includes("ATTENTION-OK")), "duplicate carries the conversation", 60_000)
    .catch(() => host.snapshot());
  const duplicated = host.snapshot("tab").transcript.some(({ item }) => item.type === "assistant_message" && item.text.includes("ATTENTION-OK"));
  assert.ok(duplicated, "the duplicate shows the original reply");
  console.log("PASS: Duplicate creates a '(copy)' thread with the conversation");
} finally { await host.dispose(); }
