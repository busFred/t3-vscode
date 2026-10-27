import test from "node:test";
import assert from "node:assert/strict";
import { choosingMachine } from "./machineChoice.js";

const state = (thread?: Record<string, unknown>) => ({ activeThreadId: thread ? "t" : undefined, threads: thread ? [{ id: "t", ...thread }] : [] }) as never;

test("A new chat, with or without an empty thread, chooses its machine", () => {
  assert.equal(choosingMachine(state()), true);
  assert.equal(choosingMachine(state({ canChooseWorkspace: true, relationshipToParent: null })), true);
  assert.equal(choosingMachine(state({ canChooseWorkspace: true })), true);
});

test("A started conversation or an empty fork does not choose a machine", () => {
  assert.equal(choosingMachine(state({ canChooseWorkspace: false, relationshipToParent: null })), false);
  assert.equal(choosingMachine(state({ canChooseWorkspace: true, relationshipToParent: "fork", parentThreadId: "p" })), false);
});
