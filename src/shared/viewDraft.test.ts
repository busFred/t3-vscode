import assert from "node:assert/strict";
import test from "node:test";
import { parseDraftTransfer } from "./viewDraft.js";
test("Editor handoff transfers unsent text and rejects a draft for a different conversation", () => {
  const raw = { draftKey: "thread-one", draft: { text: "Unsent sidebar text", contexts: [] } };
  assert.deepEqual(parseDraftTransfer(raw, "thread-one"), raw);
  assert.throws(() => parseDraftTransfer(raw, "thread-two"), /conversation changed/);
  assert.throws(() => parseDraftTransfer({ ...raw, draft: { text: "Draft", contexts: [{ type: "file" }] } }, "thread-one"), /Invalid file reference/);
  assert.equal(parseDraftTransfer({}, "thread-one"), undefined);
});
test("Editor handoff preserves uploaded attachments and rejects unfinished or executable previews", () => {
  const attachment = { key: "local", name: "image.png", mimeType: "image/png", sizeBytes: 3, environmentId: "local", previewUrl: "data:image/png;base64,AQID", attachment: { id: "pending-1", type: "image", name: "image.png", mimeType: "image/png", sizeBytes: 3 } };
  const raw = { draftKey: "new", draft: { text: "", contexts: [], attachments: [attachment] } };
  assert.deepEqual(parseDraftTransfer(raw, "new"), raw);
  assert.throws(() => parseDraftTransfer({ ...raw, draft: { ...raw.draft, attachments: [{ ...attachment, pending: true }] } }, "new"), /finish uploading/);
  assert.throws(() => parseDraftTransfer({ ...raw, draft: { ...raw.draft, attachments: [{ ...attachment, previewUrl: "javascript:alert(1)" }] } }, "new"), /Invalid attachment preview/);
});
