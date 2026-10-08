import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import * as Effect from "effect/Effect";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveSpawnCommand, SpawnExecutableResolution } from "@t3tools/shared/shell";
import { pairWithServer, PairingError, runPairingCommand, type PairingCommandRuntime } from "./pairing.js";

function commandHarness(platform: NodeJS.Platform, executable?: string) {
  const calls: Array<{ kind: "shell" | "direct"; command: string; args?: string[]; timeout: number; windowsHide: boolean }> = [];
  const runtime: PairingCommandRuntime = {
    resolve: (command, args) => Effect.runSync(resolveSpawnCommand(command, args).pipe(
      Effect.provideService(HostProcessPlatform, platform),
      Effect.provideService(SpawnExecutableResolution, (name, os) => {
        assert.equal(name, "t3"); assert.equal(os, "win32");
        return executable;
      }),
    )),
    shell: async (command, options) => {
      calls.push({ kind: "shell", command, ...options });
      return { stdout: "Token: 23456789ABCD\r\n" };
    },
    direct: async (command, args, options) => {
      calls.push({ kind: "direct", command, args, ...options });
      return { stdout: "Token: 23456789ABCD\n" };
    },
  };
  return { calls, runtime };
}

test("Windows pairing launches the reported t3.cmd through the shell, with one escaped command string", async () => {
  const { calls, runtime } = commandHarness("win32", "C:\\Users\\hungtien\\.t3\\bin\\t3.cmd");
  const stdout = await runPairingCommand("C:\\Users\\Hung Tien\\.t3", runtime);
  assert.equal(stdout, "Token: 23456789ABCD\r\n");
  assert.deepEqual(calls, [{
    kind: "shell",
    command: 'C:\\Users\\hungtien\\.t3\\bin\\t3.cmd ^"pair^" ^"--label^" ^"VS^ Code^" ^"--base-dir^" ^"C:\\Users\\Hung^ Tien\\.t3^"',
    timeout: 45_000, windowsHide: true,
  }]);
});

test("Windows lookup honors Path/PATHEXT and resolves the first installed launcher before spawning", async (t) => {
  const stat = fs.statSync;
  const files = new Set(["c:\\users\\hung tien\\.t3\\bin\\t3.cmd", "c:\\later\\t3.exe"]);
  const mocked = t.mock.method(fs, "statSync", (file: Parameters<typeof stat>[0]) => {
    if (typeof file === "string" && /^[a-z]:\\/i.test(file)) {
      if (files.has(file.toLowerCase())) return { isFile: () => true } as ReturnType<typeof stat>;
      throw Object.assign(new Error("Fixture file not found"), { code: "ENOENT" });
    }
    return stat(file);
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  const { calls, runtime } = commandHarness("win32");
  const resolve: PairingCommandRuntime["resolve"] = (command, args) => Effect.runSync(resolveSpawnCommand(command, args).pipe(
    Effect.provideService(HostProcessPlatform, "win32"),
    Effect.provideService(HostProcessEnvironment, {
      Path: '"C:\\Users\\Hung Tien\\.t3\\bin";C:\\later', PATHEXT: ".EXE;.CMD",
    }),
  ));
  await runPairingCommand("C:\\isolated", { ...runtime, resolve });
  assert.equal(calls[0]?.kind, "shell");
  assert.ok(calls[0]?.command.startsWith('C:\\Users\\Hung^ Tien\\.t3\\bin\\t3.CMD '));
  files.delete("c:\\users\\hung tien\\.t3\\bin\\t3.cmd");
  await runPairingCommand("C:\\isolated", { ...runtime, resolve });
  assert.equal(calls[1]?.kind, "direct");
  assert.equal(calls[1]?.command, "C:\\later\\t3.EXE");
});

test("Windows batch pairing escapes spaces and shell metacharacters in launcher and home paths", async () => {
  const { calls, runtime } = commandHarness("win32", "C:\\T3 Tools (local)\\t3.BAT");
  await runPairingCommand("C:\\Users\\A&B\\100%\\!draft\\", runtime);
  assert.equal(calls[0]?.kind, "shell");
  assert.equal(calls[0]?.command,
    'C:\\T3^ Tools^ ^(local^)\\t3.BAT ^"pair^" ^"--label^" ^"VS^ Code^" ^"--base-dir^" ^"C:\\Users\\A^&B\\100^%\\^!draft\\\\^"');
});

test("Windows native executables retain literal arguments and never use a shell", async () => {
  const executable = "C:\\Program Files\\T3 Code\\t3.exe";
  const home = "C:\\Users\\Hung Tien\\home & notes";
  const { calls, runtime } = commandHarness("win32", executable);
  await runPairingCommand(home, runtime);
  assert.deepEqual(calls, [{ kind: "direct", command: executable,
    args: ["pair", "--label", "VS Code", "--base-dir", home], timeout: 45_000, windowsHide: true }]);
});

for (const platform of ["linux", "darwin"] as const) {
  test(`${platform} pairing keeps direct execution and literal home arguments`, async () => {
    const home = "/tmp/t3 user's $(not-a-command) `not-executed` home";
    const { calls, runtime } = commandHarness(platform);
    await runPairingCommand(home, runtime);
    assert.deepEqual(calls, [{ kind: "direct", command: "t3",
      args: ["pair", "--label", "VS Code", "--base-dir", home], timeout: 45_000, windowsHide: true }]);
  });
}

test("Unresolved launchers, command failures and timeouts retain distinct pairing diagnostics", async () => {
  const missing = commandHarness("win32");
  await assert.rejects(runPairingCommand("C:\\isolated", { ...missing.runtime,
    direct: async () => { throw Object.assign(new Error("spawn t3 ENOENT"), { code: "ENOENT" }); },
  }),
    (error: unknown) => error instanceof PairingError && error.kind === "cli-missing" && /ENOENT/.test(error.message));
  const batch = commandHarness("win32", "C:\\t3.cmd");
  await assert.rejects(runPairingCommand("C:\\isolated", { ...batch.runtime,
    shell: async () => { throw Object.assign(new Error("Command failed"), { code: 7, stderr: "Fixture server unavailable" }); },
  }),
    (error: unknown) => error instanceof PairingError && error.kind === "pairing" && error.message.includes("Fixture server unavailable"));
  await assert.rejects(runPairingCommand("C:\\isolated", { ...batch.runtime,
    shell: async () => { throw Object.assign(new Error("Fixture pairing timed out"), { killed: true, signal: "SIGTERM" }); },
  }),
    (error: unknown) => error instanceof PairingError && error.kind === "pairing" && /timed out/.test(error.message));
});

function fixtureEnvironment(t: TestContext, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test("Real platform CLI launch preserves arguments, exchanges both token formats and rejects failed pairing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "t3-vscode-pairing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin with spaces");
  const home = join(root, "isolated home & notes");
  const cli = join(root, "fixture.mjs");
  const log = join(root, "arguments.jsonl");
  await mkdir(bin); await mkdir(home);
  // This synthetic CLI never reads T3 state or contacts a provider. On Windows
  // the same test executes a real .cmd wrapper through the production launcher.
  await writeFile(cli, `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.T3_VSCODE_PAIR_FIXTURE_LOG, JSON.stringify(args) + "\\n");
if (JSON.stringify(args) !== JSON.stringify(["pair", "--label", "VS Code", "--base-dir", process.env.T3CODE_HOME])) {
  console.error("Fixture argument corruption"); process.exit(4);
}
const mode = process.env.T3_VSCODE_PAIR_FIXTURE_MODE;
if (mode === "stderr") { console.error("Fixture CLI failure"); process.exit(9); }
console.log(mode === "invalid" ? "No pairing credential" : mode === "url"
  ? "Pairing URL: http://127.0.0.1/pair#token=23456789ABCD" : "Token: 23456789ABCD");
`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  if (process.platform === "win32") {
    await writeFile(join(bin, "t3.cmd"), `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`);
  } else {
    await writeFile(join(bin, "t3"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`, { mode: 0o755 });
  }
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  fixtureEnvironment(t, {
    [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ""}`,
    PATHEXT: ".COM;.EXE;.BAT;.CMD", T3CODE_HOME: home,
    T3_VSCODE_PAIR_FIXTURE_LOG: log, T3_VSCODE_PAIR_FIXTURE_MODE: "token",
  });
  let exchanges = 0;
  let rejectExchange = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, "http://127.0.0.1:47777/oauth/token");
    assert.equal(request.method, "POST");
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get("subject_token"), "23456789ABCD");
    assert.equal(body.get("client_label"), "VS Code");
    assert.equal(body.get("client_device_type"), "desktop");
    exchanges += 1;
    return rejectExchange ? Response.json({ message: "Fixture rejected pairing" }, { status: 401 })
      : Response.json({ access_token: "fixture-session", issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer", expires_in: 3600, scope: "environment:read environment:write" });
  });
  const input = { home, origin: "http://127.0.0.1:47777", environmentId: "fixture-environment" };
  for (const mode of ["token", "url"]) {
    process.env.T3_VSCODE_PAIR_FIXTURE_MODE = mode;
    const before = Date.now();
    const session = await pairWithServer(input);
    assert.equal(session.accessToken, "fixture-session");
    assert.equal(session.origin, input.origin); assert.equal(session.environmentId, input.environmentId);
    assert.deepEqual(session.scopes, ["environment:read", "environment:write"]);
    assert.ok(session.expiresAt >= before + 3600_000 && session.expiresAt <= Date.now() + 3600_000);
  }
  assert.equal(exchanges, 2);
  process.env.T3_VSCODE_PAIR_FIXTURE_MODE = "invalid";
  await assert.rejects(pairWithServer(input), /Could not parse the pairing token/);
  process.env.T3_VSCODE_PAIR_FIXTURE_MODE = "stderr";
  await assert.rejects(pairWithServer(input), (error: unknown) =>
    error instanceof PairingError && error.kind === "pairing" && error.message.includes("Fixture CLI failure"));
  assert.equal(exchanges, 2, "Failed launches/output must never attempt a credential exchange");
  process.env.T3_VSCODE_PAIR_FIXTURE_MODE = "token";
  rejectExchange = true;
  await assert.rejects(pairWithServer(input));
  assert.equal(exchanges, 3);
  const argumentsSeen = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(argumentsSeen.length, 5);
  for (const args of argumentsSeen) assert.deepEqual(args, ["pair", "--label", "VS Code", "--base-dir", home]);
});
