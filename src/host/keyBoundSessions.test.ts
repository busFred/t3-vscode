/** Key-bound (DPoP) pairings: proofs the T3 server accepts, the shared device key, pairing and renewal. */
import test from "node:test";
import assert from "node:assert/strict";
import { computeDpopJwkThumbprint, verifyDpopProof } from "@t3tools/shared/dpop";
import { v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { createDeviceKey, createDpopProof, importDeviceKey } from "./deviceKey.js";
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
const testKey = await createDeviceKey();

test("Device-key proofs pass T3's own verifier, bound to method, URL, key and access token", async () => {
  const key = (await createDeviceKey()).key;
  const url = "https://box.example.ts.net/api/orchestration/threads/t1/history?cursor=abc";
  const proof = await createDpopProof(key, { method: "get", url, accessToken: "access-1" });
  const thumbprint = computeDpopJwkThumbprint(key.publicJwk);
  assert.deepEqual(verifyDpopProof({ proof, method: "GET", url, nowEpochSeconds: seconds(), expectedThumbprint: thumbprint, expectedAccessToken: "access-1" }).ok, true);
  assert.equal(verifyDpopProof({ proof, method: "POST", url, nowEpochSeconds: seconds() }).ok, false, "method is signed");
  assert.equal(verifyDpopProof({ proof, method: "GET", url: "https://box.example.ts.net/api/other", nowEpochSeconds: seconds() }).ok, false, "URL is signed");
  assert.equal(verifyDpopProof({ proof, method: "GET", url, nowEpochSeconds: seconds(), expectedAccessToken: "access-2" }).ok, false, "token is bound");
  const other = (await createDeviceKey()).key;
  assert.equal(verifyDpopProof({ proof, method: "GET", url, nowEpochSeconds: seconds(), expectedThumbprint: computeDpopJwkThumbprint(other.publicJwk) }).ok, false, "key is bound");
});

test("Each pairing has its own key, which survives storage and imports to the same public key", async () => {
  const a = await createDeviceKey(), b = await createDeviceKey();
  assert.notDeepEqual(a.key.publicJwk, b.key.publicJwk);
  assert.deepEqual(Object.keys(a.stored).sort(), ["crv", "d", "kty", "x", "y"], "only the key itself is stored");
  assert.deepEqual((await importDeviceKey(JSON.parse(JSON.stringify(a.stored)))).publicJwk, a.key.publicJwk);
  const catalog = new EnvironmentCatalog(memorySecrets());
  const record: RemoteEnvironmentRecord = { environmentId: "e", label: "E", httpBaseUrl: "https://e.example/", wsBaseUrl: "wss://e.example/", accessToken: "t", expiresAt: 1, auth: "dpop", dpopKey: a.stored, scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z" };
  await catalog.upsert(record);
  assert.deepEqual((await catalog.list())[0]!.dpopKey, a.stored);
  const { dpopKey: _key, ...keyless } = record;
  await catalog.upsert(keyless);
  const kept = (await catalog.list())[0]!;
  assert.equal(kept.auth, "dpop", "a key-bound record without its key stays key-bound, so its token is never sent as bearer");
  assert.equal(kept.dpopKey, undefined);
});

test("Request headers: bearer for older pairings, DPoP token plus a fresh proof for key-bound ones", async () => {
  assert.deepEqual(await authHeaders(bearerAuth("tok"), "GET", "https://box.example/api/auth/session"), { authorization: "Bearer tok" });
  const key = (await createDeviceKey()).key;
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
    bootstrapDpop: async () => { used.push("dpop"); return { ...session, dpopKey: testKey.stored }; },
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

test("A renewed token is stored only for the same pairing, unless another window stored a later one", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const base: RemoteEnvironmentRecord = { environmentId: "e", label: "E", httpBaseUrl: "https://e.example/", wsBaseUrl: "wss://e.example/", accessToken: "t1", expiresAt: 100, auth: "dpop", dpopKey: testKey.stored, scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z" };
  await catalog.upsert(base);
  assert.equal((await catalog.updateToken(base, { accessToken: "t2", expiresAt: 200 }))?.accessToken, "t2");
  // A slower window renewing from t1 with an earlier expiry keeps the newer token.
  assert.equal((await catalog.updateToken(base, { accessToken: "t2-late", expiresAt: 150 }))?.accessToken, "t2");
  // A late renewal of the old session never replaces a fresh key-bound re-pairing, even with a later expiry.
  const repaired = { ...base, accessToken: "fresh", expiresAt: 300, addedAt: "2026-02-01T00:00:00.000Z" };
  await catalog.upsert(repaired);
  assert.equal(await catalog.updateToken(base, { accessToken: "old-session", expiresAt: 400 }), null);
  assert.equal((await catalog.list())[0]!.accessToken, "fresh");
  const { auth: _auth, dpopKey: _dpopKey, ...bearerPairing } = base;
  await catalog.upsert({ ...bearerPairing, accessToken: "bearer" });
  assert.equal(await catalog.updateToken({ ...base, accessToken: "bearer" }, { accessToken: "x", expiresAt: 999 }), null, "a bearer pairing is never rewritten");
  assert.equal((await catalog.list())[0]!.accessToken, "bearer");
  assert.equal(await catalog.updateToken({ ...base, environmentId: "missing" }, { accessToken: "x", expiresAt: 1 }), null);
});

test("A catalog change that changes nothing is not written, so idle renewals never race other windows", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  let writes = 0;
  const store = secrets.store.bind(secrets);
  secrets.store = async (key, value) => { writes += 1; await store(key, value); };
  const record: RemoteEnvironmentRecord = { environmentId: "e", label: "E", httpBaseUrl: "https://e.example/", wsBaseUrl: "wss://e.example/", accessToken: "t1", expiresAt: 100, auth: "dpop", dpopKey: testKey.stored, scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z" };
  await catalog.upsert(record);
  await catalog.updateToken({ ...record, environmentId: "missing" }, { accessToken: "x", expiresAt: 1 });
  await catalog.setEnabled("e", true);
  assert.equal(writes, 1);
});

test("A key-bound record never falls back to a bearer token", () => {
  assert.throws(() => recordAuth({ auth: "dpop", accessToken: "bound", expiresAt: null } as RemoteEnvironmentRecord, null), /sign-in key/);
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
  expiresAt: Date.now() + 3_600_000, auth: "dpop", dpopKey: testKey.stored, scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z", ...extra,
});
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("timed out"); await new Promise((resolve) => setTimeout(resolve, 2)); }
};

test("A key-bound machine connects with DPoP, renews an expired token first, and keeps its socket when another window renews", async () => {
  const key = (await createDeviceKey()).key;
  const clients: AuthRecordingClient[] = [];
  const renewed: string[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); return client as never; },

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
  const key = (await createDeviceKey()).key;
  const revoked: string[] = [];
  const refusal = { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential" };
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); client.connectError = refusal; return client as never; },

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
  const key = (await createDeviceKey()).key;
  let attempts = 0;
  const clients: AuthRecordingClient[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); if (clients.length === 1) client.connectError = { status: 401 }; return client as never; },
    reconnectDelayMs: 5,
    renewToken: async (record) => { attempts += 1; if (attempts === 1) throw new Error("fetch failed"); return { ...record, expiresAt: Date.now() + 3_600_000 }; },
  });
  await multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() + 3_600_000 })]);
  await until(() => multi.remoteStatuses()[0]?.state === "connected");
  assert.ok(clients.length >= 2, "reconnected after the failed renewal");
  await multi.dispose();
});

test("A proof refused for this computer's clock keeps the pairing and says why", async () => {
  const key = (await createDeviceKey()).key;
  const skew = { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential", dpopFailureReason: "time_window" };
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); client.connectError = skew; return client as never; },
    reconnectDelayMs: 60_000, renewToken: async () => { throw skew; },
  });
  await multi.setRemoteEnvironments([keyBound()]);
  await until(() => multi.remoteStatuses()[0]?.state === "error");
  assert.match(multi.remoteStatuses()[0]!.error ?? "", /clock/);
  await multi.dispose();
});

test("A refused proof (proxy rewriting the request, replay) keeps the pairing and retries; a refused session ends it", async () => {
  const key = (await createDeviceKey()).key;
  for (const [dpopFailureReason, expected] of [["request_mismatch", /address of each request/], ["replay", /Retrying/], ["key_mismatch", null]] as const) {
    const refused = { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential", dpopFailureReason };
    const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
      makeClient: () => { const client = new AuthRecordingClient(); client.connectError = refused; return client as never; },
      reconnectDelayMs: 60_000, renewToken: async () => { throw refused; },
    });
    await multi.setRemoteEnvironments([keyBound()]);
    await until(() => ["error", "expired"].includes(multi.remoteStatuses()[0]?.state ?? ""));
    const status = multi.remoteStatuses()[0]!;
    if (expected) { assert.equal(status.state, "error", dpopFailureReason); assert.match(status.error ?? "", expected); }
    else assert.equal(status.state, "expired", dpopFailureReason);
    await multi.dispose();
  }
});

test("Pairing explains a refused proof instead of blaming the link", async () => {
  for (const [dpopFailureReason, expected] of [["time_window", /clock/], ["request_mismatch", /changes the address/], ["key_mismatch", /rejected/]] as const) {
    await assert.rejects(pairRemoteEnvironment("https://box.example.ts.net/pair#token=ABCDEFGH2345", { deps: {
      fetchDescriptor: async () => ({ ...descriptor, accessTokenRenewal: true }),
      bootstrap: async () => session, now: () => 1,
      bootstrapDpop: async () => { throw { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential", dpopFailureReason, status: 401 }; },
    } }), expected);
  }
});

test("A socket 401 right after a renewal retries; the key-bound token never goes to the bearer check", async () => {
  const key = (await createDeviceKey()).key;
  let checks = 0; const revoked: string[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); client.connectError = { status: 401 }; return client as never; },
    reconnectDelayMs: 60_000,
    checkCredential: async () => { checks += 1; return false; },
    renewToken: async (record) => ({ ...record, accessToken: "renewed", expiresAt: Date.now() + 3_600_000 }),
  });
  multi.onRemoteRevoked = (record) => revoked.push(record.environmentId);
  await multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() - 1 })]); // renews inside connect
  await until(() => multi.remoteStatuses()[0]?.state === "error");
  assert.equal(checks, 0, "no bearer session check for a key-bound pairing");
  assert.deepEqual(revoked, []);
  await multi.dispose();
});

test("Re-pairing a key-bound machine reconnects with the new session", async () => {
  const key = (await createDeviceKey()).key;
  const clients: AuthRecordingClient[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); return client as never; },
    renewToken: async (record) => record,
  });
  await multi.setRemoteEnvironments([keyBound()]);
  await until(() => multi.remoteStatuses()[0]?.state === "connected");
  await multi.setRemoteEnvironments([keyBound({ accessToken: "new-session", addedAt: "2026-03-01T00:00:00.000Z" })]);
  await until(() => clients.length === 2 && multi.remoteStatuses()[0]?.state === "connected");
  assert.equal((await (clients[1]!.auths[0] as ConnectionAuth).current()).token, "new-session");
  await multi.dispose();
});

test("A renewal racing a removal in another window never brings the machine back", async () => {
  const secrets = memorySecrets();
  const windowA = new EnvironmentCatalog(secrets), windowB = new EnvironmentCatalog(secrets);
  const record = keyBound({ environmentId: "race", accessToken: "t1", expiresAt: 100 });
  await windowA.upsert(record);
  // Window A's renewal has already read the catalog when window B removes the machine.
  const realGet = secrets.get.bind(secrets);
  let release!: () => void; const paused = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  secrets.get = async (key) => { const value = await realGet(key); if (key.startsWith("t3-vscode.environments") && ++reads === 1) await paused; return value; };
  const renewal = windowA.updateToken(record, { accessToken: "t2", expiresAt: 200 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  secrets.get = realGet;
  await windowB.remove("race");
  release();
  await renewal;
  assert.deepEqual(await windowA.list(), [], "the catalog never got the machine back");
  assert.deepEqual(await windowB.list(), []);
});

test("A key-bound pairing whose key is unreadable asks to be paired again and never connects as bearer", async () => {
  const clients: AuthRecordingClient[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); return client as never; },
    renewToken: async (record) => record,
  });
  const { dpopKey: _key, ...keyless } = keyBound();
  await multi.setRemoteEnvironments([keyless]);
  await until(() => multi.remoteStatuses()[0]?.state === "expired");
  assert.ok(clients.every((client) => client.auths.length === 0), "nothing was sent");
  await multi.dispose();
});

test("A renewal still running for the old pairing never lands on a fresh re-pairing", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const clients: AuthRecordingClient[] = [];
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); clients.push(client); return client as never; },
    renewToken: async (record) => { if (record.accessToken === "old") { await pending; return { ...record, accessToken: "old-renewed", expiresAt: Date.now() + 3_600_000 }; } return record; },
  });
  void multi.setRemoteEnvironments([keyBound({ accessToken: "old", expiresAt: Date.now() - 1 })]); // renews inside connect, held
  await new Promise((resolve) => setTimeout(resolve, 10));
  await multi.setRemoteEnvironments([keyBound({ accessToken: "fresh", addedAt: "2026-04-01T00:00:00.000Z" })]);
  await until(() => multi.remoteStatuses()[0]?.state === "connected");
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const latest = clients.at(-1)!.auths[0] as ConnectionAuth;
  assert.equal((await latest.current()).token, "fresh");
  await multi.dispose();
});

test("Renewed tokens never go back into the shared catalog", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const record = keyBound({ accessToken: "t1", expiresAt: 100 });
  await catalog.upsert(record);
  await catalog.updateToken(record, { accessToken: "t2", expiresAt: 200 });
  await catalog.setEnabled(record.environmentId, false);
  const stored = JSON.parse(secrets.values.get("t3-vscode.environments.keyBound.v1")!) as { environments: Array<{ accessToken: string; enabled: boolean }> };
  assert.equal(stored.environments[0]!.accessToken, "t1");
  assert.equal(stored.environments[0]!.enabled, false);
  assert.equal((await catalog.list())[0]!.accessToken, "t2");
});

test("The server's refusal right after a renewal ends the session at once", async () => {
  const refused = { _tag: "EnvironmentAuthInvalidError", reason: "invalid_credential" };
  let renewals = 0;
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => { const client = new AuthRecordingClient(); client.connectError = refused; return client as never; },
    reconnectDelayMs: 60_000,
    renewToken: async (record) => { renewals += 1; if (renewals === 1) return { ...record, accessToken: "renewed", expiresAt: Date.now() + 3_600_000 }; throw refused; },
  });
  await multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() - 1 })]); // the first renewal happens inside connect
  await until(() => multi.remoteStatuses()[0]?.state === "expired");
  assert.equal(renewals, 2, "the refusal got its own renewal to decide, despite the one moments before");
  await multi.dispose();
});

test("A stored key that no longer imports shows Pair again instead of retrying", async () => {
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => new AuthRecordingClient() as never, renewToken: async (record) => record,
  });
  await multi.setRemoteEnvironments([keyBound({ dpopKey: { ...testKey.stored, x: "AAAA", d: "AAAA" } })]);
  await until(() => multi.remoteStatuses()[0]?.state === "expired");
  await multi.dispose();
});

test("A renewal finishing after the machine was disabled changes only the token, never re-enabling it", async () => {
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  const multi = new MultiEnvironmentClient(new AuthRecordingClient() as unknown as T3Client, {
    makeClient: () => new AuthRecordingClient() as never,
    renewToken: async (record) => { await pending; return { ...record, enabled: true, accessToken: "renewed", expiresAt: Date.now() + 3_600_000 }; },
  });
  void multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() - 1 })]); // renewal held inside connect
  await new Promise((resolve) => setTimeout(resolve, 10));
  await multi.setRemoteEnvironments([keyBound({ expiresAt: Date.now() - 1, enabled: false })]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const status = multi.remoteStatuses()[0]!;
  assert.equal(status.enabled, false);
  assert.equal(status.state, "disabled");
  await multi.dispose();
});

test("Each pairing keeps its own renewed token, so a late write for an earlier pairing never hides a newer one", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const old = keyBound({ accessToken: "old", expiresAt: 100, addedAt: "2026-01-01T00:00:00.000Z" });
  const fresh = keyBound({ accessToken: "fresh", expiresAt: 100, addedAt: "2026-02-01T00:00:00.000Z" });
  await catalog.upsert(fresh);
  await catalog.updateToken(fresh, { accessToken: "fresh-renewed", expiresAt: 300 });
  // A late renewal of the old pairing writes after the re-pair: it is not even the current pairing, so nothing is stored.
  await catalog.updateToken(old, { accessToken: "old-renewed", expiresAt: 400 });
  assert.equal((await catalog.list())[0]!.accessToken, "fresh-renewed");
  await catalog.remove(fresh.environmentId);
  assert.ok(![...secrets.values.keys()].some((key) => key.startsWith("t3-vscode.environmentToken.v1.")), "removal deletes the pairing's token");
});

test("An older extension rewriting the v1 catalog never strips a key-bound pairing", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const bearer: RemoteEnvironmentRecord = { environmentId: "old", label: "Old", httpBaseUrl: "https://old.example/", wsBaseUrl: "wss://old.example/", accessToken: "b", expiresAt: 1, scopes: [], enabled: true, addedAt: "2026-01-01T00:00:00.000Z" };
  await catalog.upsert(bearer);
  await catalog.upsert(keyBound());
  assert.ok(!secrets.values.get("t3-vscode.environments.v1")!.includes("dpopKey"), "key-bound pairings never go into v1");
  // A 0.3.14 window disables the old machine and rewrites v1 with the fields it knows.
  secrets.values.set("t3-vscode.environments.v1", JSON.stringify({ version: 1, environments: [{ ...bearer, enabled: false }] }));
  const list = await catalog.list();
  assert.equal(list.find((record) => record.environmentId === "kb")?.auth, "dpop");
  assert.ok(list.find((record) => record.environmentId === "kb")?.dpopKey);
  assert.equal(list.find((record) => record.environmentId === "old")?.enabled, false);
});

test("A bearer entry replaced by a key-bound pairing does not come back when that pairing is removed", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const { auth: _a, dpopKey: _k, ...bearerFields } = keyBound();
  await catalog.upsert({ ...bearerFields, accessToken: "bearer" });
  await catalog.upsert(keyBound({ addedAt: "2026-05-01T00:00:00.000Z" }));
  assert.equal((await catalog.list()).length, 1);
  await catalog.remove("kb");
  assert.deepEqual(await catalog.list(), []);
});

test("Re-pairing deletes the earlier pairing's renewed token and keeps the new one's", async () => {
  const secrets = memorySecrets(), catalog = new EnvironmentCatalog(secrets);
  const second = await createDeviceKey();
  const old = keyBound({ accessToken: "old", expiresAt: 100, addedAt: "2026-01-01T00:00:00.000Z" });
  await catalog.upsert(old);
  await catalog.updateToken(old, { accessToken: "old-renewed", expiresAt: 200 });
  const tokenKeys = () => [...secrets.values.keys()].filter((key) => key.startsWith("t3-vscode.environmentToken.v1."));
  assert.equal(tokenKeys().length, 1);
  const fresh = keyBound({ accessToken: "fresh", expiresAt: 100, addedAt: "2026-02-01T00:00:00.000Z", dpopKey: second.stored });
  await catalog.upsert(fresh);
  assert.deepEqual(tokenKeys(), [], "the old pairing's token entry is gone");
  await catalog.updateToken(fresh, { accessToken: "fresh-renewed", expiresAt: 300 });
  assert.equal((await catalog.list())[0]!.accessToken, "fresh-renewed");
});
