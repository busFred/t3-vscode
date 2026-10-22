import { T3WebviewProvider } from "./host/editorProvider.js";
import { resolveDateFormat, resolveTimeFormat } from "./shared/timeFormat.js";
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
import { Events, type ProjectSelection, type ProjectSummary } from "./shared/bridge.js";
import { resolveMessageNavigation } from "./shared/messageNavigation.js";
import { FONT_SIZE_KEYS, resolveAppearance, type AppearanceSettings } from "./shared/appearance.js";
import { editorReference } from "./host/editorReference.js";
import { registerNativeDiff } from "./host/nativeDiff.js";
import { readRefreshSettings, UsageStatusBar } from "./host/usageStatusBar.js";
import { InputNotificationTracker } from "./host/inputNotifications.js";
import { TaskOriginStore } from "./host/taskOrigins.js";
import { ModelPreferenceStore } from "./host/modelPreferenceStore.js";

let hostState: HostState | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("t3-vscode");
  const home = resolveT3Home(config.get<string>("t3Home"));
  const serverStartupHint = context.extensionMode === vscode.ExtensionMode.Development
    && resolve(home) === `/tmp/t3-vscode-dev-${basename(context.extensionUri.fsPath)}`
    ? "This F5 session uses an isolated development server. In the original VS Code window, run Terminal → Run Task → T3 VSCode: start isolated server. Leave its terminal running, then retry the connection."
    : undefined;

  const client = new T3Client();
  const modelPreferences = new ModelPreferenceStore(context.globalState);
  const taskOrigins = new TaskOriginStore(context.globalState);
  hostState = new HostState({ draftStore: new ComposerDraftStore(resolve((context.storageUri ?? context.globalStorageUri).fsPath, "composer-drafts", createHash("sha256").update(home).digest("hex").slice(0, 24))), home, serverStartupHint, credentials: new SecretCredentialStore(context.secrets),
    worktreeRefreshMinutes: () => readRefreshSettings().worktreeIntervalMinutes,
    worktreeStorageRoot: resolve(context.globalStorageUri.fsPath, "worktrees"),
    restoreStorageRoot: resolve(context.globalStorageUri.fsPath, "restore"),
    assertTrustedWorkspace: async () => {
      if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace using Manage Workspace Trust before running worktree setup or actions.");
    },
    taskOrigins: () => taskOrigins.read(), saveTaskOrigin: (origin) => taskOrigins.save(origin),
    workspaceRoots: () => getWorkspaceContext().roots, pickProject: pickConversationProject,
    dateFormat: () => resolveDateFormat(vscode.workspace.getConfiguration("t3-vscode").get("dateFormat")),
    timeFormat: () => resolveTimeFormat(vscode.workspace.getConfiguration("t3-vscode").get("timeFormat")), appearance: readAppearance, messageNavigation: () => resolveMessageNavigation(vscode.workspace.getConfiguration("t3-vscode").get("messageNavigation")),
    modelPreferences: () => modelPreferences.read(),
    searchPreferences: context.workspaceState.get("sessionSearchPreferences", {}),
    saveSearchPreferences: (preferences) => context.workspaceState.update("sessionSearchPreferences", preferences),
    saveModelPreferences: (preferences) => modelPreferences.save(preferences) }, client);

  const registry = new WebviewRegistry();
  const showSettings = () => vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
  let provider: T3WebviewProvider;
  const meters = new UsageStatusBar(() => hostState!.snapshot(registry.focusedViewId), async (instanceId) => { await hostState?.refreshUsage(instanceId); }, () => hostState?.busy ?? false);
  const bridge = new BridgeHandler(hostState, registry, showSettings, undefined, registerNativeDiff(context), {
    openSessionTab: (threadId, preview) => provider.openSession(threadId, preview),
    keepTab: (id) => provider.keepTab(id),
    closeTaskTab: (id) => provider.closeTaskTab(id),
    openInTab: (id, draft) => provider.createPanel(id, draft),
    newChatTab: (id) => provider.createNewPanel(id),
    newWorktreeChat: (id, projectId, choice) => provider.createNewPanel(id, projectId, choice),
    editScheduledTask: (request, preview) => provider.editScheduledTask(request, preview),
    showUsage: (id, key) => provider.showUsage(key, id), configureUsage: () => meters.configure(),
  });
  provider = new T3WebviewProvider(context.extensionUri, registry, bridge, hostState, context.workspaceState);
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
    vscode.window.registerCustomEditorProvider("t3.session", provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
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
    // Refreshes every provider's figures now, rather than waiting for the interval or a connect.
    vscode.commands.registerCommand("t3-vscode.refreshUsage", async () => {
      if (!hostState) { await vscode.window.showInformationMessage("T3 VSCode is not connected yet."); return; }
      try { await hostState.refreshUsage(); }
      catch (cause) { await vscode.window.showWarningMessage(`Could not refresh usage: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }),
    vscode.commands.registerCommand("t3-vscode.configureUsage", () => meters.configure()),
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
      if (event.affectsConfiguration("t3-vscode.dateFormat") || event.affectsConfiguration("t3-vscode.timeFormat") || event.affectsConfiguration("t3-vscode.messageNavigation") || FONT_SIZE_KEYS.some((key) => event.affectsConfiguration(`t3-vscode.${key}`))) hostState?.refreshAppearance();
      if (event.affectsConfiguration("t3-vscode.usage") || event.affectsConfiguration("t3-vscode.refresh")) meters.update();
      if (event.affectsConfiguration("t3-vscode.refresh.defaultIntervalMinutes") || event.affectsConfiguration("t3-vscode.refresh.worktreeIntervalMinutes")) hostState?.refreshIntervalsChanged();
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

