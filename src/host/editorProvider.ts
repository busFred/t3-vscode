import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { HostState, SIDEBAR_VIEW_ID } from "./hostState.js";
import { Events } from "../shared/bridge.js";
import type { FileReference } from "../shared/composerContext.js";
import type { DraftTransfer } from "../shared/viewDraft.js";
import type { ScheduledTaskEditorRequest } from "../shared/scheduledTasks.js";
import { usageAccounts } from "../shared/usage.js";

/**
 * Sidebar WebviewViewProvider + editor-tab WebviewPanel host. Same HTML, same
 * bundle, same BridgeHandler — only the container differs (architecture doc §5).
 * The sidebar manages sessions; editor panels render conversations.
 */
export class T3WebviewProvider implements vscode.WebviewViewProvider, vscode.CustomReadonlyEditorProvider {
  private sidebar: vscode.WebviewView | undefined;
  private readonly editorUris = new Map<string, vscode.Uri>();
  private readonly taskRequests = new Map<string, ScheduledTaskEditorRequest>();
  private readonly restoredSelections: Record<string, string>;
  private readonly selectionStorage: vscode.Memento | undefined;
  private editorQueue: Promise<unknown> = Promise.resolve();
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.editorQueue.then(work); this.editorQueue = result.catch(() => {}); return result;
  }
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument { return { uri, dispose() {} }; }
  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
    const request = JSON.parse(document.uri.query) as { threadId?: string; task?: ScheduledTaskEditorRequest };
    const initial = this.host.snapshot();
    if (initial.phase === "error" || initial.phase === "no-server") throw new Error(initial.notice ?? "Connect T3 Code before reopening this tab.");
    // Restored tabs may resolve before the connection has finished.
    if (this.host.snapshot().phase !== "ready") await new Promise<void>((resolve, reject) => {
      const off = this.host.onDidChangeState((state) => { if (state.phase === "ready") { off(); cancel.dispose(); resolve(); } else if (state.phase === "error" || state.phase === "no-server") { off(); cancel.dispose(); reject(new Error(state.notice ?? "T3 Code connection failed.")); } });
      const cancel = token.onCancellationRequested(() => { off(); cancel.dispose(); reject(new Error("Editor opening cancelled.")); });
      if (token.isCancellationRequested) { off(); cancel.dispose(); reject(new Error("Editor opening cancelled.")); }
    });
    // Ready precedes the initial scheduled-task fetch. Serialize a refresh behind
    // startup before validating a restored task URI against the task list.
    if (request.task?.taskId) {
      await this.host.refreshScheduledTasks();
      const error = this.host.snapshot().scheduledTasks?.error; if (error) throw new Error(error);
    }
    const id = `panel_${crypto.randomUUID()}`;
    this.host.registerView(id, SIDEBAR_VIEW_ID, false);
    try {
      if (request.threadId) await this.host.selectThread(this.restoredSelections[document.uri.toString()] ?? request.threadId, id);
      else if (request.task) this.taskRequests.set(id, this.host.scheduledTaskEditorRequest({ ...request.task }));
      else throw new Error("Invalid T3 editor resource.");
      if (token.isCancellationRequested) throw new Error("Editor opening cancelled.");
      this.editorUris.set(id, document.uri);
      this.mountPanel(id, panel.viewColumn ?? vscode.ViewColumn.Active, undefined, panel);
      if (request.task) this.registry.postWhenReady(id, Events.editScheduledTask, request.task);
    } catch (error) { this.taskRequests.delete(id); this.editorUris.delete(id); await this.host.removeView(id); throw error; }
  }
  async keepTab(id: string): Promise<void> {
    const uri = this.editorUris.get(id), panel = this.panels.get(id);
    if (uri && panel && vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isPreview && tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === uri.toString()))) await vscode.commands.executeCommand("vscode.openWith", uri, "t3.session", { preview: false, preserveFocus: true, viewColumn: panel.viewColumn });
  }
  closeTaskTab(id: string): void { if (this.taskRequests.has(id)) this.panels.get(id)?.dispose(); }
  private async openResource(request: { threadId?: string; task?: ScheduledTaskEditorRequest }, preview: boolean): Promise<string> {
    if (request.task) for (const [id, task] of this.taskRequests) {
      if (task.projectId !== request.task.projectId || task.taskId !== request.task.taskId || task.originThreadId !== request.task.originThreadId) continue;
      if (!preview) await this.keepTab(id);
      this.panels.get(id)?.reveal(this.panels.get(id)?.viewColumn, preview); return id;
    }
    // A tab can change its session through History. Use a document identity per
    // tab, and reuse by its current session/task above instead of an obsolete URI.
    const identity = request.threadId ?? request.task?.taskId ?? "new-task";
    const uri = vscode.Uri.from({ scheme: "t3-session", authority: createHash("sha256").update(this.host.snapshot().home).digest("hex").slice(0, 16), path: `/${encodeURIComponent(identity)}/${crypto.randomUUID()}`, query: JSON.stringify(request) });
    await vscode.commands.executeCommand("vscode.openWith", uri, "t3.session", { preview, preserveFocus: preview, viewColumn: vscode.ViewColumn.Active });
    return [...this.editorUris].find(([, value]) => value.toString() === uri.toString())?.[0] ?? "";
  }
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly extensionUri: vscode.Uri;
  private readonly registry: WebviewRegistry;
  private readonly bridge: BridgeHandler;
  private readonly host: HostState;

  constructor(extensionUri: vscode.Uri, registry: WebviewRegistry, bridge: BridgeHandler, host: HostState, selectionStorage?: vscode.Memento) {
    this.extensionUri = extensionUri;
    this.registry = registry;
    this.bridge = bridge;
    this.host = host;
    this.selectionStorage = selectionStorage;
    this.restoredSelections = selectionStorage?.get<Record<string, string>>("editorSessionSelections", {}) ?? {};
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.sidebar = webviewView;
    const id = SIDEBAR_VIEW_ID;
    webviewView.webview.options = this.webviewOptions();
    this.registry.add(id, webviewView.webview, false);
    this.bridge.attach(webviewView.webview, id);
    webviewView.webview.html = this.htmlFor(webviewView.webview, "sidebar");
    webviewView.onDidDispose(() => { if (this.sidebar === webviewView) { this.registry.remove(id); this.sidebar = undefined; } });
    this.updateTitles();
  }

  updateTitles(): void {
    if (this.sidebar) this.sidebar.title = "T3 VSCode";
    for (const [id, panel] of this.panels) { const state = this.host.snapshot(id);
      const resource = this.editorUris.get(id)?.toString();
      if (resource && !this.taskRequests.has(id) && state.activeThreadId && this.restoredSelections[resource] !== state.activeThreadId) {
        delete this.restoredSelections[resource];
        this.restoredSelections[resource] = state.activeThreadId;
        // Retain recent closed tabs for Reopen Closed Editor without unbounded storage.
        const entries = Object.keys(this.restoredSelections);
        for (const stale of entries.slice(0, Math.max(0, entries.length - 500))) if (![...this.editorUris.values()].some(uri => uri.toString() === stale)) delete this.restoredSelections[stale];
        void this.selectionStorage?.update("editorSessionSelections", this.restoredSelections);
      }
      panel.title = this.taskRequests.has(id) ? state.scheduledTasks?.tasks.find(task => task.id === this.taskRequests.get(id)?.taskId)?.title || "New task" : state.threads.find((thread) => thread.id === state.activeThreadId)?.title.trim() || "New conversation"; }
  }

  async editScheduledTask(request: ScheduledTaskEditorRequest, preview = false): Promise<void> {
    await this.enqueue(() => this.openResource({ task: request }, preview));
  }
  async showThreads(): Promise<void> {
    await vscode.commands.executeCommand("t3.webview.focus");
    this.registry.postWhenReady(SIDEBAR_VIEW_ID, Events.showNavigation, undefined);
  }
  async showUsage(accountKey?: string, sourceViewId = this.registry.focusedViewId): Promise<void> {
    const state = this.host.snapshot(sourceViewId);
    const instanceId = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
    const key = accountKey ?? usageAccounts(state).find((account) => account.instanceIds.includes(instanceId ?? ""))?.key;
    await vscode.commands.executeCommand("t3.webview.focus");
    this.registry.postWhenReady(SIDEBAR_VIEW_ID, Events.showUsage, key);
  }
  async createNewPanel(sourceViewId?: string, projectId?: string, choice?: unknown): Promise<string> {
    // Capture the invoking group before project selection or server I/O can move focus.
    const column = (sourceViewId ? this.panels.get(sourceViewId)?.viewColumn : undefined) ?? vscode.window.tabGroups.activeTabGroup.viewColumn;
    const id = `panel_${crypto.randomUUID()}`;
    // Inherit project/model choices, but never the source chat's attachment ownership.
    this.host.registerView(id, sourceViewId ?? this.registry.focusedViewId, false);
    try {
      this.host.beginNewChat(id);
      if (choice !== undefined) await this.host.configureWorktree(choice, projectId, id);
      const threadId = await this.host.newThread(projectId, id);
      await this.host.composerState(threadId, true, false, id);
      this.mountPanel(id, column);
      return id;
    } catch (cause) {
      await this.host.removeView(id);
      throw cause;
    }
  }
  async openSession(threadId: string, preview = false): Promise<string> {
    return this.enqueue(async () => {
      await this.host.selectThread(threadId, SIDEBAR_VIEW_ID);
      for (const [id, panel] of this.panels) if (!this.taskRequests.has(id) && this.host.snapshot(id).activeThreadId === threadId) {
        if (!preview) await this.keepTab(id);
        panel.reveal(panel.viewColumn, preview); this.registry.focus(id); return id;
      }
      return this.openResource({ threadId }, preview);
    });
  }
  async insertReference(reference: FileReference): Promise<void> {
    const focusedId = this.registry.focusedViewId;
    const id = this.panels.has(focusedId) ? focusedId : await this.createPanel(SIDEBAR_VIEW_ID);
    const threadId = this.host.snapshot(id).activeThreadId;
    if (threadId) await this.host.composerState(threadId, undefined, true, id);
    this.registry.postWhenReady(id, Events.insertReference, { draftKey: this.host.snapshot(id).activeThreadId ?? "new", reference: this.host.referenceForView(reference, id) });
    const panel = this.panels.get(id);
    if (panel) panel.reveal(panel.viewColumn);
  }

  async createPanel(sourceViewId = SIDEBAR_VIEW_ID, transfer?: DraftTransfer): Promise<string> {
    const threadId = this.host.snapshot(sourceViewId).activeThreadId;
    if (threadId) for (const [id, panel] of this.panels) if (!this.taskRequests.has(id) && this.host.snapshot(id).activeThreadId === threadId) {
      await this.keepTab(id); panel.reveal(panel.viewColumn); this.registry.focus(id); return id;
    }
    const id = `panel_${crypto.randomUUID()}`;
    this.host.registerView(id, sourceViewId);
    this.mountPanel(id, vscode.ViewColumn.Active, transfer);
    return id;
  }

  private mountPanel(id: string, column: vscode.ViewColumn, transfer?: DraftTransfer, existing?: vscode.WebviewPanel): void {
    const panel = existing ?? vscode.window.createWebviewPanel("t3Panel", "T3 VSCode", column, {
      ...this.webviewOptions(),
      retainContextWhenHidden: true,
    });
    panel.iconPath = { light: vscode.Uri.joinPath(this.extensionUri, "resources", "t3-tab-light.svg"), dark: vscode.Uri.joinPath(this.extensionUri, "resources", "t3-tab-dark.svg") };
    this.panels.set(id, panel);
    panel.webview.options = this.webviewOptions();
    this.registry.add(id, panel.webview, !this.taskRequests.has(id));
    this.registry.focus(id);
    this.bridge.attach(panel.webview, id);
    if (transfer) this.registry.postWhenReady(id, Events.initializeDraft, transfer);
    panel.webview.html = this.htmlFor(panel.webview, this.taskRequests.has(id) ? "task" : "panel");
    this.updateTitles();
    panel.onDidChangeViewState(({ webviewPanel }) => { if (webviewPanel.active) this.registry.focus(id); });
    panel.onDidDispose(() => {
      this.registry.remove(id); this.panels.delete(id); this.editorUris.delete(id); this.taskRequests.delete(id);
      void this.host.removeView(id).catch((cause) => vscode.window.showErrorMessage(String(cause)));
    });
  }

  private webviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
  }

  private htmlFor(webview: vscode.Webview, surface: "sidebar" | "panel" | "task"): string {
    const mathCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "math", "katex.css"));
    const visualsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "mermaid.js"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob: http: https:`,
      `font-src ${webview.cspSource}`,
      `media-src ${webview.cspSource} data: blob: http: https:`,
      `connect-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
      `frame-src http://127.0.0.1:* http://localhost:* http://[::1]:*`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join("; ");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>T3 VSCode</title>
  <link rel="stylesheet" href="${mathCssUri}" />
</head>
<body data-surface="${surface}" data-mermaid-url="${visualsUri}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
