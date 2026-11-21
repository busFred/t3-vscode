/** Key-bound (DPoP) pairings: proofs the T3 server accepts, the shared device key, pairing and renewal. */
import test from "node:test";
import assert from "node:assert/strict";
import { computeDpopJwkThumbprint, verifyDpopProof } from "@t3tools/shared/dpop";
import { v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { createDpopProof, DEVICE_KEY_STORAGE_KEY, loadOrCreateDeviceKey } from "./deviceKey.js";
import { authHeaders, bearerAuth, type ConnectionAuth } from "./connectionAuth.js";
import { EnvironmentCatalog, ENVIRONMENT_CATALOG_KEY, pairRemoteEnvironment, type RemoteEnvironmentRecord, type SecretBackend } from "./environmentCatalog.js";
import { recordAuth } from "./environmentAuth.js";
import { MultiEnvironmentClient } from "./multiEnvironmentClient.js";
import type { T3Client } from "./t3Client.js";

const memorySecrets = (): SecretBackend & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { values, get: async (key) => values.get(key), store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); }, onDidChange: () => ({ dispose() {} }) };
};
const seconds = () => Math.floor(Date.now() / 1000);

test("Device-key proofs pass T3's own verifier, bound to method, URL, key and access token", async () => {
  const key = await loadOrCreateDeviceKey(memorySecrets());
  const url = "https://box.example.ts.net/api/orchestration/threads/t1/history?cursor=abc";
  const proof = await createDpopProof(key, { method: "get", url, accessToken: "access-1" });
  const thumbprint = computeDpopJwkThumbprint(key.publicJwk);
  assert.deepEqual(verifyDpopProof({ proof, method: "GET", url, nowEpochSeconds: seconds(), expectedThumbprint: thumbprint, expectedAccessToken: "access-1" }).ok, true);
  assert.equal(verifyDpopProof({ proof, method: "POST", url, nowEpochSeconds: seconds() }).ok, false, "method is signed");
  assert.equal(verifyDpopProof({ proof, method: "GET", url: "https://box.example.ts.net/api/other", nowEpochSeconds: seconds() }).ok, false, "URL is signed");
  assert.equal(verifyDpopProof({ proof, method: "GET", url, nowEpochSeconds: seconds(), expectedAccessToken: "access-2" }).ok, false, "token is bound");
  const other = await loadOrCreateDeviceKey(memorySecrets());
  assert.equal(verifyDpopProof({ proof, method: "GET", url, nowEpochSeconds: seconds(), expectedThumbprint: computeDpopJwkThumbprint(other.publicJwk) }).ok, false, "key is bound");
});

test("The device key is created once, shared through SecretStorage, and a damaged entry is replaced", async () => {
  const secrets = memorySecrets();
  const first = await loadOrCreateDeviceKey(secrets);
  const second = await loadOrCreateDeviceKey(secrets);
  assert.deepEqual(second.publicJwk, first.publicJwk, "a second window loads the same key");
  const stored = JSON.parse(secrets.values.get(DEVICE_KEY_STORAGE_KEY)!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), ["crv", "d", "kty", "x", "y"], "only the key itself is stored");
  secrets.values.set(DEVICE_KEY_STORAGE_KEY, "{not json");
  const replaced = await loadOrCreateDeviceKey(secrets);
  assert.notDeepEqual(replaced.publicJwk, first.publicJwk);
});

test("Request headers: bearer for older pairings, DPoP token plus a fresh proof for key-bound ones", async () => {
  assert.deepEqual(await authHeaders(bearerAuth("tok"), "GET", "https://box.example/api/auth/session"), { authorization: "Bearer tok" });
  const key = await loadOrCreateDeviceKey(memorySecrets());
  const auth = recordAuth({ auth: "dpop", accessToken: "bound", expiresAt: Date.now() + 3_600_000 } as RemoteEnvironmentRecord, key);
  const headers = await authHeaders(auth, "POST", "https://box.example/api/auth/pairing-token");
  assert.equal(headers.authorization, "DPoP bound");
  assert.equal(verifyDpopProof({ proof: headers.dpop, method: "POST", url: "https://box.example/api/auth/pairing-token", nowEpochSeconds: seconds(), expectedAccessToken: "bound" }).ok, true);
});

const descriptor = { environmentId: "env-remote", label: "Remote", serverVersion: "0.1.11" };
const session = { access_token: "issued", expires_in: 3600 };
test("Pairing binds the session to the device key only where the machine renews sessions", async () => {
  const used: string[] = [];
  const deps = (renewal: boolean) => ({
    fetchDescriptor: async () => ({ ...descriptor, ...(renewal ? { accessTokenRenewal: true } : {}) }),
    bootstrap: async () => { used.push("bearer"); return session; },
    bootstrapDpop: async () => { used.push("dpop"); return session; },
    now: () => 1_000,
  });
  const bound = await pairRemoteEnvironment("https://box.example.ts.net/pair#token=ABCDEFGH2345", { deps: deps(true) });
  assert.equal(bound.auth, "dpop");
  const legacy = await pairRemoteEnvironment("https://box.example.ts.net/pair#token=ABCDEFGH2345", { deps: deps(false) });
  assert.equal(legacy.auth, undefined);
  assert.deepEqual(used, ["dpop", "bearer"]);
  const catalog = new EnvironmentCatalog(memorySecrets());
  await catalog.upsert(bound);
  assert.equal((await catalog.list())[0]!.auth, "dpop", "the binding survives storage");
});

test("A renewed token is stored unless another window stored a later one or the machine was re-paired", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const base: RemoteEnvironmentRecord = { environmentId: "e", label: "E", httpBaseUrl: "https://e.example/", wsBaseUrl: "wss://e.example/", accessToken: "t1", expiresAt: 100, auth: "dpop", scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z" };
  await catalog.upsert(base);
  assert.equal((await catalog.updateToken("e", "t1", { accessToken: "t2", expiresAt: 200 }))?.accessToken, "t2");
  // A slower window renewing from t1 with an earlier expiry keeps the newer token.
  assert.equal((await catalog.updateToken("e", "t1", { accessToken: "t2-late", expiresAt: 150 }))?.accessToken, "t2");
  const { auth: _auth, ...bearerPairing } = base;
  await catalog.upsert({ ...bearerPairing, accessToken: "bearer" });
  assert.equal(await catalog.updateToken("e", "bearer", { accessToken: "x", expiresAt: 999 }), null, "a bearer pairing is never rewritten");
  assert.equal((await catalog.list())[0]!.accessToken, "bearer");
  assert.equal(await catalog.updateToken("missing", "t", { accessToken: "x", expiresAt: 1 }), null);
  assert.ok(secrets.values.has(ENVIRONMENT_CATALOG_KEY));
});

/** Just enough of T3Client for the remote manager: records the auth each connection used. */
class AuthRecordingClient {
  onClose: (() => void) | null = null; onConfig: unknown = null; connectError: unknown = null;
  auths: Array<string | ConnectionAuth> = [];
  async connect(_server: unknown, credential: string | ConnectionAuth) {
    this.auths.push(credential);
    if (typeof credential !== "string") await credential.current();
    if (this.connectError) throw this.connectError;
  }
  async disconnect() {}
  async snapshotShell() { return v2ShellSnapshot; }
  async subscribeShell() { return async () => {}; }
}
const keyBound = (extra: Partial<RemoteEnvironmentRecord> = {}): RemoteEnvironmentRecord => ({
  environmentId: "kb", label: "Key-bound", httpBaseUrl: "https://kb.example/", wsBaseUrl: "wss://kb.example/", accessToken: "t1",
  expiresAt: Date.now() + 3_600_000, auth: "dpop", scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z", ...extra,
});
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("timed out"); await new Promise((resolve) => setTimeout(resolve, 2)); }
};

test("A key-bound machine connects with DPoP, renews an expired token first, and keeps its socket when another window renews", async () => {
  const key = await loadOrCreateDeviceKey(memorySecrets());
  const clients: AuthRecordingClient[] = [];
  const renewed: string[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); return client as never; },
    deviceKey: async () => key,
    renewToken: async (record) => { renewed.push(record.accessToken); return { ...record, accessToken: `${record.accessToken}+`, expiresAt: Date.now() + 3_600_000 }; },
  });
  await multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() - 1 })]);
  await until(() => multi.remoteStatuses()[0]?.state === "connected");
  const auth = clients[0]!.auths[0] as ConnectionAuth;
  assert.equal(auth.scheme, "DPoP");
  assert.deepEqual(renewed, ["t1"], "an expired token renews before connecting");
  assert.equal((await auth.current()).token, "t1+");
  assert.equal(multi.remoteStatuses()[0]!.expiresAt, null, "no pairing-expiry warning for a renewing session");
  // Another window's renewal arrives through the catalog: same session, no reconnect.
  await multi.setRemoteEnvironments([keyBound({ accessToken: "t9", expiresAt: Date.now() + 7_200_000 })]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(clients.length, 1);
  assert.equal((await auth.current()).token, "t9");
  await multi.dispose();
});

test("A key-bound session the server refuses to renew stays listed as expired, not removed", async () => {
  const key = await loadOrCreateDeviceKey(memorySecrets());
  const revoked: string[] = [];
  const refusal = { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential" };
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); client.connectError = refusal; return client as never; },
    deviceKey: async () => key,
    renewToken: async () => { throw refusal; },
  });
  multi.onRemoteRevoked = (record) => revoked.push(record.environmentId);
  await multi.setRemoteEnvironments([keyBound()]);
  await until(() => multi.remoteStatuses()[0]?.state === "expired");
  assert.match(multi.remoteStatuses()[0]!.error ?? "", /Pair it again/);
  assert.deepEqual(revoked, [], "an idle-expired session looks the same as a revoked one, so it is kept with Pair again");
  await multi.dispose();
});

test("A network failure while renewing retries instead of ending the session", async () => {
  const key = await loadOrCreateDeviceKey(memorySecrets());
  let attempts = 0;
  const clients: AuthRecordingClient[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); if (clients.length === 1) client.connectError = { status: 401 }; return client as never; },
    reconnectDelayMs: 5, deviceKey: async () => key,
    renewToken: async (record) => { attempts += 1; if (attempts === 1) throw new Error("fetch failed"); return { ...record, expiresAt: Date.now() + 3_600_000 }; },
  });
  await multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() + 3_600_000 })]);
  await until(() => multi.remoteStatuses()[0]?.state === "connected");
  assert.ok(clients.length >= 2, "reconnected after the failed renewal");
  await multi.dispose();
});

test("A proof refused for this computer's clock keeps the pairing and says why", async () => {
  const key = await loadOrCreateDeviceKey(memorySecrets());
  const skew = { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential", dpopFailureReason: "time_window" };
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); client.connectError = skew; return client as never; },
    reconnectDelayMs: 60_000, deviceKey: async () => key, renewToken: async () => { throw skew; },
  });
  await multi.setRemoteEnvironments([keyBound()]);
  await until(() => multi.remoteStatuses()[0]?.state === "error");
  assert.match(multi.remoteStatuses()[0]!.error ?? "", /clock/);
  await multi.dispose();
});
