/** Commands that pair, enable, disable and remove remote T3 environments. */
import * as vscode from "vscode";
import { EnvironmentCatalog, EnvironmentPairingError, pairRemoteEnvironment } from "./environmentCatalog.js";
import type { MultiEnvironmentClient } from "./multiEnvironmentClient.js";

const stateLabel = { connecting: "Connecting…", connected: "Connected", error: "Disconnected", disabled: "Disabled" } as const;

export function registerEnvironmentCommands(input: {
  readonly catalog: EnvironmentCatalog; readonly client: MultiEnvironmentClient; readonly localEnvironmentId: () => string | undefined;
}): vscode.Disposable[] {
  const { catalog, client } = input;
  const addEnvironment = async () => {
    const link = await vscode.window.showInputBox({
      title: "Add T3 Environment",
      prompt: "Paste a pairing link created with \"Create link\" in T3 Code on the other machine.",
      placeHolder: "https://machine.tailnet.ts.net/pair#token=…", password: true, ignoreFocusOut: true,
    });
    if (!link?.trim()) return;
    try {
      const record = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Pairing with T3 environment…" },
        () => pairRemoteEnvironment(link.trim(), { ...(input.localEnvironmentId() ? { localEnvironmentId: input.localEnvironmentId()! } : {}) }));
      await catalog.upsert(record);
      void vscode.window.showInformationMessage(`T3 VSCode: paired with ${record.label}. Its sessions for this repository appear in Sessions.`);
    } catch (cause) {
      void vscode.window.showErrorMessage(`T3 VSCode: ${cause instanceof EnvironmentPairingError ? cause.message : "Pairing failed. Create a new link and try again."}`);
    }
  };
  const manageEnvironments = async () => {
    const records = await catalog.list();
    const statuses = new Map(client.remoteStatuses().map((status) => [status.environmentId, status] as const));
    type Item = vscode.QuickPickItem & { readonly environmentId?: string };
    const items: Item[] = [
      ...records.map((record): Item => {
        const status = statuses.get(record.environmentId);
        return { label: record.label, environmentId: record.environmentId, description: new URL(record.httpBaseUrl).host,
          detail: record.enabled ? `${stateLabel[status?.state ?? "connecting"]}${status?.error ? ` — ${status.error}` : ""}` : stateLabel.disabled };
      }),
      { label: "$(add) Add environment…" },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: "T3 Environments", placeHolder: records.length ? "Choose an environment" : "No paired environments" });
    if (!picked) return;
    if (!picked.environmentId) { await addEnvironment(); return; }
    const record = records.find((entry) => entry.environmentId === picked.environmentId);
    if (!record) return;
    const actions = [record.enabled ? "Disable" : "Enable", ...(record.enabled ? ["Reconnect"] : []), "Remove"];
    const action = await vscode.window.showQuickPick(actions, { title: record.label });
    if (action === "Enable" || action === "Disable") await catalog.setEnabled(record.environmentId, action === "Enable");
    else if (action === "Reconnect") client.reconnectRemotes();
    else if (action === "Remove") {
      const confirmed = await vscode.window.showWarningMessage(`Remove ${record.label}?`, {
        modal: true, detail: "Its sessions disappear from every VS Code profile on this machine. Revoke the client in T3 Code on that machine to invalidate the pairing there.",
      }, "Remove");
      if (confirmed === "Remove") await catalog.remove(record.environmentId);
    }
  };
  return [
    vscode.commands.registerCommand("t3-vscode.addEnvironment", addEnvironment),
    vscode.commands.registerCommand("t3-vscode.manageEnvironments", manageEnvironments),
  ];
}
