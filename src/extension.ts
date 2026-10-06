/**
 * Activation: build the host state machine, register the sidebar webview view
 * and the pop-out editor tab command, and bridge everything together. All T3
 * connection/state lives in the extension host (see host/hostState.ts).
 */

import * as vscode from "vscode";
import { BridgeHandler, WebviewRegistry } from "./host/bridge.js";
import { HostState } from "./host/hostState.js";
import { resolveT3Home } from "./host/serverDiscovery.js";
import { SecretCredentialStore } from "./host/sessionStore.js";
import { T3Client } from "./host/t3Client.js";
import { getWorkspaceContext } from "./host/workspaceContext.js";
import { Events } from "./shared/bridge.js";

let hostState: HostState | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("t3-vscode");
  const home = resolveT3Home(config.get<string>("t3Home"));

  const client = new T3Client();
  hostState = new HostState({ home, credentials: new SecretCredentialStore(context.secrets), workspaceRoot: () => getWorkspaceContext().root }, client);

  const registry = new WebviewRegistry();
  const bridge = new BridgeHandler(hostState, registry);
  const provider = new T3WebviewProvider(context.extensionUri, registry, bridge);
  hostState.onDidChangeState((state) => {
    bridge.pushState(state);
    provider.updateTitle(state.threads.find((thread) => thread.id === state.activeThreadId)?.title);
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

/**
 * Sidebar WebviewViewProvider + editor-tab WebviewPanel host. Same HTML, same
 * bundle, same BridgeHandler — only the container differs (architecture doc §5).
 * Both surfaces render the T3 chat app.
 */
class T3WebviewProvider implements vscode.WebviewViewProvider {
  private sidebar: vscode.WebviewView | undefined;
  private title = "Chat";
  private readonly extensionUri: vscode.Uri;
  private readonly registry: WebviewRegistry;
  private readonly bridge: BridgeHandler;

  constructor(extensionUri: vscode.Uri, registry: WebviewRegistry, bridge: BridgeHandler) {
    this.extensionUri = extensionUri;
    this.registry = registry;
    this.bridge = bridge;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.sidebar = webviewView;
    webviewView.title = this.title;
    const id = `sidebar_${crypto.randomUUID()}`;
    webviewView.webview.options = this.webviewOptions();
    webviewView.webview.html = this.htmlFor(webviewView.webview, "sidebar");
    this.registry.add(id, webviewView.webview);
    this.bridge.attach(webviewView.webview);
    webviewView.onDidDispose(() => { this.registry.remove(id); if (this.sidebar === webviewView) this.sidebar = undefined; });
  }

  updateTitle(title?: string): void {
    const next = title || "Chat";
    if (next === this.title) return;
    this.title = next;
    if (this.sidebar) this.sidebar.title = this.title;
  }

  async showThreads(): Promise<void> {
    await vscode.commands.executeCommand("t3.webview.focus");
    await this.sidebar?.webview.postMessage({ event: Events.showNavigation });
  }

  createPanel(): void {
    const id = `panel_${crypto.randomUUID()}`;
    const panel = vscode.window.createWebviewPanel("t3Panel", "T3 Code", vscode.ViewColumn.One, {
      ...this.webviewOptions(),
      retainContextWhenHidden: true,
    });
    // Selection and live state are shared with the sidebar.
    panel.webview.html = this.htmlFor(panel.webview, "panel");
    this.registry.add(id, panel.webview);
    this.bridge.attach(panel.webview);
    panel.onDidDispose(() => this.registry.remove(id));
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
