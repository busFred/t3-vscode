import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { editorReference } from "./editorReference.js";
import { fileReferenceLabel, formatComposerMessage } from "../shared/composerContext.js";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { SIDEBAR_VIEW_ID } from "./hostState.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { viewsHarness } from "./testing/fakeTransport.js";
import { Events } from "../shared/bridge.js";

test("Editor references preserve partial lines and unsaved text with one-based, exclusive ranges", () => {
  const selected = "unsaved α\n```\nchanged";
  const editor = { document: { uri: { scheme: "file", fsPath: "/tmp/workspace/space file.md", toString: () => "file:///tmp/workspace/space%20file.md" }, getText: () => selected },
    selection: { start: { line: 23, character: 5 }, end: { line: 25, character: 7 }, isEmpty: false } } as unknown as vscode.TextEditor;
  const reference = editorReference(editor, "/tmp/workspace");
  assert.deepEqual(reference.range, { start: { line: 24, column: 6 }, end: { line: 26, column: 8 } });
  assert.equal(reference.text, selected); assert.equal(fileReferenceLabel(reference), "space file.md:24-26");
  const message = formatComposerMessage("Discuss this", [reference]);
  assert.ok(message.includes("file:///tmp/workspace/space%20file.md#L24"));
  assert.ok(message.includes("24:6–26:8 (end exclusive)")); assert.ok(message.includes("````\n" + selected + "\n````"));
  assert.equal(fileReferenceLabel({ ...reference, range: { ...reference.range, end: { line: 26, column: 1 } } }), "space file.md:24-25");
});

test("References queue through cold webview startup and route to one focused conversation", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("first-tab"); host.registerView("second-tab");
  await host.selectThread("second", "first-tab"); await host.selectThread("third", "second-tab");
  const registry = new WebviewRegistry(); const bridge = new BridgeHandler(host, registry);
  const first = new FakeWebview(); const second = new FakeWebview(); const sidebar = new FakeWebview();
  registry.add("first-tab", first.webview); registry.add("second-tab", second.webview); registry.add(SIDEBAR_VIEW_ID, sidebar.webview);
  for (const [id, view] of [["first-tab", first], ["second-tab", second], [SIDEBAR_VIEW_ID, sidebar]] as const) bridge.attach(view.webview, id);
  await first.request("focusView"); assert.equal(registry.focusedViewId, "first-tab");
  const delivered = new Promise<void>((resolve) => { first.onPostMessage = (raw) => { if ((raw as { event?: string }).event === Events.insertReference) resolve(); }; });
  const reference = { draftKey: host.snapshot(registry.focusedViewId).activeThreadId, reference: { label: "file.ts" } };
  registry.postWhenReady(registry.focusedViewId, Events.insertReference, reference);
  assert.equal(first.messages.some((raw) => (raw as { event?: string }).event === Events.insertReference), false);
  await first.request("getState"); await delivered;
  assert.equal(first.messages.filter((raw) => (raw as { event?: string }).event === Events.insertReference).length, 1);
  assert.equal(second.messages.length, 0); assert.equal(sidebar.messages.length, 0);
  await first.request("getState"); assert.equal(first.messages.filter((raw) => (raw as { event?: string }).event === Events.insertReference).length, 1);
  await second.request("focusView"); assert.equal(registry.focusedViewId, "second-tab");
  registry.remove("second-tab"); await host.removeView("second-tab"); assert.equal(registry.focusedViewId, SIDEBAR_VIEW_ID);
  assert.equal(host.snapshot("first-tab").activeThreadId, "second"); assert.equal(host.snapshot().activeThreadId, "first"); assert.equal(client.commands.length, 0);
});
