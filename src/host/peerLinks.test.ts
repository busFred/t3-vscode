import test from "node:test";
import assert from "node:assert/strict";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PeerLinkSummary, WS_METHODS, type ServerConfig } from "@t3tools/contracts";
import { T3Client } from "./t3Client.js";
import { viewsHarness } from "./testing/fakeTransport.js";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { peerLinksDenial } from "../shared/peerLinks.js";

const config = (extra: object = {}) => ({ environment: { environmentId: "audit", label: "Local", capabilities: { peerLinks: true } }, settings: { linkedEnvironmentsEnabled: true }, ...extra }) as ServerConfig;
const link = Schema.decodeUnknownSync(PeerLinkSummary)({ environmentId: "build", label: "Build", urls: ["https://build.example"], access: "read-only", linkedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"), expiresAt: DateTime.makeUnsafe("2099-11-01T00:00:00Z"), lastReachedAt: null, lastError: null, status: "reachable" });
const input = { url: "https://build.example", pairingCode: "private-peer-code", access: "approval-required" };

/** Replace only the RPC boundary; use the real adapter decoding, guards and Effect pipeline. */
function adapter(failure?: "typed" | "defect" | "sync") {
  const client = new T3Client(), calls: Array<{ method: string; input: unknown }> = [];
  let current = config();
  const rpc = Object.fromEntries([WS_METHODS.peerLinksList, WS_METHODS.peerLinksLink, WS_METHODS.peerLinksUnlink, WS_METHODS.peerLinksAnswerRequest].map(method => [method, (payload: unknown) => {
    calls.push({ method, input: payload });
    if (failure === "sync") throw new Error(input.pairingCode);
    if (failure === "typed") return Effect.fail(new Error(input.pairingCode));
    if (failure === "defect") return Effect.die(new Error(input.pairingCode));
    return Effect.succeed(method === WS_METHODS.peerLinksList ? { links: [link] } : { removed: true });
  }]));
  Object.defineProperty(client, "config", { get: () => current });
  Object.assign(client, { session: { client: rpc }, run: (effect: Effect.Effect<unknown>) => Effect.runPromise(effect) });
  return { client, calls, configure: (value: ServerConfig) => { current = value; } };
}

test("Peer transport lists, links and unlinks with dedicated RPC payloads", async () => {
  const { client, calls } = adapter();
  assert.deepEqual(await client.listPeerLinks(), { links: [link] });
  await client.linkPeer({ ...input, pairingCode: ` ${input.pairingCode} ` });
  await client.unlinkPeer({ environmentId: "build" });
  assert.deepEqual(calls, [{ method: WS_METHODS.peerLinksList, input: {} }, { method: WS_METHODS.peerLinksLink, input }, { method: WS_METHODS.peerLinksUnlink, input: { environmentId: "build" } }]);
  await assert.rejects(client.linkPeer({ ...input, access: "bad" }), error => error instanceof Error && !error.message.includes(input.pairingCode));
  await assert.rejects(client.unlinkPeer({}), /Invalid/);
  assert.equal(calls.length, 3);
});

test("Peer setting, capability and managed-policy guards reject before transport", async () => {
  const { client, calls, configure } = adapter();
  for (const denied of [config({ settings: { linkedEnvironmentsEnabled: false } }), config({ environment: { capabilities: {} } }), config({ managedPolicy: { organization: "Acme", lockedSettings: [], limits: { clients: ["local"] } } })]) {
    configure(denied);
    assert.ok(peerLinksDenial(denied));
    await assert.rejects(client.listPeerLinks()); await assert.rejects(client.linkPeer(input)); await assert.rejects(client.unlinkPeer({ environmentId: "build" }));
    await assert.rejects(client.answerLinkRequest({ threadId: "first", turnItemId: "link", answer: { type: "decline" } }));
  }
  assert.equal(calls.length, 0);
  assert.match(peerLinksDenial(config({ settings: { linkedEnvironmentsEnabled: false } }))!, /tasks already running finish/);
  assert.match(peerLinksDenial(config({ managedPolicy: { organization: "Acme", lockedSettings: [], limits: { clients: ["local"] } } }))!, /Acme/);
});

test("Pairing failures redact schema errors, typed failures, defects and synchronous throws", async () => {
  for (const failure of ["typed", "defect", "sync"] as const) {
    const { client } = adapter(failure);
    await assert.rejects(client.linkPeer(input), error => error instanceof Error && !String(error).includes(input.pairingCode));
    await assert.rejects(client.answerLinkRequest({ threadId: "first", turnItemId: "link", answer: { type: "link", urls: [input.url], access: input.access, pairingCode: input.pairingCode } }), error => error instanceof Error && !String(error).includes(input.pairingCode));
  }
});

test("Peer management bridge refreshes list, marks paired links, gates and never snapshots codes or raw failures", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.config = { ...client.config, ...config() };
  const calls: unknown[] = [];
  client.listPeerLinks = async () => { calls.push("list"); return { links: [link] }; };
  client.linkPeer = async value => { calls.push(value); };
  client.unlinkPeer = async value => { calls.push(value); };
  client.remoteStatuses = () => [{ environmentId: "build", label: "Build", httpBaseUrl: input.url, enabled: true, state: "connected", expiresAt: null }];
  const registry = new WebviewRegistry(), bridge = new BridgeHandler(host, registry), view = new FakeWebview();
  registry.add(SIDEBAR_VIEW_ID, view.webview); bridge.attach(view.webview, SIDEBAR_VIEW_ID);
  await view.request("refreshPeerLinks");
  assert.deepEqual(host.snapshot().peerLinks?.links, [{ environmentId: "build", label: "Build", status: "reachable", access: "read-only", paired: true }]);
  await view.request("linkPeer", input); await view.request("unlinkPeer", { environmentId: "build" });
  assert.deepEqual(calls, ["list", input, "list", { environmentId: "build" }, "list"]);
  assert.equal(JSON.stringify(view.messages).includes(input.pairingCode), false);
  client.linkPeer = async () => { throw new Error(input.pairingCode); };
  await assert.rejects(view.request("linkPeer", input), error => error instanceof Error && !error.message.includes(input.pairingCode));
  client.config = { ...client.config, ...config({ settings: { linkedEnvironmentsEnabled: false } }) };
  assert.deepEqual(host.snapshot().peerLinks?.links, []);
  assert.deepEqual(host.snapshot().linkRequestPeers?.machines, []);
  await assert.rejects(view.request("linkPeer", input), /Enable Linked environments/);
  await assert.rejects(view.request("unlinkPeer", { environmentId: "build" }), /Enable Linked environments/);
  await view.request("refreshPeerLinks");
  assert.equal(calls.length, 5);
});

test("Conversation peer choices query the owning environment and omit client-local routes", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose()); await host.selectThread("first");
  client.config = { ...client.config, ...config() };
  client.configForThread = () => config({ environment: { environmentId: "remote", label: "Remote", capabilities: { peerLinks: true } } });
  const queried: Array<string | undefined> = [];
  client.listPeerLinks = async threadId => { queried.push(threadId); return { links: [link] }; };
  client.remoteStatuses = () => [{ environmentId: "remote", label: "Remote", httpBaseUrl: "https://remote.example", enabled: true, state: "connected", expiresAt: null }, { environmentId: "ssh", label: "SSH", httpBaseUrl: "http://127.0.0.1:1234", enabled: true, state: "connected", expiresAt: null }];
  await host.refreshPeerLinks("first");
  assert.deepEqual(queried, ["first"]);
  assert.equal(host.snapshot().linkRequestPeers?.environmentId, "remote");
  assert.equal(host.snapshot().peerLinks?.loaded, false);
  assert.deepEqual(host.snapshot().linkRequestPeers?.machines.find(machine => machine.environmentId === "ssh")?.urls, []);
  assert.equal(host.snapshot().linkRequestPeers?.machines.some(machine => machine.environmentId === "remote"), false);
  client.configForThread = () => null;
  assert.ok(host.snapshot().linkRequestPeers?.denial, "unavailable remote config must not use primary settings");
});
