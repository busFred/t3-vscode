import test from "node:test";
import assert from "node:assert/strict";
import {
  ENVIRONMENT_CATALOG_KEY, EnvironmentCatalog, EnvironmentPairingError, pairRemoteEnvironment,
  type EnvironmentPairingDeps, type RemoteEnvironmentRecord, type SecretBackend,
} from "./environmentCatalog.js";

function fakeSecrets() {
  const data = new Map<string, string>();
  const listeners = new Set<(event: { key: string }) => unknown>();
  const backend: SecretBackend = {
    get: async (key) => data.get(key),
    store: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
    onDidChange: (listener) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
  };
  return { backend, data, fire: (key: string) => listeners.forEach((l) => l({ key })), listeners };
}

const record = (id: string, extra: Partial<RemoteEnvironmentRecord> = {}): RemoteEnvironmentRecord => ({
  environmentId: id, label: `Env ${id}`, httpBaseUrl: `https://${id}.example.ts.net/`, wsBaseUrl: `wss://${id}.example.ts.net/`,
  accessToken: `tok-${id}`, expiresAt: 1_000, scopes: ["a", "b"], enabled: true, addedAt: "2026-01-01T00:00:00.000Z", ...extra,
});

test("list is empty without data and for corrupt JSON", async () => {
  const s = fakeSecrets();
  const catalog = new EnvironmentCatalog(s.backend);
  assert.deepEqual(await catalog.list(), []);
  s.data.set(ENVIRONMENT_CATALOG_KEY, "{not json");
  assert.deepEqual(await catalog.list(), []);
  s.data.set(ENVIRONMENT_CATALOG_KEY, JSON.stringify({ version: 1 }));
  assert.deepEqual(await catalog.list(), []);
});

test("upsert appends, replaces by id; remove and setEnabled work", async () => {
  const s = fakeSecrets();
  const catalog = new EnvironmentCatalog(s.backend);
  await catalog.upsert(record("a"));
  await catalog.upsert(record("b"));
  await catalog.upsert(record("a", { label: "Renamed" }));
  assert.deepEqual((await catalog.list()).map((e) => [e.environmentId, e.label]), [["a", "Renamed"], ["b", "Env b"]]);
  await catalog.setEnabled("b", false);
  assert.equal((await catalog.list())[1]?.enabled, false);
  await catalog.remove("a");
  assert.deepEqual((await catalog.list()).map((e) => e.environmentId), ["b"]);
  await catalog.remove("missing");
  await catalog.setEnabled("missing", true);
  assert.equal((await catalog.list()).length, 1);
  assert.deepEqual(JSON.parse(s.data.get(ENVIRONMENT_CATALOG_KEY)!).version, 1);
});

test("malformed entries are dropped silently", async () => {
  const s = fakeSecrets();
  const good = record("good", { serverVersion: "1.2.3", expiresAt: null });
  s.data.set(ENVIRONMENT_CATALOG_KEY, JSON.stringify({
    version: 1,
    environments: [good, null, 5, { environmentId: "x" }, { ...record("bad"), enabled: "yes" }, { ...record("bad2"), scopes: [1] }, { ...record("bad3"), expiresAt: "soon" }, good],
  }));
  const list = await new EnvironmentCatalog(s.backend).list();
  assert.deepEqual(list, [good]);
});

test("mutations re-read storage so another window's writes are kept", async () => {
  const s = fakeSecrets();
  const catalog = new EnvironmentCatalog(s.backend);
  await catalog.upsert(record("a"));
  await catalog.list();
  // Another window adds "b" directly in storage.
  await new EnvironmentCatalog(s.backend).upsert(record("b"));
  await catalog.upsert(record("c"));
  assert.deepEqual((await catalog.list()).map((e) => e.environmentId), ["a", "b", "c"]);
});

test("concurrent mutations in one process are serialized", async () => {
  const s = fakeSecrets();
  const catalog = new EnvironmentCatalog(s.backend);
  await Promise.all(["a", "b", "c", "d"].map((id) => catalog.upsert(record(id))));
  assert.deepEqual((await catalog.list()).map((e) => e.environmentId), ["a", "b", "c", "d"]);
});

test("a failed write does not wedge later mutations", async () => {
  const s = fakeSecrets();
  let fail = true;
  const backend: SecretBackend = { ...s.backend, store: async (k, v) => { if (fail) throw new Error("boom"); await s.backend.store(k, v); } };
  const catalog = new EnvironmentCatalog(backend);
  await assert.rejects(catalog.upsert(record("a")), /boom/);
  fail = false;
  await catalog.upsert(record("b"));
  assert.deepEqual((await catalog.list()).map((e) => e.environmentId), ["b"]);
});

test("onDidChange only fires for the catalog key and can be disposed", () => {
  const s = fakeSecrets();
  const catalog = new EnvironmentCatalog(s.backend);
  let count = 0;
  const sub = catalog.onDidChange(() => { count += 1; });
  s.fire("other.key");
  assert.equal(count, 0);
  s.fire(ENVIRONMENT_CATALOG_KEY);
  assert.equal(count, 1);
  sub.dispose();
  s.fire(ENVIRONMENT_CATALOG_KEY);
  assert.equal(count, 1);
  assert.equal(s.listeners.size, 0);
});

const TOKEN = "SECRETTOKEN123";
const link = `https://box.tailnet.ts.net/pair#token=${TOKEN}`;
const okDeps = (over: Partial<EnvironmentPairingDeps> = {}): Partial<EnvironmentPairingDeps> => ({
  fetchDescriptor: async () => ({ environmentId: "env-remote", label: "Remote Box", serverVersion: "9.9.9", orchestrationProtocolVersion: 2 }),
  bootstrap: async () => ({ access_token: "bearer-1", expires_in: 100, scope: "read write" }),
  now: () => 5_000,
  ...over,
});

test("pairRemoteEnvironment returns a record on success", async () => {
  let seen: { httpBaseUrl: string; credential: string } | undefined;
  const rec = await pairRemoteEnvironment(link, {
    localEnvironmentId: "env-local",
    deps: okDeps({ bootstrap: async (input) => { seen = input; return { access_token: "bearer-1", expires_in: 100, scope: "read write" }; } }),
  });
  assert.deepEqual(seen, { httpBaseUrl: "https://box.tailnet.ts.net/", credential: TOKEN });
  assert.deepEqual(rec, {
    environmentId: "env-remote", label: "Remote Box", httpBaseUrl: "https://box.tailnet.ts.net/", wsBaseUrl: "wss://box.tailnet.ts.net/",
    accessToken: "bearer-1", expiresAt: 5_000 + 100_000, scopes: ["read", "write"], enabled: true,
    addedAt: new Date(5_000).toISOString(), serverVersion: "9.9.9",
  });
});

test("pairRemoteEnvironment allows plain http only for loopback", async () => {
  await assert.rejects(
    pairRemoteEnvironment(`http://box.example.com/pair#token=${TOKEN}`, { deps: okDeps() }),
    (e: Error) => e instanceof EnvironmentPairingError && e.message === "Use an https pairing link; plain http would send the token unencrypted." && !e.message.includes(TOKEN),
  );
  for (const host of ["localhost:3773", "127.0.0.1:3773", "[::1]:3773"]) {
    const rec = await pairRemoteEnvironment(`http://${host}/pair#token=${TOKEN}`, { deps: okDeps() });
    assert.match(rec.httpBaseUrl, /^http:\/\//);
  }
});

test("pairRemoteEnvironment rejects invalid links and links without a token", async () => {
  for (const bad of ["", "not a url", "ftp://x/pair#token=ABC", "https://box.example.com/pair"]) {
    await assert.rejects(pairRemoteEnvironment(bad, { deps: okDeps() }), EnvironmentPairingError);
  }
});

test("pairRemoteEnvironment rejects the local environment and old protocols", async () => {
  await assert.rejects(
    pairRemoteEnvironment(link, { localEnvironmentId: "env-remote", deps: okDeps() }),
    { message: "This link is for the local T3 server, which is already connected." },
  );
  await assert.rejects(
    pairRemoteEnvironment(link, { deps: okDeps({ fetchDescriptor: async () => ({ environmentId: "e", label: "l", orchestrationProtocolVersion: 1 }) }) }),
    /protocol 2/,
  );
});

test("pairRemoteEnvironment maps failures without leaking the token", async () => {
  const cases: Array<[Partial<EnvironmentPairingDeps>, RegExp]> = [
    [{ bootstrap: async () => { throw Object.assign(new Error(`status 401 ${TOKEN}`), { status: 401 }); } }, /expired or already used/],
    [{ bootstrap: async () => { throw { _tag: "EnvironmentAuthInvalidError", message: TOKEN }; } }, /expired or already used/],
    [{ bootstrap: async () => { throw new Error("wrapper", { cause: { error: { status: 403 } } }); } }, /expired or already used/],
    [{ bootstrap: async () => { throw new Error(`boom ${TOKEN}`); } }, /Could not complete pairing/],
    [{ fetchDescriptor: async () => { throw new Error(`ECONNREFUSED ${link}`); } }, /Could not reach/],
  ];
  for (const [over, pattern] of cases) {
    await assert.rejects(pairRemoteEnvironment(link, { deps: okDeps(over) }), (e: Error) => {
      assert.ok(e instanceof EnvironmentPairingError);
      assert.match(e.message, pattern);
      assert.ok(!e.message.includes(TOKEN) && !e.message.includes("#token"));
      return true;
    });
  }
});
