/**
 * M0 wire spike (architecture doc §9): prove the full path against an isolated
 * T3 dev server — discovery → `t3 pair` → headless token exchange → WS RPC →
 * list projects/threads → launch a thread → send one message → receive the
 * assistant reply as plain text.
 *
 * Usage: node dist-spike/spike.mjs --base-dir /tmp/t3-vscode-m0
 * Prereq:  t3 serve --base-dir /tmp/t3-vscode-m0 --port 47777
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { ORCHESTRATION_V2_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
import * as RemoteAuth from "@t3tools/client-runtime/authorization";
import * as RemoteEnvironment from "@t3tools/client-runtime/environment";
import * as RpcSessionModule from "@t3tools/client-runtime/rpc/session";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const baseDirFlag = args.indexOf("--base-dir");
const baseDir: string | undefined = baseDirFlag >= 0 ? args[baseDirFlag + 1] : undefined;
if (!baseDir) {
  console.error("usage: spike --base-dir <t3-home>");
  process.exit(2);
}
const home: string = baseDir;

const watchdog = setTimeout(() => {
  console.error("\n[spike] WATCHDOG timeout (240s)");
  process.exit(3);
}, 240_000);

const log = (step: string, detail?: unknown) => {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`\n[${stamp}] === ${step} ===`);
  if (detail !== undefined) console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
};

// ---------------------------------------------------------------- discovery

interface ServerRuntimeState {
  version: number;
  pid: number;
  host?: string;
  port: number;
  origin: string;
  devUrl?: string;
  startedAt: string;
  serviceManaged?: boolean;
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function readRuntimeState(t3home: string): { state: ServerRuntimeState; path: string } | null {
  for (const sub of ["userdata", "dev"]) {
    const p = join(t3home, sub, "server-runtime.json");
    if (!existsSync(p)) continue;
    try {
      return { state: JSON.parse(readFileSync(p, "utf8")) as ServerRuntimeState, path: p };
    } catch (cause) {
      console.error(`[spike] failed to parse ${p}:`, cause);
    }
  }
  return null;
}

// ------------------------------------------------------------ effect helpers

const httpAndSocket = Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal);

const runHttp = <A, E>(eff: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.provide(eff, FetchHttpClient.layer) as Effect.Effect<A, E, never>);

const unwrap = (label: string) => <A>(promise: Promise<A>): Promise<A> =>
  promise.catch((cause) => {
    console.error(`\n[spike] FAILED at ${label}:`);
    try {
      console.dir(cause, { depth: 6 });
    } catch {
      console.error(cause instanceof Error ? cause.message : cause);
    }
    process.exit(1);
  });

// ------------------------------------------------------------------- pairing

async function pairViaCli(origin: string): Promise<{ credential: string; httpBaseUrl: string; wsBaseUrl: string }> {
  log("pair: shelling out to `t3 pair --label t3-vscode-spike`");
  let stdout: string;
  try {
    const run = await execFileAsync("t3", ["pair", "--label", "t3-vscode-spike", "--base-dir", home], {
      timeout: 30_000,
    });
    stdout = run.stdout;
  } catch (cause) {
    throw cause;
  }
  const token =
    /Token:\s*([0-9A-Z]{6,})/.exec(stdout)?.[1] ?? /[#?&]token=([0-9A-Z]{6,})/.exec(stdout)?.[1];
  if (!token) throw new Error("could not parse pairing token from `t3 pair` output");
  const target = resolveRemotePairingTarget({ host: origin, pairingCode: token });
  log("pair: resolved target", { httpBaseUrl: target.httpBaseUrl, credential: `${target.credential.slice(0, 4)}…` });
  return target;
}

// --------------------------------------------------------------------- main

async function main() {
  // 1. discovery
  const found = readRuntimeState(home);
  if (!found) {
    console.error(`[spike] no server-runtime.json under ${baseDir}/{userdata,dev} — start: t3 serve --base-dir ${baseDir} --port 47777`);
    process.exit(2);
  }
  log("discovery: server-runtime.json", { path: found.path, ...found.state });
  if (!pidAlive(found.state.pid)) {
    console.error(`[spike] pid ${found.state.pid} is not alive; server is stale`);
    process.exit(2);
  }
  const origin = found.state.origin;

  // 2. environment probe
  const descriptor = await unwrap("environment probe")(runHttp(RemoteEnvironment.fetchRemoteEnvironmentDescriptor({ httpBaseUrl: origin })));
  log("discovery: environment descriptor", descriptor);
  if (descriptor.orchestrationProtocolVersion !== undefined && descriptor.orchestrationProtocolVersion !== 2) {
    console.error(`[spike] unsupported orchestration protocol ${descriptor.orchestrationProtocolVersion}`);
    process.exit(1);
  }

  // 3. pairing + headless token exchange (the /pair flow, minus the browser)
  const { credential, httpBaseUrl, wsBaseUrl } = await unwrap("t3 pair")(pairViaCli(origin));
  const tokenResult = await unwrap("token exchange")(
    runHttp(RemoteAuth.bootstrapRemoteBearerSession({ httpBaseUrl, credential })),
  );
  log("auth: bearer session", {
    tokenType: tokenResult.token_type,
    expiresIn: tokenResult.expires_in,
    scope: tokenResult.scope,
  });
  const bearerToken = tokenResult.access_token;

  // 4. websocket connect (ticket + orchestrationProtocol=2)
  const socketUrl = await unwrap("websocket ticket")(
    runHttp(RemoteAuth.resolveRemoteWebSocketConnectionUrl({ httpBaseUrl, wsBaseUrl, bearerToken })),
  );
  log("connect: socket url", socketUrl.replace(/wsTicket=[^&]+/, "wsTicket=…"));
  // The ConnectionResolver normally appends this; we bypass it (no catalog),
  // so set the mandatory protocol gate ourselves (server 426s without it).
  const socketUrlWithProtocol = `${socketUrl}${socketUrl.includes("?") ? "&" : "?"}orchestrationProtocol=2`;

  const scope = await Effect.runPromise(Scope.make());
  const closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));
  const provide = <A, E>(eff: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      Effect.provide(eff, httpAndSocket).pipe(
        Effect.provideService(Scope.Scope, scope),
      ) as Effect.Effect<A, E, never>,
    );

  const { session, config } = await unwrap("rpc session")(
    provide(
      Effect.gen(function* () {
        const factory = yield* RpcSessionModule.make();
        const session = yield* factory.connect({
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          httpBaseUrl,
          socketUrl: socketUrlWithProtocol,
          httpAuthorization: null,
          target: {
            _tag: "PrimaryConnectionTarget",
            environmentId: descriptor.environmentId,
            label: descriptor.label,
            httpBaseUrl,
            wsBaseUrl,
          } as never,
        });
        const config = yield* session.initialConfig;
        return { session, config };
      }),
    ),
  );
  log("connect: initial server config", {
    environment: config.environment.label,
    capabilities: config.environment.capabilities,
  });

  // 5. shell snapshot: projects + threads
  const shellItems = await unwrap("subscribeShell")(
    provide(
      Stream.runCollect(
        session.client[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({ requestCompletionMarker: true } as never).pipe(
          Stream.takeUntil((item) => item.kind === "synchronized"),
        ),
      ),
    ),
  );
  const snapshot = Array.from(shellItems as Iterable<unknown>).find((i) => (i as { kind?: string }).kind === "snapshot");
  log("shell snapshot", snapshot ?? "(no snapshot frame)");
  const shell = (snapshot as { snapshot?: { projects?: unknown[]; threads?: unknown[] } } | undefined)?.snapshot;
  log("counts", { projects: shell?.projects?.length ?? 0, threads: shell?.threads?.length ?? 0 });

  // 6. ensure a scratch project (server-created, isolated from real workspaces)
  const scratch = await unwrap("projects.ensureScratch")(
    provide(session.client[WS_METHODS.projectsEnsureScratch]({})),
  );
  log("scratch project", scratch);
  const scratchResult = scratch as { projectId?: string };
  if (!scratchResult.projectId) throw new Error("ensureScratch returned no projectId");
  const projectId = scratchResult.projectId;

  // Re-read the shell: the project entry carries defaultModelSelection.
  const shellItems2 = await unwrap("subscribeShell (2)")(
    provide(
      Stream.runCollect(
        session.client[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({ requestCompletionMarker: true } as never).pipe(
          Stream.takeUntil((item) => item.kind === "synchronized"),
        ),
      ),
    ),
  );
  const snapshot2 = Array.from(shellItems2 as Iterable<unknown>).find(
    (i) => (i as { kind?: string }).kind === "snapshot",
  ) as { snapshot?: { projects?: Array<{ id: string; defaultModelSelection?: { instanceId: string; model: string } | null }> } } | undefined;
  const shellProject = snapshot2?.snapshot?.projects?.find((p) => p.id === projectId);
  const modelSelection =
    shellProject?.defaultModelSelection ??
    ({ instanceId: "codex", model: "gpt-6-astra" } as { instanceId: string; model: string });
  log("model selection", modelSelection);

  // 7. create a thread explicitly (two-step flow: create → subscribe → dispatch)
  const threadId = randomUUID();
  const created = await unwrap("thread.create")(
    provide(
      session.client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
        type: "thread.create",
        commandId: randomUUID(),
        createdBy: "user",
        creationSource: "web",
        threadId,
        projectId,
        title: "M0 spike",
        modelSelection,
        runtimeMode: "auto",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      } as never),
    ),
  );
  log("thread.create result", created);
  const actualThreadId = threadId;

  // 8. subscribe to the thread; collect every stream item
  const transcript: unknown[] = [];
  await unwrap("subscribeThread fork")(
    provide(
      Effect.forkScoped(
        Stream.runForEach(
          session.client[ORCHESTRATION_V2_WS_METHODS.subscribeThread]({
            threadId: actualThreadId,
            requestCompletionMarker: true,
          } as never),
          (item) => Effect.sync(() => void transcript.push(item)),
        ),
      ),
    ),
  );
  await new Promise((r) => setTimeout(r, 1000));

  // 9. send one message
  await unwrap("message.dispatch")(
    provide(
      session.client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
        type: "message.dispatch",
        commandId: randomUUID(),
        createdBy: "user",
        creationSource: "web",
        threadId: actualThreadId,
        messageId: randomUUID(),
        text: "Reply with exactly: SPIKE-OK",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
      } as never),
    ),
  );
  log("message dispatched");

  log("message dispatched, waiting for assistant reply (up to 120s)…");
  const deadline = Date.now() + 120_000;
  let finalText: string | null = null;
  const seenEvents = new Set<string>();
  const turnItems = new Map<string, { type?: string; status?: string; text?: string; streaming?: boolean }>();
  while (Date.now() < deadline) {
    for (const item of transcript) {
      const it = item as { kind?: string; event?: { type?: string } };
      if (it.kind === "event" && it.event?.type) seenEvents.add(it.event.type);
      const ev = item as {
        kind?: string;
        event?: {
          type?: string;
          payload?: { id?: string; type?: string; status?: string; text?: string; streaming?: boolean };
        };
      };
      if (ev.kind === "event" && ev.event?.type === "turn-item.updated" && ev.event.payload) {
        const p = ev.event.payload;
        turnItems.set(p.id ?? `${turnItems.size}`, p);
        if (p.type === "assistant_message" && (p.streaming === false || p.status === "completed")) {
          finalText = p.text ?? null;
        }
      }
    }
    if (finalText !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  log("event types seen", [...seenEvents].sort());
  log("turn items", [...turnItems.values()].map((p) => ({ type: p.type, status: p.status, streaming: p.streaming, text: p.text ? p.text.slice(0, 120) : undefined })));
  if (finalText === null) {
    log("no final assistant_message yet — run events", transcript.filter((i) => {
      const e = (i as { kind?: string; event?: { type?: string } }).event;
      return e?.type === "run.updated" || e?.type === "provider-turn.updated";
    }).slice(-4));
  } else {
    log("ASSISTANT REPLY (final)", finalText);
  }

  await closeScope();
  clearTimeout(watchdog);
  log(finalText !== null ? "SPIKE PASSED ✅" : "SPIKE PARTIAL (wire ok, no reply yet)");
  process.exit(finalText !== null ? 0 : 4);
}

main().catch((cause) => {
  console.error("[spike] unhandled:", cause);
  process.exit(1);
});
