import test from "node:test";
import assert from "node:assert/strict";
import { historyCommand } from "./nativeUndo.js";

const key = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });

test("undo/redo shortcuts map to native history commands on every platform", () => {
  assert.equal(historyCommand(key("z", { ctrlKey: true })), "undo");
  assert.equal(historyCommand(key("z", { metaKey: true })), "undo");
  assert.equal(historyCommand(key("Z", { ctrlKey: true, shiftKey: true })), "redo");
  assert.equal(historyCommand(key("z", { metaKey: true, shiftKey: true })), "redo");
  assert.equal(historyCommand(key("y", { ctrlKey: true })), "redo");
});

test("other keys and modifier combinations are left alone", () => {
  assert.equal(historyCommand(key("z")), null);
  assert.equal(historyCommand(key("z", { ctrlKey: true, altKey: true })), null);
  assert.equal(historyCommand(key("y", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(historyCommand(key("c", { ctrlKey: true })), null);
});
