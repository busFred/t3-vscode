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

/** T3 home precedence: explicit setting → T3CODE_HOME env → ~/.t3. */
export const resolveT3Home = (configured: string | undefined): string => {
  const trimmed = configured?.trim() ?? "";
  if (trimmed.length > 0) return trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1)) : trimmed;
  const env = process.env.T3CODE_HOME?.trim() ?? "";
  if (env.length > 0) return env.startsWith("~") ? join(homedir(), env.slice(1)) : env;
  return join(homedir(), ".t3");
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
  | { ok: false; reason: string };

/**
 * Discover a live T3 server under `home`. Returns the reason when no usable
 * server exists (the setup view renders it).
 */
export const discoverServer = async (home: string, startupHint?: string): Promise<DiscoveryResult> => {
  const hint = startupHint ?? (resolve(home) === join(homedir(), ".t3")
    ? "Start the T3 service with `t3 service start` (or install it with `t3 service install`), then retry the connection."
    : "Start T3 with `t3 serve --base-dir` pointing to this directory, then retry the connection.");
  const found = readRuntimeState(home);
  if (!found) {
    return {
      ok: false,
      reason: `No running T3 server found under ${home}. ${hint}`,
    };
  }
  if (!pidAlive(found.state.pid)) {
    return {
      ok: false,
      reason: `The server recorded in ${found.path} (pid ${found.state.pid}) is not running. ${hint}`,
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
    };
  }
  if (descriptor.orchestrationProtocolVersion !== undefined && descriptor.orchestrationProtocolVersion !== 2) {
    return {
      ok: false,
      reason: `Server at ${origin} speaks orchestration protocol ${descriptor.orchestrationProtocolVersion}; this extension requires protocol 2.`,
    };
  }
  return { ok: true, server: { origin, runtime: found.state, descriptor } };
};
