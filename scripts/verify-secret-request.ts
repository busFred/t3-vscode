/** Real secret-request verification (live Luna agent calls request_secret); requires an explicitly isolated running T3 home. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostState } from "../src/host/hostState.js";
import { T3Client } from "../src/host/t3Client.js";
import type { PairedSession } from "../src/host/pairing.js";
import type { HostStateSnapshot } from "../src/shared/bridge.js";
import { configureLiveTestModel } from "./liveTestModel.js";

const flag = process.argv.indexOf("--base-dir");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Usage: pnpm exec tsx scripts/verify-secret-request.ts --base-dir <isolated-home>");
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
const secret = `dummy-${randomBytes(12).toString("hex")}`;
const secretRows = (state: HostStateSnapshot) => state.transcript.filter(({ item }) => item.type === "secret_request");
try {
  await host.start();
  if (host.snapshot().phase !== "ready") throw new Error(host.snapshot().notice ?? `Host phase: ${host.snapshot().phase}`);
  await configureLiveTestModel(host);
  const id = await host.newThread();
  await waitFor((state) => state.activeThreadId === id && !state.threadLoading, "thread active");
  const pending = waitFor((state) => state.pending.secrets.length > 0, "pending.secrets entry");
  await host.sendMessage("Call the request_secret tool exactly once with label \"Verify Token\" and reason \"Isolated verification\". Do nothing else. After the user answers, reply with exactly SECRET-DONE and never repeat the secret.", id);
  const state = await pending;
  assert.equal(state.pending.secrets.length, 1, "exactly one pending secret");
  assert.equal(state.pending.secrets[0]!.label, "Verify Token");
  assert.equal(secretRows(state).length, 1);
  console.log("PASS: projection decoded secret_request item; pending.secrets has one entry labelled 'Verify Token'");
  const done = waitFor((s) => secretRows(s).some(({ item }) => item.type === "secret_request" && item.secretStatus === "saved") && s.pending.secrets.length === 0, "secretStatus saved");
  await host.answerSecretRequest({ threadId: id, turnItemId: state.pending.secrets[0]!.turnItemId, answer: { type: "save", secret } });
  const saved = await done;
  assert.ok(!JSON.stringify(saved).includes(secret), "secret must not appear in the host snapshot");
  console.log("PASS: answerSecretRequest(save) -> secretStatus saved, pending.secrets empty, secret absent from snapshot");
  // Second answer must be rejected by the server without echoing the secret.
  await assert.rejects(host.answerSecretRequest({ threadId: id, turnItemId: state.pending.secrets[0]!.turnItemId, answer: { type: "save", secret } }), (error: Error) => {
    assert.ok(!error.message.includes(secret)); console.log("PASS: repeat answer rejected:", error.message); return true; });
  const reply = await waitFor((s) => s.transcript.some(({ item }) => item.type === "assistant_message" && !item.streaming && item.text.includes("SECRET-DONE")), "agent resumed after secret saved").catch((e: Error) => { console.log("NOTE:", e.message); return host.snapshot(); });
  assert.ok(!JSON.stringify(reply).includes(secret), "secret must not appear in the final snapshot");
  console.log("PASS: secret absent from final snapshot");
} catch (error) {
  const s = host.snapshot();
  console.error("Observed item types:", s.transcript.map(({ item }) => item.type === "assistant_message" ? `assistant_message:${item.text.slice(0, 200)}` : item.type === "error" ? `error:${JSON.stringify((item as Record<string, unknown>).failure).slice(0, 600)}` : item.type).join(" | "));
  throw error;
} finally { await host.dispose(); }
