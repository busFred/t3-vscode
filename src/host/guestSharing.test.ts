import test from "node:test";
import assert from "node:assert/strict";
import { ThreadGuestShare, type ServerSettings, type ServerConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { harness, FakeTransport } from "./testing/fakeTransport.js";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { FakeWebview } from "./testing/fakeWebview.js";

const share = Schema.decodeUnknownSync(ThreadGuestShare)({ id: "share-one", host: "guest.invalid", createdAt: "2026-11-01T00:00:00Z", expiresAt: "2099-11-02T00:00:00Z", guestName: "Visitor", messages: [
  { id: "proposal-one", text: "Please explain", status: "pending", attachments: [{ type: "file", id: "guest_file", name: "notes.pdf", mimeType: "application/pdf", sizeBytes: 12 }], submittedAt: "2026-11-01T01:00:00Z" },
  { id: "proposal-two", text: "Thanks", status: "sent", submittedAt: "2026-11-01T01:00:00Z" },
] });
const setup = async () => {
  const client = new FakeTransport();
  client.config = { ...client.config, settings: { guestSharingEnabled: true } as ServerSettings };
  client.shell = { ...client.shell, threads: client.shell.threads.map((thread) => ({ ...thread, pendingGuestMessageCount: 1 })) };
  const result = await harness({}, client);
  const id = result.host.snapshot().threads[0]!.id;
  await result.host.selectThread(id);
  const projection = await client.getThreadProjection(id);
  client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: 1, projection: { ...projection, thread: { ...projection.thread, guestShare: share } } });
  return result;
};

test("Guest links are returned only by create and bridge preserves the credential", async (t) => {
  const { host, client } = await setup(); t.after(() => host.dispose());
  const state = host.snapshot();
  assert.equal(state.threads[0]?.guestShare?.id, share.id);
  assert.equal(state.threads[0]?.pendingGuestMessageCount, 1);
  assert.equal(JSON.stringify(state).includes("#credential"), false);
  const registry = new WebviewRegistry(), view = new FakeWebview(); registry.add("sidebar", view.webview);
  const bridge = new BridgeHandler(host, registry, async () => {}); bridge.attach(view.webview, "sidebar");
  const result = await view.request("createGuestShare", { threadId: state.threads[0]!.id });
  assert.equal((result as unknown as { url: string }).url, "https://guest.invalid/guest#credential");
  assert.deepEqual(client.guestShareRequests, [state.threads[0]!.id]);
  assert.equal(JSON.stringify(host.snapshot()).includes("#credential"), false);
});

test("Owner sends, dismisses and stops sharing using the upstream command payloads", async (t) => {
  const { host, client } = await setup(); t.after(() => host.dispose());
  const id = host.snapshot().threads[0]!.id;
  await host.threadAction(id, "send-guest-message", "proposal-one");
  await host.threadAction(id, "dismiss-guest-message", "proposal-one");
  await host.threadAction(id, "stop-sharing");
  const [send, dismiss, close] = client.commands;
  assert.ok(send && dismiss && close);
  assert.deepEqual(send, { type: "message.dispatch", commandId: send.commandId, threadId: id, messageId: send.commandId, guestMessageId: "proposal-one", text: "", attachments: [], dispatchMode: { type: "queue_after_active" }, createdBy: "user", creationSource: "web" });
  assert.deepEqual(dismiss, { type: "thread.guest-message.dismiss", commandId: dismiss.commandId, threadId: id, guestMessageId: "proposal-one" });
  assert.deepEqual(close, { type: "thread.guest-share.close", commandId: close.commandId, threadId: id });
  assert.equal(new Set(client.commands.map((command) => command.commandId)).size, 3);
  await assert.rejects(host.threadAction(id, "send-guest-message", "proposal-two"), /no longer waiting/);
  await assert.rejects(host.threadAction(id, "dismiss-guest-message", "forged"), /no longer waiting/);
});

test("Settings and managed Connect policy block link creation with the upstream explanation", async (t) => {
  const { host, client } = await setup(); t.after(() => host.dispose());
  const id = host.snapshot().threads[0]!.id;
  client.config = { ...client.config, settings: { guestSharingEnabled: false } as ServerSettings };
  assert.equal(host.snapshot().threads[0]?.guestSharingDisabledReason, "Guest links are off. Turn them on in Settings > Labs.");
  await assert.rejects(host.createGuestShare(id), /Guest links are off/);
  client.config = { ...client.config, settings: { guestSharingEnabled: true } as ServerSettings, managedPolicy: { organization: "Example", limits: { connect: false } } as ServerConfig["managedPolicy"] } as unknown as typeof client.config;
  const reason = host.snapshot().threads[0]?.guestSharingDisabledReason;
  assert.ok(reason?.includes("T3 Connect"));
  await assert.rejects(host.createGuestShare(id), { message: reason });
  assert.equal(client.guestShareRequests.length, 0);
  await host.threadAction(id, "stop-sharing");
  assert.equal(client.commands.at(-1)?.type, "thread.guest-share.close");
});


test("Full projection snapshots expose proposals and clear share state without a custom event reducer", async (t) => {
  const { host, client } = await setup(); t.after(() => host.dispose());
  const id = host.snapshot().threads[0]!.id;
  await host.selectThread(id);
  const projection = await client.getThreadProjection(id);
  client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: 10, projection: { ...projection, thread: { ...projection.thread, guestShare: share } } });
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.guestShare?.guestName, "Visitor");
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.pendingGuestMessageCount, 1);
  await host.chatAsset(id, { sourceThreadId: id, itemId: "proposal-one" }, { kind: "attachment", attachmentId: "guest_file" });
  assert.deepEqual(client.assetRequests.at(-1), { _tag: "attachment", attachmentId: "guest_file", fileName: "notes.pdf", mimeType: "application/pdf", disposition: "inline" });
  await assert.rejects(host.chatAsset(id, { sourceThreadId: id, itemId: "proposal-two" }, { kind: "attachment", attachmentId: "guest_file" }), /selected guest message/);
  await assert.rejects(host.chatAsset(id, { sourceThreadId: id, itemId: "proposal-one" }, { kind: "attachment", attachmentId: "forged" }), /selected guest message/);
  client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: 11, projection: { ...projection, thread: { ...projection.thread, guestShare: null } } });
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.guestShare, null);
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.pendingGuestMessageCount, 0);
});

test("Guest sharing gating uses the thread's environment config", async (t) => {
  const client = new FakeTransport();
  client.config = { ...client.config, settings: { guestSharingEnabled: true } as ServerSettings };
  const transport = Object.assign(client, { configForThread: () => ({ ...client.config, settings: { guestSharingEnabled: false } }) as ServerConfig });
  const { host } = await harness({}, transport); t.after(() => host.dispose());
  const id = host.snapshot().threads[0]!.id;
  await assert.rejects(host.createGuestShare(id), /Guest links are off/);
  assert.match(host.snapshot().threads[0]!.guestSharingDisabledReason!, /Guest links are off/);
  assert.equal(client.guestShareRequests.length, 0);
});
