import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ComposerDraftStore } from "./composerDraftStore.js";
import { viewsHarness } from "./testing/fakeTransport.js";

test("Closing and restarting recovers text, cursor and attachment bytes; concurrent tabs stay independent", async t => {
  const directory = mkdtempSync(join(tmpdir(), "t3-draft-regression-"));
  const first = await viewsHarness({ draftStore: new ComposerDraftStore(directory) });
  first.host.registerView("a"); await first.host.selectThread("first", "a");
  await first.host.restoreComposerDraft("first", "a");
  first.host.saveComposerDraft("first", { text: "Keep this unsent", contexts: [] }, { start: 3, end: 7 }, "a");
  const image = await first.host.uploadAttachment("image.png", "image/png", new Uint8Array([1, 2, 3]), "a", "first");
  first.host.saveComposerDraft("first", { text: "Keep this unsent", contexts: [], attachments: [image] }, { start: 3, end: 7 }, "a");
  first.host.registerView("b"); await first.host.selectThread("first", "b");
  assert.equal((await first.host.restoreComposerDraft("first", "b")).draft.text, "");
  first.host.saveComposerDraft("first", { text: "Independent draft", contexts: [] }, undefined, "b");
  await first.host.removeView("a"); assert.deepEqual(first.client.deletedAttachments, []);
  first.host.registerView("reopened"); await first.host.selectThread("first", "reopened");
  assert.equal((await first.host.restoreComposerDraft("first", "reopened")).draft.text, "Keep this unsent");
  await first.host.removeView("reopened");
  await first.host.dispose();
  const second = await viewsHarness({ draftStore: new ComposerDraftStore(directory) }); t.after(async () => { await second.host.dispose(); rmSync(directory, { recursive: true, force: true }); });
  second.host.registerView("after-restart"); await second.host.selectThread("first", "after-restart");
  const recovered = await second.host.restoreComposerDraft("first", "after-restart");
  assert.equal(recovered.draft.text, "Keep this unsent"); assert.deepEqual(recovered.selection, { start: 3, end: 7 });
  assert.equal(recovered.draft.attachments?.[0]?.previewUrl, image.previewUrl);
  assert.equal(second.client.uploads.length, 1, "Recover local bytes into a fresh server upload after restart");
  await second.host.sendMessage(recovered.draft.text, "first", "after-restart", "auto", [recovered.draft.attachments![0]!.attachment!.id]);
  assert.equal((await second.host.restoreComposerDraft("first", "after-restart")).draft.text, "");
  second.host.registerView("other"); await second.host.selectThread("first", "other");
  assert.equal((await second.host.restoreComposerDraft("first", "other")).draft.text, "Independent draft", "Sending one draft must not clear another");
});

test("Failed sends retain drafts and reject borrowed attachment metadata", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.restoreComposerDraft("first");
  host.saveComposerDraft("first", { text: "Retry me", contexts: [] }, undefined);
  const image = await host.uploadAttachment("image.png", "image/png", new Uint8Array([1]));
  host.registerView("other"); await host.selectThread("second", "other");
  assert.throws(() => host.saveComposerDraft("second", { text: "borrowed", contexts: [], attachments: [image] }, undefined, "other"), /another chat/);
  client.dispatch = async () => { throw new Error("dispatch rejected"); };
  await assert.rejects(host.sendMessage("Retry me", "first"), /dispatch rejected/);
  assert.equal((await host.restoreComposerDraft("first")).draft.text, "Retry me");
});

test("A host-owned upload finishes into a saved draft after its tab closes", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("uploading"); await host.selectThread("first", "uploading");
  await host.restoreComposerDraft("first", "uploading");
  let finish!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
  const upload = client.uploadAttachment.bind(client);
  client.uploadAttachment = async input => { started(); await blocked; return upload(input); };
  const request = host.uploadAttachment("notes.txt", "text/plain", new Uint8Array([1, 2]), "uploading", "first");
  await began; await host.removeView("uploading"); finish(); await request;
  host.registerView("recover"); await host.selectThread("first", "recover");
  const recovered = await host.restoreComposerDraft("first", "recover");
  assert.equal(recovered.draft.attachments?.[0]?.name, "notes.txt");
  assert.ok(recovered.draft.attachments?.[0]?.attachment);
  assert.deepEqual(client.deletedAttachments, []);
});

test("A rejected first send keeps the unsaved composer, cursor and image editable", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("new-tab");
  await host.restoreComposerDraft("new", "new-tab");
  const image = await host.uploadAttachment("draft.png", "image/png", new Uint8Array([1, 2]), "new-tab");
  host.saveComposerDraft("new", { text: "Retry this draft", contexts: [], attachments: [image] }, { start: 6, end: 10 }, "new-tab");
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async raw => { if ((raw as { type: string }).type === "message.dispatch") throw new Error("dispatch rejected"); await dispatch(raw); };
  await assert.rejects(host.sendMessage("Retry this draft", undefined, "new-tab", "auto", [image.attachment!.id]), /dispatch rejected/);
  assert.equal(host.snapshot("new-tab").activeThreadId, undefined);
  const saved = await host.restoreComposerDraft("new", "new-tab");
  assert.equal(saved.draft.text, "Retry this draft"); assert.equal(saved.draft.attachments?.[0]?.attachment?.id, image.attachment!.id);
  assert.deepEqual(saved.selection, { start: 6, end: 10 });
  assert.deepEqual(client.deletedAttachments, []);
  client.dispatch = dispatch;
  await host.sendMessage(saved.draft.text, undefined, "new-tab", "auto", [image.attachment!.id]);
  assert.ok(host.snapshot("new-tab").activeThreadId);
  assert.equal((await host.restoreComposerDraft("new", "new-tab")).draft.text, "");
});

test("An upload holds its cross-window lease after close and releases it on completion", t => {
  const directory = mkdtempSync(join(tmpdir(), "t3-draft-lease-"));
  const first = new ComposerDraftStore(directory), second = new ComposerDraftStore(directory);
  t.after(() => { first.dispose(); second.dispose(); rmSync(directory, { recursive: true, force: true }); });
  const record = first.claim("scope", "thread", "closed"); first.save(record, { text: "upload pending", contexts: [] });
  const releaseUpload = first.retain(record); first.release("closed");
  assert.notEqual(second.claim("scope", "thread", "other-window").id, record.id);
  first.save(record, { text: "upload finished", contexts: [] }); first.flush(); releaseUpload();
  assert.equal(second.claim("scope", "thread", "reopened").draft.text, "upload finished");
});

test("Recovery cannot resurrect a removed upload or lose newly added slots", async t => {
  const store = new ComposerDraftStore(); const { host, client } = await viewsHarness({ draftStore: store }); t.after(() => host.dispose());
  await host.restoreComposerDraft("first");
  // Use a new owner to seed a recovered pending slot, as after a process restart.
  const recovered = store.claim("/tmp/fake-t3-test:audit", "first", "sidebar");
  store.save(recovered, { text: "keep editing", contexts: [], attachments: [{ key: "old", name: "old.txt", mimeType: "text/plain", sizeBytes: 1, pending: true }] });
  store.keepFile(recovered, "old", new Uint8Array([1]));
  let finish!: () => void, began!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { began = resolve; });
  const upload = client.uploadAttachment.bind(client); client.uploadAttachment = async input => { began(); await blocked; return upload(input); };
  const restoring = host.restoreComposerDraft("first"); await started;
  host.saveComposerDraft("first", { text: "new typing", contexts: [], attachments: [{ key: "new", name: "new.txt", mimeType: "text/plain", sizeBytes: 2, pending: true }] }, undefined);
  finish(); const result = await restoring;
  assert.equal(result.draft.text, "new typing"); assert.deepEqual(result.draft.attachments?.map(file => file.key), ["new"]);
  assert.deepEqual(client.deletedAttachments, ["pending-1"]);
});

test("Offline edits and cursor changes survive closing before reconnection", async t => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("offline"); await host.selectThread("first", "offline"); await host.restoreComposerDraft("first", "offline");
  const image = await host.uploadAttachment("draft.png", "image/png", new Uint8Array([1]), "offline", "first");
  host.saveComposerDraft("first", { text: "Before outage", contexts: [], attachments: [image] }, undefined, "offline");
  client.connected = false;
  host.saveComposerDraft("first", { text: "Latest text during outage", contexts: [], attachments: [image] }, { start: 2, end: 12 }, "offline");
  await host.removeView("offline");
  client.connected = true;
  host.registerView("recovered"); await host.selectThread("first", "recovered");
  const saved = await host.restoreComposerDraft("first", "recovered");
  assert.equal(saved.draft.text, "Latest text during outage"); assert.deepEqual(saved.selection, { start: 2, end: 12 });
  assert.equal(saved.draft.attachments?.[0]?.attachment?.id, image.attachment!.id);
  assert.deepEqual(client.deletedAttachments, []);
});
