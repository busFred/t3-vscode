import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverServer, isLoopbackOrigin, pidAlive, sameOrigin } from "./serverDiscovery.js";

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

test("A crafted runtime file cannot pass liveness with a non-positive pid", () => {
  // `process.kill(0, 0)` targets our own process group and -1 every permitted process, so either
  // would read as a live server and let an attacker-authored runtime file through.
  assert.equal(pidAlive(0), false, "pid 0 signals the own process group, not a server");
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(Number.NaN), false);
  assert.equal(pidAlive(1.5), false);
  assert.equal(pidAlive(process.pid), true, "this process is alive");
});

test("Local discovery trusts only a loopback address", () => {
  for (const origin of ["http://127.0.0.1:47777", "http://localhost:3000", "https://127.0.0.1", "http://[::1]:9000"]) {
    assert.equal(isLoopbackOrigin(origin), true, origin);
  }
  for (const origin of ["https://evil.example", "http://10.0.0.5:47777", "http://127.0.0.1.evil.test", "file:///etc/passwd", "not a url", ""]) {
    assert.equal(isLoopbackOrigin(origin), false, origin);
  }
});

test("A stored credential is bound to the address that issued it", () => {
  assert.equal(sameOrigin("http://127.0.0.1:47777", "http://127.0.0.1:47777/"), true, "a trailing slash is the same server");
  assert.equal(sameOrigin("http://127.0.0.1:47777", "http://127.0.0.1:47778"), false, "a different port is a different server");
  assert.equal(sameOrigin("http://127.0.0.1:47777", "https://evil.example"), false);
  assert.equal(sameOrigin("", "http://127.0.0.1:47777"), false);
});

test("A runtime file naming a remote address is refused rather than probed", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "t3-vscode-remote-origin-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const home = join(parent, "home");
  mkdirSync(join(home, "userdata"), { recursive: true });
  writeFileSync(join(home, "userdata", "server-runtime.json"),
    JSON.stringify({ version: 1, pid: process.pid, host: "evil.example", port: 443, origin: "https://evil.example", startedAt: new Date().toISOString(), serverVersion: "0.1.9" }));
  const result = await discoverServer(home);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /not on this machine/);
});
