/**
 * Pairing (architecture doc §4): shell out to `t3 pair`, parse the printed
 * one-time token, then complete the same exchange the web client's /pair flow
 * performs — headlessly, via POST /oauth/token (spike #1 resolution). The
 * result is a durable 30-day bearer session.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as RemoteAuth from "@t3tools/client-runtime/authorization";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

const execFileAsync = promisify(execFile);

export interface PairedSession {
  readonly origin: string;
  readonly environmentId: string;
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly scopes: ReadonlyArray<string>;
}

const PAIR_TIMEOUT_MS = 45_000;

/** Tokens are uppercase alphanumeric (Crockford-ish: 23456789A-HJ-NP-Z, len 12). */
const TOKEN_PATTERN = /Token:\s*([0-9A-Z]{6,})/;
const URL_TOKEN_PATTERN = /[#?&]token=([0-9A-Z]{6,})/;

const runTPair = async (home: string): Promise<string> => {
  const baseArgs = ["pair", "--label", "VS Code"];
  try {
    const run = await execFileAsync("t3", [...baseArgs, "--base-dir", home], { timeout: PAIR_TIMEOUT_MS });
    return run.stdout;
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr ?? "";
    throw new Error(`\`t3 pair\` failed: ${stderr || String(cause)}`);
  }
};

/**
 * Pair this machine's extension with the T3 server at `origin` (state under
 * `home`). Shells out to the installed `t3` CLI — never auto-spawns a server.
 */
export const pairWithServer = async (input: {
  readonly home: string;
  readonly origin: string;
  readonly environmentId: string;
}): Promise<PairedSession> => {
  const stdout = await runTPair(input.home);
  const token = TOKEN_PATTERN.exec(stdout)?.[1] ?? URL_TOKEN_PATTERN.exec(stdout)?.[1];
  if (!token) {
    throw new Error("Could not parse the pairing token from `t3 pair` output.");
  }

  const target = resolveRemotePairingTarget({ host: input.origin, pairingCode: token });
  const result = await Effect.runPromise(
    Effect.provide(
      RemoteAuth.bootstrapRemoteBearerSession({
        httpBaseUrl: target.httpBaseUrl,
        credential: target.credential,
        clientMetadata: { label: "VS Code", deviceType: "desktop" },
      }),
      FetchHttpClient.layer,
    ),
  );

  return {
    origin: input.origin,
    environmentId: input.environmentId,
    accessToken: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
    scopes: result.scope?.split(" ").filter((s) => s.length > 0) ?? [],
  };
};
