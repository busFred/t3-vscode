import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverServer } from "./serverDiscovery.js";

test("Discovery of an absent custom home does not create it or suggest installing the shared service", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "t3-vscode-discovery-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const home = join(parent, "home");
  const result = await discoverServer(home);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes(home));
  assert.match(result.reason, /t3 serve --base-dir/);
  assert.doesNotMatch(result.reason, /t3 service install/);
  assert.equal(existsSync(home), false);
  assert.equal(result.problem?.kind, "missing-runtime");
});

test("A stale development runtime preserves the instructions for starting its isolated server", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "t3-vscode-discovery-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "userdata"));
  writeFileSync(join(home, "userdata", "server-runtime.json"), JSON.stringify({
    version: 1, pid: Number.MAX_SAFE_INTEGER, port: 47777, origin: "http://127.0.0.1:47777",
    startedAt: "2026-10-06T00:00:00Z",
  }));
  const hint = "Run T3: start isolated server in the original VS Code window.";
  const result = await discoverServer(home, hint);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes(hint));
  assert.doesNotMatch(result.reason, /t3 service install/);
  assert.equal(result.problem?.kind, "server-stopped");
});

test("Live-process discovery distinguishes failed probes, protocol mismatch and a compatible server", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "t3-vscode-discovery-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "userdata"));
  writeFileSync(join(home, "userdata", "server-runtime.json"), JSON.stringify({
    version: 1, pid: process.pid, port: 47777, origin: "http://127.0.0.1:47777", startedAt: "2026-10-07T00:00:00Z",
  }));
  let protocol: number | null = null;
  t.mock.method(globalThis, "fetch", async () => {
    if (protocol === null) throw new Error("Fixture probe unavailable");
    return Response.json({ environmentId: "fixture", label: "Fixture", serverVersion: "0.0.46", platform: { os: "linux", arch: "x64" }, capabilities: {}, orchestrationProtocolVersion: protocol });
  });
  const unreachable = await discoverServer(home);
  assert.equal(unreachable.ok, false);
  if (!unreachable.ok) assert.equal(unreachable.problem?.kind, "unreachable");
  protocol = 1;
  const incompatible = await discoverServer(home);
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) assert.equal(incompatible.problem?.kind, "incompatible");
  protocol = 2;
  assert.equal((await discoverServer(home)).ok, true);
});
