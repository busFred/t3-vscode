/**
 * Key-bound sessions on paired machines (T3 Code 0.1.11 `accessTokenRenewal`): pairing binds the
 * session to this device's key, and presenting the current token (even an expired one) with a fresh
 * proof from that key renews it. The session stays in place on the server, so renewing never
 * disturbs open sockets or other windows. A session left unused for 30 days, or revoked, must pair again.
 */
import { AuthAccessTokenType } from "@t3tools/contracts";
import * as RemoteAuth from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { bearerAuth, dpopAuth, type AccessToken, type ConnectionAuth } from "./connectionAuth.js";
import { createDeviceKey, createDpopProof, importDeviceKey, type DeviceKey } from "./deviceKey.js";
import type { RemoteBearerSession, RemoteEnvironmentRecord } from "./environmentCatalog.js";

const CLIENT_METADATA = { label: "VS Code", deviceType: "desktop" } as const;
const tokenUrl = (httpBaseUrl: string) => new URL("/oauth/token", httpBaseUrl).toString();
const runWithFetch = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, FetchHttpClient.layer) as Effect.Effect<A, E>);

/** Exchanges a pairing link's one-time credential for a session bound to a new key, returned with the session to store with the pairing. */
export async function bootstrapDpopSession(input: { httpBaseUrl: string; credential: string }): Promise<RemoteBearerSession> {
  const { key, stored } = await createDeviceKey();
  const dpopProof = await createDpopProof(key, { method: "POST", url: tokenUrl(input.httpBaseUrl) });
  const session = await runWithFetch(RemoteAuth.exchangeRemoteDpopAccessToken({ httpBaseUrl: input.httpBaseUrl, credential: input.credential, clientMetadata: CLIENT_METADATA, dpopProof }));
  return { ...session, dpopKey: stored };
}

/** The signing key of a key-bound pairing; null for a bearer pairing. */
export const recordKey = (record: Pick<RemoteEnvironmentRecord, "auth" | "dpopKey">): Promise<DeviceKey | null> =>
  record.auth === "dpop" && record.dpopKey ? importDeviceKey(record.dpopKey) : Promise.resolve(null);

/** Renews a key-bound session's token. Fails with the server's error when the session is revoked or idled out. */
export async function renewDpopToken(record: Pick<RemoteEnvironmentRecord, "httpBaseUrl" | "accessToken">, key: DeviceKey, now: () => number = Date.now): Promise<{ accessToken: string; expiresAt: number }> {
  const dpopProof = await createDpopProof(key, { method: "POST", url: tokenUrl(record.httpBaseUrl) });
  const access = await runWithFetch(RemoteAuth.exchangeRemoteDpopAccessToken({
    httpBaseUrl: record.httpBaseUrl, credential: record.accessToken, credentialType: AuthAccessTokenType, dpopProof,
  }));
  return { accessToken: access.access_token, expiresAt: now() + access.expires_in * 1000 };
}

/** How requests to a paired machine authenticate; key-bound records get the current token from `current`. */
export function recordAuth(record: RemoteEnvironmentRecord, key: DeviceKey | null, current?: () => Promise<AccessToken>): ConnectionAuth {
  if (record.auth !== "dpop") return bearerAuth(record.accessToken);
  // A key-bound token must never travel as a bearer token.
  if (!key) throw new Error("This computer's sign-in key for paired machines is unavailable.");
  return dpopAuth(key, current ?? (async () => ({ token: record.accessToken, expiresAt: record.expiresAt })));
}
