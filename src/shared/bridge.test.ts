import test from "node:test";
import assert from "node:assert/strict";
import { validateRpcMessage, paramsObject, stringParam } from "./bridge.js";
test("The webview cannot tunnel arbitrary T3 RPC methods", () => {
  assert.equal(validateRpcMessage({ id: "1", method: "orchestration.dispatchCommand", params: {} }), null);
  assert.equal(validateRpcMessage({ id: "1", method: "sendMessage", params: { text: "hello" } })?.method, "sendMessage");
  assert.equal(validateRpcMessage({ id: 1, method: "sendMessage" }), null);
});
test("Bridge rejects malformed targets and parameters", () => {
  assert.throws(() => paramsObject([]), /Invalid/);
  assert.throws(() => stringParam({ threadId: " " }, "threadId"), /Missing/);
  assert.throws(() => stringParam({ threadId: 3 }, "threadId"), /Missing/);
});
