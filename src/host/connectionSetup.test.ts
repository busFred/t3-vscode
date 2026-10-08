import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { HostState } from "./hostState.js";
import { PairingError } from "./pairing.js";
import { connectionSetup } from "./serverDiscovery.js";
import { FakeTransport, credentials, server } from "./testing/fakeTransport.js";

test("Copied startup commands preserve the selected isolated home as one literal shell argument", { skip: process.platform === "win32" }, () => {
  const home = "/tmp/t3 user's $(not-a-command) `also-not-a-command` home";
  const hint = "Run the isolated server task in the original window.";
  const setup = connectionSetup(home, hint, "linux", "");
  for (const command of [setup.startCommand, setup.serveCommand]) {
    // Parse arguments with the shell without invoking t3 or touching any T3 data.
    const args = execFileSync("/bin/sh", ["-c", `set -- ${command}; printf '%s\\0' "$@"`], { encoding: "utf8" }).split("\0").filter(Boolean);
    assert.deepEqual(args.slice(-2), ["--base-dir", home]);
  }
  assert.equal(setup.startupHint, hint);
  assert.equal(setup.serviceSupported, false);
});

test("Service guidance is limited to the normal home on supported platforms without a conflicting home override", () => {
  const normal = join(homedir(), ".t3");
  for (const platform of ["linux", "darwin"] as const) assert.equal(connectionSetup(normal, undefined, platform, "").serviceSupported, true);
  assert.equal(connectionSetup(normal, undefined, "win32", "").serviceSupported, false);
  const configured = connectionSetup(normal, undefined, "linux", "/tmp/t3-other-home");
  assert.equal(configured.serviceSupported, false);
  assert.ok(configured.serveCommand.includes("--base-dir"));
  assert.ok(configured.serveCommand.includes(normal));
  assert.equal(connectionSetup("/tmp/t3-other-home", undefined, "linux", "").serviceSupported, false);
});

test("Discovery diagnostics reach every view and clear after reconnect without losing conversation selection", async (t) => {
  const client = new FakeTransport();
  let running = true;
  let pairing = 0;
  const host = new HostState({ home: "/tmp/t3-onboarding-host", credentials,
    discover: async () => running ? { ok: true, server } : { ok: false, reason: "The server did not answer.", problem: { kind: "unreachable" } },
    pair: async () => { pairing += 1; throw new Error("Existing credentials must be reused."); },
  }, client);
  t.after(() => host.dispose());
  await host.start();
  host.registerView("editor", "sidebar");
  const selected = host.snapshot("editor").activeThreadId;
  running = false;
  await host.reconnect();
  for (const view of ["sidebar", "editor"]) {
    assert.equal(host.snapshot(view).phase, "no-server");
    assert.equal(host.snapshot(view).connectionSetup?.problem?.kind, "unreachable");
  }
  running = true;
  await host.reconnect();
  assert.equal(host.snapshot().phase, "ready");
  assert.equal(host.snapshot().connectionSetup?.problem, undefined);
  assert.equal(host.snapshot().notice, undefined);
  assert.equal(host.snapshot("editor").activeThreadId, selected);
  assert.ok(host.snapshot().threads.length > 0);
  assert.equal(pairing, 0);
});

test("CLI pairing errors stay distinct from missing servers and recovering enters ready directly, even without models", async (t) => {
  const client = new FakeTransport();
  client.config = { ...client.config, providers: [] };
  let installed = false;
  let saved = 0;
  const phases: string[] = [];
  const host = new HostState({ home: "/tmp/t3-onboarding-pair", credentials: { get: async () => null, save: async () => { saved += 1; }, clear: async () => {} },
    discover: async () => ({ ok: true, server }),
    pair: async (input) => {
      assert.equal(input.home, "/tmp/t3-onboarding-pair");
      if (!installed) throw new PairingError("t3 was not found", "cli-missing");
      return (await credentials.get())!;
    },
  }, client);
  t.after(() => host.dispose());
  host.onDidChangeState((state) => phases.push(state.phase));
  await host.start();
  assert.equal(host.snapshot().phase, "error");
  assert.equal(host.snapshot().connectionSetup?.problem?.kind, "cli-missing");
  assert.equal(saved, 0);
  installed = true;
  await host.pairNow();
  assert.equal(host.snapshot().phase, "ready");
  assert.equal(phases.at(-1), "ready");
  assert.equal(host.snapshot().connectionSetup?.problem, undefined);
  assert.ok(host.snapshot().threads.length > 0);
  assert.deepEqual(host.snapshot().providers, []);
  assert.equal(saved, 1);
});

test("Expired authentication re-pairs once while unrelated transport errors preserve credentials", async (t) => {
  for (const authentication of [true, false]) {
    const client = new FakeTransport();
    const connect = client.connect.bind(client);
    let attempts = 0;
    client.connect = async () => {
      if (++attempts === 1) throw authentication ? { status: 401 } : new Error("Connection interrupted");
      await connect();
    };
    let paired = 0;
    let cleared = 0;
    const host = new HostState({ home: "/tmp/t3-onboarding-auth", credentials: { ...credentials, clear: async () => { cleared += 1; } },
      discover: async () => ({ ok: true, server }), pair: async () => { paired += 1; return (await credentials.get())!; },
    }, client);
    t.after(() => host.dispose());
    await host.start();
    assert.equal(paired, authentication ? 1 : 0);
    assert.equal(cleared, authentication ? 1 : 0);
    assert.equal(host.snapshot().phase, authentication ? "ready" : "error");
    assert.equal(host.snapshot().connectionSetup?.problem?.kind, authentication ? undefined : "connection");
  }
});
