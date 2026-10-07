import test from "node:test";
import assert from "node:assert/strict";
import { insertAttachmentReferences, attachmentMessageContext } from "./composerAttachments.js";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";

test("Inline images preserve cursor positions and distinguish attachments with the same filename", () => {
  const files = [{ key: "one", contextId: "image_one", name: "image.png", mimeType: "image/png", sizeBytes: 3 }, { key: "two", contextId: "image_two", name: "image.png", mimeType: "image/png", sizeBytes: 4 }];
  const inserted = insertAttachmentReferences("Compare these here, then explain.", files, { start: 14, end: 18 });
  assert.equal(inserted.text, "Compare these ![image.png](t3-context://v1/image/image_one) ![image.png](t3-context://v1/image/image_two), then explain.");
  const attachments = files.map((file) => ({ id: file.key, type: "image" as const, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes }));
  const context = attachmentMessageContext(inserted.text, attachments, files.map((file) => ({ contextId: file.contextId, attachmentId: file.key })))!;
  assert.deepEqual(context.records.map((record) => "attachmentId" in record ? record.attachmentId : undefined), ["one", "two"]);
  const providerText = projectComposerContextForProvider({ text: inserted.text, records: context.records });
  assert.ok(providerText.startsWith("Compare these [Image: image.png; ref=image_one] [Image: image.png; ref=image_two], then explain."));
  assert.equal(inserted.text.slice(inserted.cursor), ", then explain.");
  assert.throws(() => attachmentMessageContext(inserted.text, attachments, [{ contextId: "image_one", attachmentId: "foreign" }]), /Invalid inline/);
  assert.throws(() => attachmentMessageContext(inserted.text, attachments, [{ contextId: "bad:id", attachmentId: "one" }]), /matching the RegExp/);
});

test("Repeated image links share one record and deleted inline links emit no unused context", () => {
  const file = { id: "owned", type: "image" as const, name: "real.png", mimeType: "image/png", sizeBytes: 4 };
  const bindings = [{ contextId: "image_one", attachmentId: file.id }];
  const text = "![renamed](t3-context://v1/image/image_one) and ![again](t3-context://v1/image/image_one)";
  assert.equal(attachmentMessageContext(text, [file], bindings)?.records.length, 1);
  assert.equal(attachmentMessageContext("No inline link", [file], bindings), undefined);
  assert.throws(() => attachmentMessageContext(text, [file], [...bindings, ...bindings]), /Invalid inline/);
  assert.throws(() => attachmentMessageContext("[file](t3-context://v1/file/image_one)", [file], bindings), /does not match/);
});

test("Attaching after an image preview preserves references and partial replacement treats them as whole tokens", () => {
  const original = "![image.png](t3-context://v1/image/image_one)";
  const next = { key: "two", contextId: "image_two", name: "next.png", mimeType: "image/png", sizeBytes: 4 };
  const text = `Before ${original} after`;
  const inserted = insertAttachmentReferences(text, [next], { start: 25, end: 25 });
  assert.equal(inserted.text, `Before ${original}![next.png](t3-context://v1/image/image_two) after`);
  const owned = [{ id: "one", type: "image" as const, name: "image.png", mimeType: "image/png", sizeBytes: 3 }, { id: "two", type: "image" as const, name: "next.png", mimeType: "image/png", sizeBytes: 4 }];
  assert.equal(attachmentMessageContext(inserted.text, owned, [{ contextId: "image_one", attachmentId: "one" }, { contextId: "image_two", attachmentId: "two" }])?.records.length, 2);
  assert.equal(insertAttachmentReferences(text, [next], { start: 25, end: 30 }).text, "Before ![next.png](t3-context://v1/image/image_two) after");
});
