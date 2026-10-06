/** Real HostState integration check. Requires an already-running, isolated T3 server. */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import type { PairedSession } from "../src/host/pairing.js";
import type { HostStateSnapshot } from "../src/shared/bridge.js";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Usage: pnpm exec tsx scripts/verify-host.ts --base-dir <isolated-home>");
const home = await realpath(resolve(process.argv[flag + 1]!));
const live = await realpath(join(homedir(), ".t3")).catch(() => join(homedir(), ".t3"));
if (home === live || home.startsWith(`${live}/`)) throw new Error("Verification must not use the live ~/.t3 home.");
await mkdir(join(home, "workspace"), { recursive: true });
let session: PairedSession | null = null;
const host = new HostState({ home, workspaceRoot: () => join(home, "workspace"), credentials: {
  get: async () => session, save: async (next) => { session = next; }, clear: async () => { session = null; },
}}, new T3Client());
const waitFor = (predicate: (state: HostStateSnapshot) => boolean, timeoutMs = 90_000) => new Promise<HostStateSnapshot>((resolve, reject) => {
  let off = () => {};
  const timer = setTimeout(() => { off(); reject(new Error("Timed out waiting for the isolated T3 server.")); }, timeoutMs);
  off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(state); } });
});
try {
  await host.start();
  const initial = host.snapshot();
  if (initial.phase !== "ready") throw new Error(initial.notice ?? `Host phase: ${initial.phase}`);
  console.log("Connected to isolated server; available providers:", initial.providers.filter((provider) => provider.enabled && provider.installed).map((provider) => provider.instanceId).join(", "));
  const id = await host.newThread();
  assert.equal(host.snapshot().activeThreadId, id);
  await waitFor((state) => state.activeThreadId === id && !state.threadLoading);
  const reply = waitFor((state) => state.transcript.some(({ item }) => item.type === "assistant_message" && !item.streaming && item.text.includes("VSCODE-M1-OK")), 150_000);
  await host.sendMessage("Reply with exactly: VSCODE-M1-OK", id);
  const final = await reply;
  console.log("PASS: focused new thread, provider turn, streamed and completed assistant reply");
  await host.threadAction(id, "rename", "VS Code integration verification");
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.title, "VS Code integration verification");
  await host.threadAction(id, "pin");
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.pinned, true);
  await host.threadAction(id, "unpin");
  console.log("PASS: rename, pin, unpin");
  const reconnected = waitFor((state) => state.phase === "ready" && !state.threadLoading && state.transcript.some(({ item }) => item.type === "assistant_message" && item.text.includes("VSCODE-M1-OK")));
  await host.reconnect(); await reconnected;
  await writeFile(join(home, "verified-snapshot.json"), JSON.stringify(host.snapshot(), null, 2));
  console.log("PASS: reconnect restored thread history; observed item types:", [...new Set(final.transcript.map(({ item }) => item.type))].join(", "));
} finally { await host.dispose(); }
