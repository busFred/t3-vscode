import test from "node:test";
import assert from "node:assert/strict";
import { insertAttachmentReferences, attachmentMessageContext } from "./composerAttachments.js";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";

test("Pasted images use selected prose as their description and deliver it with the owned attachment", () => {
  const file = { key: "one", contextId: "image_one", name: "image.png", mimeType: "image/png", sizeBytes: 3 };
  const inserted = insertAttachmentReferences("Compare this result, then explain.", [file], { start: 8, end: 19 }, { useSelectedTextAsImageDescription: true });
  assert.equal(inserted.text, "Compare ![this result](t3-context://v1/image/image_one), then explain.");
  assert.equal(inserted.text.slice(inserted.cursor), ", then explain.");
  const context = attachmentMessageContext(inserted.text, [{ id: "one", type: "image", name: file.name, mimeType: file.mimeType, sizeBytes: 3 }], [{ contextId: "image_one", attachmentId: "one" }])!;
  assert.equal(context.records[0]?.label, "this result");
  assert.ok(projectComposerContextForProvider({ text: inserted.text, records: context.records }).startsWith("Compare [Image: this result; ref=image_one], then explain."));
  assert.equal("name" in context.records[0]! && context.records[0].name, "image.png");
  assert.equal(insertAttachmentReferences("Compare here", [file], { start: 8, end: 8 }, { useSelectedTextAsImageDescription: true }).text, "Compare ![image.png](t3-context://v1/image/image_one)here");
});

test("Image descriptions remain valid inline labels and only describe the first pasted image", () => {
  const image = { key: "one", contextId: "image_one", name: "image.png", mimeType: "image/png", sizeBytes: 3 };
  const file = { ...image, key: "file", contextId: "file_one", name: "notes.txt", mimeType: "text/plain" };
  const description = "line [one]\\\nline two";
  const inserted = insertAttachmentReferences(description, [file, image, { ...image, contextId: "image_two" }], { start: 0, end: description.length }, { useSelectedTextAsImageDescription: true });
  assert.equal(inserted.text, "[notes.txt](t3-context://v1/file/file_one) ![line one line two](t3-context://v1/image/image_one) ![image.png](t3-context://v1/image/image_two)");
  assert.equal(insertAttachmentReferences("   ", [image], { start: 0, end: 3 }, { useSelectedTextAsImageDescription: true }).text, "![image.png](t3-context://v1/image/image_one)");
});

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
  assert.equal(insertAttachmentReferences(text, [next], { start: 25, end: 30 }, { useSelectedTextAsImageDescription: true }).text, "Before ![next.png](t3-context://v1/image/image_two) after");
});
