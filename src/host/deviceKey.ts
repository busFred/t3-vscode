/**
 * Signing keys behind key-bound ("DPoP", RFC 9449) sessions on paired machines (T3 Code 0.1.11).
 *
 * A machine that advertises `accessTokenRenewal` binds a pairing-link session to a key, and the
 * session's token then renews with a proof from that key instead of expiring after 30 days. Each
 * pairing gets its own P-256 key, stored with that pairing's record in VS Code SecretStorage, so a key
 * and the session it signs for are always written together: no window can pair with a key another
 * window has since replaced.
 */
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { normalizeDpopHtu } from "@t3tools/shared/dpopCommon";

export interface DevicePublicJwk { readonly kty: "EC"; readonly crv: "P-256"; readonly x: string; readonly y: string }
/** The private key as stored with its pairing. */
export interface StoredDeviceKey extends DevicePublicJwk { readonly d: string }
export interface DeviceKey {
  readonly publicJwk: DevicePublicJwk;
  /** ES256 over the JWS signing input; WebCrypto returns the raw `r‖s` form a JWS needs. */
  readonly sign: (data: Uint8Array) => Promise<Uint8Array>;
}

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", hash: "SHA-256" } as const;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A stored private key, or null when the value is not a P-256 private JWK. */
export function parseDeviceKey(raw: unknown): StoredDeviceKey | null {
  const jwk = raw as Record<string, unknown> | null;
  if (typeof jwk !== "object" || !jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !isText(jwk.x) || !isText(jwk.y) || !isText(jwk.d)) return null;
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d };
}

/** Imported keys are kept (non-extractable) so each request does not re-import. */
const imported = new Map<string, Promise<DeviceKey>>();
export function importDeviceKey(stored: StoredDeviceKey): Promise<DeviceKey> {
  const id = `${stored.x}.${stored.y}`;
  let key = imported.get(id);
  if (!key) {
    key = webcrypto.subtle.importKey("jwk", { ...stored }, ALGORITHM, false, ["sign"]).then((privateKey) => ({
      publicJwk: { kty: "EC", crv: "P-256", x: stored.x, y: stored.y },
      sign: async (data: Uint8Array) => new Uint8Array(await webcrypto.subtle.sign(SIGNING, privateKey, data)),
    }));
    key.catch(() => imported.delete(id));
    imported.set(id, key);
  }
  return key;
}

/** A new key for one pairing: the signing key, and the private JWK to store with that pairing. */
export async function createDeviceKey(): Promise<{ key: DeviceKey; stored: StoredDeviceKey }> {
  const pair = await webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const stored = parseDeviceKey(await webcrypto.subtle.exportKey("jwk", pair.privateKey));
  if (!stored) throw new Error("Could not create a sign-in key for this machine.");
  return { key: await importDeviceKey(stored), stored };
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
