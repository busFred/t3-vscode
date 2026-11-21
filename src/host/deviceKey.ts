/**
 * The device key behind key-bound ("DPoP", RFC 9449) sessions on paired machines (T3 Code 0.1.11).
 *
 * A machine that advertises `accessTokenRenewal` binds a pairing-link session to this key. Its access
 * token then renews with a proof from the same key instead of expiring after 30 days. One P-256 key
 * serves every paired machine, like T3's own clients. Its private half lives in VS Code SecretStorage,
 * next to the tokens it protects, and is shared by every window so one window's renewal never strands
 * another's session.
 */
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { normalizeDpopHtu } from "@t3tools/shared/dpopCommon";
import type { SecretBackend } from "./environmentCatalog.js";

export const DEVICE_KEY_STORAGE_KEY = "t3-vscode.deviceKey.v1";

export interface DevicePublicJwk { readonly kty: "EC"; readonly crv: "P-256"; readonly x: string; readonly y: string }
export interface DeviceKey {
  readonly publicJwk: DevicePublicJwk;
  /** ES256 over the JWS signing input; WebCrypto returns the raw `r‖s` form a JWS needs. */
  readonly sign: (data: Uint8Array) => Promise<Uint8Array>;
  /** Set on a key this call created, which another window creating one at the same moment may have replaced in storage. */
  readonly created?: true;
}

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", hash: "SHA-256" } as const;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A stored private JWK, or null when the entry is missing or not a P-256 private key. */
const parseStored = (raw: string | undefined): webcrypto.JsonWebKey | null => {
  if (!raw) return null;
  try {
    const jwk = JSON.parse(raw) as Record<string, unknown> | null;
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !isText(jwk.x) || !isText(jwk.y) || !isText(jwk.d)) return null;
    return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d };
  } catch { return null; }
};

const importKey = async (jwk: webcrypto.JsonWebKey): Promise<DeviceKey> => {
  const privateKey = await webcrypto.subtle.importKey("jwk", jwk, ALGORITHM, false, ["sign"]);
  return {
    publicJwk: { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! },
    sign: async (data) => new Uint8Array(await webcrypto.subtle.sign(SIGNING, privateKey, data)),
  };
};

/**
 * Loads the device key, creating it on first use. A new key is written and then read back, so two
 * windows creating one at once both continue with whichever write won.
 */
export async function loadOrCreateDeviceKey(secrets: Pick<SecretBackend, "get" | "store">): Promise<DeviceKey> {
  const existing = parseStored(await secrets.get(DEVICE_KEY_STORAGE_KEY));
  // A stored key that no longer imports signs nothing, so it is replaced like a missing one.
  if (existing) { const key = await importKey(existing).catch(() => null); if (key) return key; }
  const pair = await webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const created = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  await secrets.store(DEVICE_KEY_STORAGE_KEY, JSON.stringify({ kty: created.kty, crv: created.crv, x: created.x, y: created.y, d: created.d }));
  const stored = parseStored(await secrets.get(DEVICE_KEY_STORAGE_KEY));
  if (!stored) throw new Error("Could not save this device's sign-in key.");
  return { ...await importKey(stored), created: true };
}

const base64Url = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString("base64url");

/** RFC 9449 proof for one request. `accessToken` adds the `ath` hash that binds the proof to the token it accompanies. */
export async function createDpopProof(key: DeviceKey, input: { readonly method: string; readonly url: string; readonly accessToken?: string; readonly now?: number }): Promise<string> {
  const htu = normalizeDpopHtu(input.url);
  if (htu === null) throw new Error("Could not sign the request for this machine.");
  const header = base64Url(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: key.publicJwk }));
  const payload = base64Url(JSON.stringify({
    htm: input.method.toUpperCase(), htu, jti: randomUUID(), iat: Math.floor((input.now ?? Date.now()) / 1000),
    ...(input.accessToken ? { ath: base64Url(createHash("sha256").update(input.accessToken).digest()) } : {}),
  }));
  const signature = await key.sign(new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(signature)}`;
}
