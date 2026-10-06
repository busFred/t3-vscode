/**
 * Activation: build the host state machine, register the sidebar webview view
 * and the pop-out editor tab command, and bridge everything together. All T3
 * connection/state lives in the extension host (see host/hostState.ts).
 */

import { basename, resolve } from "node:path";
import * as vscode from "vscode";
import { BridgeHandler, WebviewRegistry } from "./host/bridge.js";
import { HostState, SIDEBAR_VIEW_ID } from "./host/hostState.js";
import { resolveT3Home } from "./host/serverDiscovery.js";
import { SecretCredentialStore } from "./host/sessionStore.js";
import { T3Client } from "./host/t3Client.js";
import { getWorkspaceContext } from "./host/workspaceContext.js";
import { Events, type ProjectSelection, type ProjectSummary, type FavoriteModel } from "./shared/bridge.js";
import { FONT_SIZE_KEYS, resolveAppearance, type AppearanceSettings } from "./shared/appearance.js";
import { editorReference } from "./host/editorReference.js";
import type { FileReference } from "./shared/composerContext.js";

let hostState: HostState | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("t3-vscode");
  const home = resolveT3Home(config.get<string>("t3Home"));
  const serverStartupHint = context.extensionMode === vscode.ExtensionMode.Development
    && resolve(home) === `/tmp/t3-vscode-dev-${basename(context.extensionUri.fsPath)}`
    ? "This F5 session uses an isolated development server. In the original VS Code window, run Terminal → Run Task → T3: start isolated server. Leave its terminal running, then retry the connection."
    : undefined;

  const client = new T3Client();
  hostState = new HostState({ home, serverStartupHint, credentials: new SecretCredentialStore(context.secrets),
    workspaceRoots: () => getWorkspaceContext().roots, pickProject: pickConversationProject,
    appearance: readAppearance,
    favoriteModels: () => context.globalState.get<ReadonlyArray<FavoriteModel>>("favoriteModels", []),
    saveFavoriteModels: (favorites) => context.globalState.update("favoriteModels", favorites) }, client);

  const registry = new WebviewRegistry();
  const showSettings = () => vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
  const bridge = new BridgeHandler(hostState, registry, showSettings);
  const provider = new T3WebviewProvider(context.extensionUri, registry, bridge, hostState);
  hostState.onDidChangeState(() => {
    bridge.pushState();
    provider.updateTitles();
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("t3.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("t3-vscode.openInTab", () => provider.createPanel()),
    vscode.commands.registerCommand("t3-vscode.openInSideBar", async () => {
      await vscode.commands.executeCommand("t3.webview.focus");
    }),
    vscode.commands.registerCommand("t3-vscode.pair", () => hostState?.pairNow()),
    vscode.commands.registerCommand("t3-vscode.reconnect", () => hostState?.reconnect()),
    vscode.commands.registerCommand("t3-vscode.newThread", () => hostState?.newThread()),
    vscode.commands.registerCommand("t3-vscode.showThreads", () => provider.showThreads()),
    vscode.commands.registerCommand("t3-vscode.fontSettings", showSettings),
    vscode.commands.registerCommand("t3-vscode.insertReference", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { await vscode.window.showInformationMessage("Select text in a file to reference it in T3 Code."); return; }
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
        { label: thread.archived ? "$(archive) Restore thread" : "$(archive) Archive thread", action: thread.archived ? "unarchive" : "archive" },
      ], { title: thread.title, placeHolder: "Thread actions" });
      if (!choice) return;
      const title = choice.action === "rename" ? await vscode.window.showInputBox({
        title: "Rename thread", value: thread.title, validateInput: (value) => value.trim() ? null : "Enter a title.",
      }) : undefined;
      if (choice.action === "rename" && title === undefined) return;
      await hostState.threadAction(thread.id, choice.action, title);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (FONT_SIZE_KEYS.some((key) => event.affectsConfiguration(`t3-vscode.${key}`))) hostState?.refreshAppearance();
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
 * Both surfaces render the T3 chat app.
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
    this.registry.add(id, webviewView.webview);
    this.bridge.attach(webviewView.webview, id);
    webviewView.webview.html = this.htmlFor(webviewView.webview, "sidebar");
    webviewView.onDidDispose(() => { if (this.sidebar === webviewView) { this.registry.remove(id); this.sidebar = undefined; } });
    this.updateTitles();
  }

  updateTitles(): void {
    const titleForView = (id: string) => {
      const state = this.host.snapshot(id);
      return state.threads.find((thread) => thread.id === state.activeThreadId)?.title;
    };
    if (this.sidebar) this.sidebar.title = titleForView(SIDEBAR_VIEW_ID) || "Chat";
    for (const [id, panel] of this.panels) panel.title = titleForView(id) || "T3 Code";
  }

  async showThreads(): Promise<void> {
    await vscode.commands.executeCommand("t3.webview.focus");
    await this.sidebar?.webview.postMessage({ event: Events.showNavigation });
  }
  async insertReference(reference: FileReference): Promise<void> {
    const id = this.registry.focusedViewId;
    this.registry.postWhenReady(id, Events.insertReference, { draftKey: this.host.snapshot(id).activeThreadId ?? "new", reference });
    const panel = this.panels.get(id);
    if (panel) panel.reveal(panel.viewColumn);
    else await vscode.commands.executeCommand("t3.webview.focus");
  }

  createPanel(): void {
    const id = `panel_${crypto.randomUUID()}`;
    const panel = vscode.window.createWebviewPanel("t3Panel", "T3 Code", vscode.ViewColumn.One, {
      ...this.webviewOptions(),
      retainContextWhenHidden: true,
    });
    this.host.registerView(id);
    this.panels.set(id, panel);
    this.registry.add(id, panel.webview);
    this.registry.focus(id);
    this.bridge.attach(panel.webview, id);
    panel.webview.html = this.htmlFor(panel.webview, "panel");
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
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `media-src ${webview.cspSource} data: blob:`,
      `connect-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join("; ");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>T3 Code</title>
</head>
<body data-surface="${surface}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
