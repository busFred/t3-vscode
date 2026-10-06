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
