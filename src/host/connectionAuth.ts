/**
 * How one connection authenticates its requests: a plain bearer token (local server, older paired
 * machines) or a key-bound DPoP token (paired machines on T3 Code 0.1.11+) that renews itself.
 * Callers ask for headers per request, so a renewed token is picked up without reconnecting.
 */
import { createDpopProof, type DeviceKey } from "./deviceKey.js";

export interface AccessToken { readonly token: string; readonly expiresAt: number | null }

export interface ConnectionAuth {
  readonly scheme: "Bearer" | "DPoP";
  /** The token to present now; a DPoP connection renews first when its token is due. */
  readonly current: () => Promise<AccessToken>;
  /** A DPoP proof for one request, bound to `accessToken` when given. Bearer connections have none. */
  readonly proof?: (method: string, url: string, accessToken?: string) => Promise<string>;
}

export const bearerAuth = (token: string): ConnectionAuth => ({ scheme: "Bearer", current: async () => ({ token, expiresAt: null }) });

export const dpopAuth = (key: DeviceKey, current: () => Promise<AccessToken>): ConnectionAuth => ({
  scheme: "DPoP", current,
  proof: (method, url, accessToken) => createDpopProof(key, { method, url, ...(accessToken ? { accessToken } : {}) }),
});

/** `authorization` (and `dpop`) headers for one request to `url`. */
export async function authHeaders(auth: ConnectionAuth, method: string, url: string): Promise<{ authorization: string; dpop?: string }> {
  const { token } = await auth.current();
  if (auth.scheme === "Bearer" || !auth.proof) return { authorization: `Bearer ${token}` };
  return { authorization: `DPoP ${token}`, dpop: await auth.proof(method, url, token) };
}
