/** Invoked by VS Code's extension-test runner in disposable storage, with no server/provider. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { viewsHarness } from "../src/host/testing/fakeTransport.js";
import { scheduledTaskFixture } from "../src/host/testing/scheduledTaskFixture.js";
import { T3WebviewProvider } from "../src/host/editorProvider.js";
import { BridgeHandler, WebviewRegistry } from "../src/host/bridge.js";

export async function run() {
  const { host, client } = await viewsHarness();
  const registry = new WebviewRegistry();
  let provider: T3WebviewProvider;
  const bridge = new BridgeHandler(host, registry, async () => {}, undefined, undefined, {
    openSessionTab: (id, preview) => provider.openSession(id, preview),
    keepTab: id => provider.keepTab(id),
    editScheduledTask: (request, preview) => provider.editScheduledTask(request, preview),
    closeTaskTab: id => provider.closeTaskTab(id),
  });
  provider = new T3WebviewProvider(vscode.Uri.file(process.env.T3_PREVIEW_REPO!), registry, bridge, host);
  const registration = vscode.window.registerCustomEditorProvider("t3.session", provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false });
  const off = host.onDidChangeState(() => { bridge.pushState(); provider.updateTitles(); });
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputCustom);
  const tick = () => new Promise(resolve => setTimeout(resolve, 100));
  try {
    await vscode.workspace.getConfiguration("workbench.editor").update("enablePreview", true, vscode.ConfigurationTarget.Global);
    const first = await provider.openSession("first", true); await tick();
    assert.equal(tabs().length, 1); assert.equal(tabs()[0]!.isPreview, true, "Single click opens native preview");
    const second = await provider.openSession("second", true); await tick();
    assert.equal(tabs().length, 1); assert.equal(tabs()[0]!.label, "second conversation", "Next preview replaces previous");
    await provider.openSession("second", false); await tick();
    assert.equal(tabs().length, 1); assert.equal(tabs()[0]!.isPreview, false, "Double click promotes same tab");
    const third = await provider.openSession("third", true); await tick();
    assert.equal(tabs().length, 2);
    await provider.keepTab(third); await tick();
    assert.equal(tabs().find(tab => tab.label === "third conversation")!.isPreview, false, "Editing promotes preview");
    await host.selectThread("first", third); provider.updateTitles(); await tick();
    const switched = tabs().find(tab => tab.label === "first conversation")!;
    const switchedUri = (switched.input as vscode.TabInputCustom).uri;
    await vscode.window.tabGroups.close(switched);
    await vscode.commands.executeCommand("vscode.openWith", switchedUri, "t3.session", { preview: false }); await tick();
    assert.ok(tabs().some(tab => tab.label === "first conversation"), "Restored tab keeps History selection");
    await provider.openSession("third", true); await tick();
    assert.ok(tabs().some(tab => tab.label === "third conversation"), "History change must not leave URI pointing to wrong session");
    assert.equal(host.snapshot(second).activeThreadId, "second", "Independent pinned tab unchanged");
    const fresh = await provider.createNewPanel(second); await tick();
    const freshId = host.snapshot(fresh).activeThreadId;
    assert.ok(freshId && freshId !== "second", "New editor starts a distinct conversation after inheriting defaults");
    assert.equal(host.snapshot(second).activeThreadId, "second", "Creating a chat must preserve the originating editor binding");
    const freshTab = tabs().find(tab => tab.label === "New thread")
      ?? vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === "New thread");
    assert.ok(freshTab, "New chat opens in a native editor tab");
    await vscode.window.tabGroups.close(freshTab); await tick();
    assert(!host.snapshot().threads.some(thread => thread.id === freshId), "Closing an untouched new editor cleans up its conversation");
    // Inherit a linked checkout exactly as the new-chat action does, without a real provider.
    client.shell = { ...client.shell, threads: client.shell.threads.map(thread => thread.id === 'second'
      ? { ...thread, worktreePath: '/tmp/t3-vscode-linked-fixture', branch: 'fixture-worktree' } : thread) };
    client.shellHandler!({ kind: 'snapshot', snapshot: client.shell });
    const worktreeView = await provider.createNewPanel(second); await tick();
    const worktreeId = host.snapshot(worktreeView).activeThreadId!;
    assert.equal(host.snapshot(worktreeView).threads.find(thread => thread.id === worktreeId)?.worktreePath, '/tmp/t3-vscode-linked-fixture');
    const worktreeTab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === 'New thread')!;
    await vscode.window.tabGroups.close(worktreeTab); await tick();
    assert(!host.snapshot().threads.some(thread => thread.id === worktreeId), "Closing an untouched worktree editor cleans up its conversation");
    assert(host.snapshot().threads.some(thread => thread.id === 'second'), "The source conversation is retained");
    const projectId = host.snapshot().projects[0]!.id;
    client.scheduledTasks = [scheduledTaskFixture({ projectId, id: "task-one", title: "Task one" }), scheduledTaskFixture({ projectId, id: "task-two", title: "Task two" })];
    assert.equal(host.snapshot().scheduledTasks?.tasks.length ?? 0, 0, "Restore fixture is ready before initial task data");
    await provider.editScheduledTask({ taskId: "task-one", projectId }, true); await tick();
    assert.equal(tabs().find(tab => tab.label === "Task one")!.isPreview, true);
    await provider.editScheduledTask({ taskId: "task-two", projectId }, true); await tick();
    assert.ok(!tabs().some(tab => tab.label === "Task one"));
    await provider.editScheduledTask({ taskId: "task-two", projectId }, false); await tick();
    assert.equal(tabs().find(tab => tab.label === "Task two")!.isPreview, false);
    await provider.openSession("second", true); await tick();
    assert.equal(tabs().filter(tab => tab.label === "second conversation").length, 1);
    await writeFile(process.env.T3_PREVIEW_RESULT!, "Native session/task preview, promotion, History identity, tab reuse and untouched root/worktree chat cleanup checks passed.\n");
  } finally { await vscode.commands.executeCommand("workbench.action.closeAllEditors"); off(); registration.dispose(); await host.dispose(); }
}
