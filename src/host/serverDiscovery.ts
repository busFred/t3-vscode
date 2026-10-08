/**
 * Server discovery (architecture doc §3): resolve T3 home, read
 * <home>/{userdata,dev}/server-runtime.json, verify pid liveness, then probe
 * /.well-known/t3/environment to confirm it is a T3 server and capture the
 * environment descriptor. Never auto-spawns a server.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as RemoteEnvironment from "@t3tools/client-runtime/environment";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { ConnectionProblem, ConnectionSetup } from "../shared/connectionSetup.js";

/** T3 home precedence: explicit setting → T3CODE_HOME env → ~/.t3. */
export const resolveT3Home = (configured: string | undefined): string => {
  const trimmed = configured?.trim() ?? "";
  if (trimmed.length > 0) return trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1)) : trimmed;
  const env = process.env.T3CODE_HOME?.trim() ?? "";
  if (env.length > 0) return env.startsWith("~") ? join(homedir(), env.slice(1)) : env;
  return join(homedir(), ".t3");
};

export const connectionSetup = (home: string, startupHint?: string, platform = process.platform, environmentHome = process.env.T3CODE_HOME): ConnectionSetup => {
  const defaultHome = resolve(home) === join(homedir(), ".t3");
  const env = environmentHome?.trim();
  const differentEnvironmentHome = !!env && resolve(env.startsWith("~") ? join(homedir(), env.slice(1)) : env) !== resolve(home);
  // Commands are copied into the user's shell, never executed by the extension.
  // Quote even paths containing shell expansions, spaces or single quotes.
  const quotedHome = `'${resolve(home).replaceAll("'", platform === "win32" ? "''" : "'\"'\"'")}'`;
  const baseDir = defaultHome && !differentEnvironmentHome ? "" : ` --base-dir ${quotedHome}`;
  return {
    startCommand: `t3${baseDir}`,
    serveCommand: `t3 serve${baseDir}`,
    serviceSupported: defaultHome && !differentEnvironmentHome && !startupHint && (platform === "linux" || platform === "darwin"),
    ...(startupHint ? { startupHint } : {}),
  };
};

export interface ServerRuntimeState {
  readonly version: number;
  readonly pid: number;
  readonly host?: string;
  readonly port: number;
  readonly origin: string;
  readonly devUrl?: string;
  readonly startedAt: string;
  readonly serviceManaged?: boolean;
}

export interface DiscoveredServer {
  readonly origin: string;
  readonly runtime: ServerRuntimeState;
  readonly descriptor: ExecutionEnvironmentDescriptor;
}

export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const readRuntimeState = (home: string): { state: ServerRuntimeState; path: string } | null => {
  // A dev server (started with --dev-url) keeps state under <home>/dev.
  for (const sub of ["userdata", "dev"] as const) {
    const path = join(home, sub, "server-runtime.json");
    if (!existsSync(path)) continue;
    try {
      return { state: JSON.parse(readFileSync(path, "utf8")) as ServerRuntimeState, path };
    } catch {
      return null;
    }
  }
  return null;
};

const fetchDescriptor = (origin: string) =>
  Effect.runPromise(
    Effect.provide(
      RemoteEnvironment.fetchRemoteEnvironmentDescriptor({ httpBaseUrl: origin, timeoutMs: 3_000 }),
      FetchHttpClient.layer,
    ),
  );

export type DiscoveryResult =
  | { ok: true; server: DiscoveredServer }
  | { ok: false; reason: string; problem?: ConnectionProblem };

/**
 * Discover a live T3 server under `home`. Returns the reason when no usable
 * server exists (the setup view renders it).
 */
export const discoverServer = async (home: string, startupHint?: string): Promise<DiscoveryResult> => {
  const setup = connectionSetup(home, startupHint);
  const hint = startupHint ?? `Start T3 with \`${setup.serveCommand}\`, then retry the connection.`;
  const found = readRuntimeState(home);
  if (!found) {
    return {
      ok: false,
      reason: `No running T3 server found under ${home}. ${hint}`,
      problem: { kind: "missing-runtime" },
    };
  }
  if (!pidAlive(found.state.pid)) {
    return {
      ok: false,
      reason: `The server recorded in ${found.path} (pid ${found.state.pid}) is not running. ${hint}`,
      problem: { kind: "server-stopped", serviceManaged: found.state.serviceManaged === true },
    };
  }
  const origin = found.state.origin;
  let descriptor: ExecutionEnvironmentDescriptor;
  try {
    descriptor = await fetchDescriptor(origin);
  } catch {
    return {
      ok: false,
      reason: `A server is recorded at ${origin} but did not answer the environment probe. Is it healthy?`,
      problem: { kind: "unreachable" },
    };
  }
  if (descriptor.orchestrationProtocolVersion !== undefined && descriptor.orchestrationProtocolVersion !== 2) {
    return {
      ok: false,
      reason: `Server at ${origin} speaks orchestration protocol ${descriptor.orchestrationProtocolVersion}; this extension requires protocol 2.`,
      problem: { kind: "incompatible" },
    };
  }
  return { ok: true, server: { origin, runtime: found.state, descriptor } };
};
