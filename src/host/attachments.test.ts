import test from "node:test";
import assert from "node:assert/strict";
import { viewsHarness } from "./testing/fakeTransport.js";

test("Pasted and picked uploads are bound to their chat and reach queue/steer dispatches", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const image = await host.uploadAttachment("clipboard.png", "image/png", new Uint8Array([1, 2, 3]));
  assert.ok(image.previewUrl?.startsWith("data:image/png;base64,"));
  assert.equal(client.uploads[0]?.type, "image");
  host.registerView("unrelated"); await host.selectThread("second", "unrelated");
  await assert.rejects(host.sendMessage("", "second", "unrelated", "queue", [image.attachment!.id]), /not available in the current chat/);
  await assert.rejects(host.sendMessage("Hi", "first", "sidebar", "queue", ["arbitrary-id"]), /not available/);
  await host.sendMessage("", "first", "sidebar", "queue", [image.attachment!.id]);
  const queued = client.commands.findLast((command) => command.type === "message.dispatch");
  assert.deepEqual(queued?.attachments, [image.attachment]); assert.deepEqual(queued?.dispatchMode, { type: "queue_after_active" });
  host.registerView("handoff", "sidebar");
  const file = await host.uploadAttachment("notes.pdf", "", new Uint8Array([4, 5, 6]), "handoff", "first");
  assert.equal(file.attachment?.type, "file"); assert.equal(file.mimeType, "application/pdf");
  await host.sendMessage("Read this", "first", "handoff", "steer", [image.attachment!.id, file.attachment!.id]);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.deliveryIntent, "steer");
  await host.releaseAttachment(image.attachment!.id); await host.releaseAttachment(image.attachment!.id, "handoff");
  assert.equal(client.deletedAttachments.includes(image.attachment!.id), false, "Sent attachments must remain available in the transcript");
});

test("Removing a shared draft attachment keeps other views intact and deletes abandoned pending uploads", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const image = await host.uploadAttachment("pasted.png", "image/png", new Uint8Array([1]));
  host.registerView("copy", "sidebar");
  await host.releaseAttachment(image.attachment!.id); assert.deepEqual(client.deletedAttachments, []);
  await host.removeView("copy"); assert.deepEqual(client.deletedAttachments, [image.attachment!.id]);
});
test("Queue and steer preserve inline attachment positions with authoritative context bindings", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const image = await host.uploadAttachment("pasted.png", "image/png", new Uint8Array([1, 2]));
  const text = "Before ![pasted.png](t3-context://v1/image/image_one) after.";
  const references = [{ contextId: "image_one", attachmentId: image.attachment!.id }];
  for (const mode of ["queue", "steer"]) {
    await host.sendMessage(text, "first", "sidebar", mode, [image.attachment!.id], references);
    const command = client.commands.findLast((command) => command.type === "message.dispatch")!;
    assert.equal(command.text, text);
    assert.deepEqual(command.context?.records, [{ version: 1, kind: "image", contextId: "image_one", label: "pasted.png", attachmentId: image.attachment!.id, name: "pasted.png", mimeType: "image/png", sizeBytes: 2 }]);
  }
  await assert.rejects(host.sendMessage(text, "first", "sidebar", "auto", [image.attachment!.id], [{ contextId: "image_one", attachmentId: "unowned" }]), /Invalid inline/);
});

test("Closing a tab during Send cannot delete an attachment before its dispatch finishes", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("sending"); await host.selectThread("second", "sending");
  const image = await host.uploadAttachment("image.png", "image/png", new Uint8Array([1]), "sending", "second");
  let finish!: () => void; let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; }); const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const dispatch = client.dispatch.bind(client);
  client.dispatch = async (command) => { await dispatch(command); if (client.commands.at(-1)?.type === "message.dispatch") { started(); await blocked; } };
  const sending = host.sendMessage("", "second", "sending", "queue", [image.attachment!.id]);
  await waiting; const closing = host.removeView("sending");
  assert.deepEqual(client.deletedAttachments, []);
  finish(); await sending; await closing;
  assert.deepEqual(client.deletedAttachments, [], "Successful sends own their transcript attachment after the last tab closes");
});

test("A pending upload cannot attach to a closed view or delete a touched new conversation", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("new"); const id = await host.newThread(undefined, "new");
  let finish!: () => void; let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; }); const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const upload = client.uploadAttachment.bind(client);
  client.uploadAttachment = async (input) => { const result = await upload(input); started(); await blocked; return result; };
  const uploading = host.uploadAttachment("clipboard.png", "image/png", new Uint8Array([1]), "new", id);
  await waiting; await host.removeView("new"); finish();
  await assert.rejects(uploading, /chat closed/);
  assert.ok(host.snapshot().threads.some((thread) => thread.id === id));
  assert.deepEqual(client.deletedAttachments, ["pending-1"]);
  await assert.rejects(host.uploadAttachment("empty.txt", "text/plain", new Uint8Array()), /nonempty/);
});
