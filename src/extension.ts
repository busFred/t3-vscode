/**
 * Activation: build the host state machine, register the sidebar webview view
 * and the pop-out editor tab command, and bridge everything together. All T3
 * connection/state lives in the extension host (see host/hostState.ts).
 */

import { createHash } from "node:crypto";
import { ComposerDraftStore } from "./host/composerDraftStore.js";
import { basename, resolve } from "node:path";
import * as vscode from "vscode";
import { BridgeHandler, WebviewRegistry } from "./host/bridge.js";
import { HostState, SIDEBAR_VIEW_ID } from "./host/hostState.js";
import { resolveT3Home } from "./host/serverDiscovery.js";
import { SecretCredentialStore } from "./host/sessionStore.js";
import { T3Client } from "./host/t3Client.js";
import { getWorkspaceContext } from "./host/workspaceContext.js";
import { Events, type ProjectSelection, type ProjectSummary, type FavoriteModel } from "./shared/bridge.js";
import { resolveMessageNavigation } from "./shared/messageNavigation.js";
import { FONT_SIZE_KEYS, resolveAppearance, type AppearanceSettings } from "./shared/appearance.js";
import { editorReference } from "./host/editorReference.js";
import type { FileReference } from "./shared/composerContext.js";
import { registerNativeDiff } from "./host/nativeDiff.js";
import { UsageStatusBar } from "./host/usageStatusBar.js";
import { InputNotificationTracker } from "./host/inputNotifications.js";
import type { DraftTransfer } from "./shared/viewDraft.js";
import { usageAccounts } from "./shared/usage.js";
import { parseModelPreferencesImport, type ModelPickerPreferences } from "./shared/modelPreferences.js";

let hostState: HostState | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("t3-vscode");
  const home = resolveT3Home(config.get<string>("t3Home"));
  const serverStartupHint = context.extensionMode === vscode.ExtensionMode.Development
    && resolve(home) === `/tmp/t3-vscode-dev-${basename(context.extensionUri.fsPath)}`
    ? "This F5 session uses an isolated development server. In the original VS Code window, run Terminal → Run Task → T3 VSCode: start isolated server. Leave its terminal running, then retry the connection."
    : undefined;

  const client = new T3Client();
  hostState = new HostState({ draftStore: new ComposerDraftStore(resolve((context.storageUri ?? context.globalStorageUri).fsPath, "composer-drafts", createHash("sha256").update(home).digest("hex").slice(0, 24))), home, serverStartupHint, credentials: new SecretCredentialStore(context.secrets),
    workspaceRoots: () => getWorkspaceContext().roots, pickProject: pickConversationProject,
    appearance: readAppearance, messageNavigation: () => resolveMessageNavigation(vscode.workspace.getConfiguration("t3-vscode").get("messageNavigation")),
    modelPreferences: () => context.globalState.get<ModelPickerPreferences>("modelPickerPreferences")
      ?? { favoriteModels: context.globalState.get<ReadonlyArray<FavoriteModel>>("favoriteModels", []), providerModelPreferences: {} },
    searchPreferences: context.workspaceState.get("sessionSearchPreferences", {}),
    saveSearchPreferences: (preferences) => context.workspaceState.update("sessionSearchPreferences", preferences),
    saveModelPreferences: (preferences) => context.globalState.update("modelPickerPreferences", preferences) }, client);

  const importModelPreferences = async () => {
    const json = await vscode.window.showInputBox({ title: "Import T3 Web Model Preferences",
      prompt: "Paste the model-preferences JSON copied from T3 Web. See the README for the browser copy command.",
      placeHolder: '{"favorites":[],"providerModelPreferences":{…}}', ignoreFocusOut: true,
      validateInput: (value) => { try { parseModelPreferencesImport(value); return null; } catch (cause) { return String((cause as Error).message); } },
    });
    if (json === undefined) return;
    await hostState!.importModelPreferences(json);
    await vscode.window.showInformationMessage("T3 Web model preferences imported into VS Code.");
  };

  const registry = new WebviewRegistry();
  const showSettings = () => vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
  let provider: T3WebviewProvider;
  const meters = new UsageStatusBar(() => hostState!.snapshot(registry.focusedViewId));
  const bridge = new BridgeHandler(hostState, registry, showSettings, undefined, registerNativeDiff(context), {
    openInTab: (id, draft) => provider.createPanel(id, draft),
    newChatTab: (id) => provider.createNewPanel(id),
    showUsage: (id, key) => provider.showUsage(key, id), configureUsage: () => meters.configure(), importModelPreferences,
  });
  provider = new T3WebviewProvider(context.extensionUri, registry, bridge, hostState);
  const notifications = new InputNotificationTracker();
  const unlisten = hostState.onDidChangeState((state) => {
    bridge.pushState();
    provider.updateTitles();
    meters.update();
    for (const thread of notifications.update(state)) {
      void vscode.window.showInformationMessage(`T3 VSCode: "${thread.title || "Untitled session"}" needs ${thread.pendingRuntimeRequest?.kind === "user_input" ? "your input" : "your approval"}.`, "Open session").then(async (choice) => {
        if (choice !== "Open session" || !hostState?.snapshot().threads.some((item) => item.id === thread.id)) return;
        try { await provider.openSession(thread.id); }
        catch (cause) { await vscode.window.showErrorMessage(String(cause)); }
      });
    }
  });
  const unfocus = registry.onDidFocusView(() => meters.update());
  context.subscriptions.push(
    meters, { dispose: unlisten }, { dispose: unfocus },
    vscode.window.registerWebviewViewProvider("t3.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("t3-vscode.openInTab", () => provider.createNewPanel()),
    vscode.commands.registerCommand("t3-vscode.openExistingChatInTab", (viewId?: string) => provider.createPanel(viewId ?? registry.focusedViewId)),
    vscode.commands.registerCommand("t3-vscode.pair", () => hostState?.pairNow()),
    vscode.commands.registerCommand("t3-vscode.reconnect", () => hostState?.reconnect()),
    vscode.commands.registerCommand("t3-vscode.newThread", () => provider.createNewPanel()),
    vscode.commands.registerCommand("t3-vscode.showThreads", () => provider.showThreads()),
    vscode.commands.registerCommand("t3-vscode.showUsage", (accountKey?: string) => provider.showUsage(accountKey)),
    vscode.commands.registerCommand("t3-vscode.configureUsage", () => meters.configure()),
    vscode.commands.registerCommand("t3-vscode.importModelPreferences", importModelPreferences),
    vscode.commands.registerCommand("t3-vscode.openWebUi", async () => {
      try { await vscode.env.openExternal(vscode.Uri.parse(hostState!.webUiUrl(SIDEBAR_VIEW_ID))); }
      catch (cause) { await vscode.window.showInformationMessage(String(cause)); }
    }),
    vscode.commands.registerCommand("t3-vscode.fontSettings", showSettings),
    vscode.commands.registerCommand("t3-vscode.insertReference", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { await vscode.window.showInformationMessage("Select text in a file to reference it in T3 VSCode."); return; }
      try { await provider.insertReference(editorReference(editor, vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath)); }
      catch (cause) { await vscode.window.showErrorMessage(String(cause)); }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void hostState?.workspaceChanged().catch((cause) => vscode.window.showErrorMessage(String(cause)));
    }),
    vscode.commands.registerCommand("t3-vscode.threadActions", async () => {
      const state = hostState?.snapshot();
      const thread = state?.threads.find((item) => item.id === state.activeThreadId);
      if (!thread || !hostState) return;
      const choice = await vscode.window.showQuickPick([
        { label: "$(edit) Rename thread", action: "rename" },
        { label: thread.pinned ? "$(pinned) Unpin thread" : "$(pin) Pin thread", action: thread.pinned ? "unpin" : "pin" },
        ...(!thread.archived ? [{ label: thread.settled ? "$(debug-restart) Unsettle thread" : "$(check) Settle thread", action: thread.settled ? "unsettle" : "settle" }] : []),
        { label: thread.archived ? "$(archive) Restore thread" : "$(archive) Archive thread", action: thread.archived ? "unarchive" : "archive" },
        { label: "$(trash) Delete thread", action: "delete" },
      ], { title: thread.title, placeHolder: "Thread actions" });
      if (!choice) return;
      await bridge.performThreadAction(thread.id, choice.action);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("t3-vscode.messageNavigation") || FONT_SIZE_KEYS.some((key) => event.affectsConfiguration(`t3-vscode.${key}`))) hostState?.refreshAppearance();
      if (event.affectsConfiguration("t3-vscode.usage")) meters.update();
      if (event.affectsConfiguration("t3-vscode.t3Home")) {
        void vscode.window
          .showInformationMessage("T3 home setting changed. Reload the window to apply it.", "Reload")
          .then((choice) => {
            if (choice === "Reload") {
              void vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
      }
    }),
  );

  await hostState.start();
}

export async function deactivate(): Promise<void> {
  await hostState?.dispose();
  hostState = null;
}

function readAppearance(): AppearanceSettings {
  const config = vscode.workspace.getConfiguration("t3-vscode");
  return resolveAppearance({ fontSizeInterface: config.get("fontSizeInterface"), fontSizePrompt: config.get("fontSizePrompt"), fontSizeCode: config.get("fontSizeCode") });
}

async function pickConversationProject(projects: ReadonlyArray<ProjectSummary>, supportsNoProject: boolean, workspaceRoots: ReadonlyArray<string>): Promise<ProjectSelection | null> {
  if (workspaceRoots.length) {
    const choices = workspaceRoots.map((root) => {
      const project = projects.find((entry) => resolve(entry.workspaceRoot) === resolve(root));
      return { label: project?.title ?? basename(root), description: root, selection: project ? { projectId: project.id } : { workspaceRoot: root } };
    });
    if (choices.length === 1) return choices[0]!.selection;
    return (await vscode.window.showQuickPick(choices, { title: "Conversation workspace folder", matchOnDescription: true }))?.selection ?? null;
  }
  if (projects.length || supportsNoProject) {
    const choices: Array<vscode.QuickPickItem & { selection: ProjectSelection | null }> = [
      ...(supportsNoProject ? [{ label: "$(comment-discussion) No project", description: "Start without a project", selection: { noProject: true } as const }] : []),
      ...projects.map((project) => ({ label: project.title, description: project.workspaceRoot, selection: { projectId: project.id } })),
      { label: "$(folder-opened) Choose folder…", description: "Use a folder as a T3 project", selection: null },
    ];
    const choice = await vscode.window.showQuickPick(choices, { title: "Conversation project", matchOnDescription: true });
    if (!choice) return null;
    if (choice.selection) return choice.selection;
  }
  const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    title: "Choose a T3 project folder", openLabel: "Use project folder" });
  return folders?.[0] ? { workspaceRoot: folders[0].fsPath } : null;
}

/**
 * Sidebar WebviewViewProvider + editor-tab WebviewPanel host. Same HTML, same
 * bundle, same BridgeHandler — only the container differs (architecture doc §5).
 * The sidebar manages sessions; editor panels render conversations.
 */
class T3WebviewProvider implements vscode.WebviewViewProvider {
  private sidebar: vscode.WebviewView | undefined;
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly extensionUri: vscode.Uri;
  private readonly registry: WebviewRegistry;
  private readonly bridge: BridgeHandler;
  private readonly host: HostState;

  constructor(extensionUri: vscode.Uri, registry: WebviewRegistry, bridge: BridgeHandler, host: HostState) {
    this.extensionUri = extensionUri;
    this.registry = registry;
    this.bridge = bridge;
    this.host = host;
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
    for (const [id, panel] of this.panels) { const state = this.host.snapshot(id); panel.title = state.threads.find((thread) => thread.id === state.activeThreadId)?.title.trim() || "New conversation"; }
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
  async createNewPanel(sourceViewId?: string): Promise<string> {
    // Capture the invoking group before project selection or server I/O can move focus.
    const column = (sourceViewId ? this.panels.get(sourceViewId)?.viewColumn : undefined) ?? vscode.window.tabGroups.activeTabGroup.viewColumn;
    const id = `panel_${crypto.randomUUID()}`;
    // Inherit project/model choices, but never the source chat's attachment ownership.
    this.host.registerView(id, sourceViewId ?? this.registry.focusedViewId, false);
    try {
      const threadId = await this.host.newThread(undefined, id);
      await this.host.composerState(threadId, true, false, id);
      this.mountPanel(id, column);
      return id;
    } catch (cause) {
      await this.host.removeView(id);
      throw cause;
    }
  }
  async openSession(threadId: string): Promise<string> {
    for (const [id, panel] of this.panels) if (this.host.snapshot(id).activeThreadId === threadId) {
      panel.reveal(panel.viewColumn); this.registry.focus(id); return id;
    }
    await this.host.selectThread(threadId, SIDEBAR_VIEW_ID);
    return this.createPanel(SIDEBAR_VIEW_ID);
  }
  async insertReference(reference: FileReference): Promise<void> {
    const focusedId = this.registry.focusedViewId;
    const id = this.panels.has(focusedId) ? focusedId : await this.createPanel(SIDEBAR_VIEW_ID);
    const threadId = this.host.snapshot(id).activeThreadId;
    if (threadId) await this.host.composerState(threadId, undefined, true, id);
    this.registry.postWhenReady(id, Events.insertReference, { draftKey: this.host.snapshot(id).activeThreadId ?? "new", reference });
    const panel = this.panels.get(id);
    if (panel) panel.reveal(panel.viewColumn);
  }

  async createPanel(sourceViewId = SIDEBAR_VIEW_ID, transfer?: DraftTransfer): Promise<string> {
    const threadId = this.host.snapshot(sourceViewId).activeThreadId;
    if (threadId) for (const [id, panel] of this.panels) if (this.host.snapshot(id).activeThreadId === threadId) {
      panel.reveal(panel.viewColumn); this.registry.focus(id); return id;
    }
    const id = `panel_${crypto.randomUUID()}`;
    this.host.registerView(id, sourceViewId);
    this.mountPanel(id, vscode.ViewColumn.Active, transfer);
    return id;
  }

  private mountPanel(id: string, column: vscode.ViewColumn, transfer?: DraftTransfer): void {
    const panel = vscode.window.createWebviewPanel("t3Panel", "T3 VSCode", column, {
      ...this.webviewOptions(),
      retainContextWhenHidden: true,
    });
    panel.iconPath = { light: vscode.Uri.joinPath(this.extensionUri, "resources", "t3-tab-light.svg"), dark: vscode.Uri.joinPath(this.extensionUri, "resources", "t3-tab-dark.svg") };
    this.panels.set(id, panel);
    this.registry.add(id, panel.webview);
    this.registry.focus(id);
    this.bridge.attach(panel.webview, id);
    if (transfer) this.registry.postWhenReady(id, Events.initializeDraft, transfer);
    panel.webview.html = this.htmlFor(panel.webview, "panel");
    this.updateTitles();
    panel.onDidChangeViewState(({ webviewPanel }) => { if (webviewPanel.active) this.registry.focus(id); });
    panel.onDidDispose(() => {
      this.registry.remove(id); this.panels.delete(id);
      void this.host.removeView(id).catch((cause) => vscode.window.showErrorMessage(String(cause)));
    });
  }

  private webviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
  }

  private htmlFor(webview: vscode.Webview, surface: "sidebar" | "panel"): string {
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
