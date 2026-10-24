/** Commands that pair, enable, disable and remove remote T3 environments. */
import * as vscode from "vscode";
import { EnvironmentCatalog, EnvironmentPairingError, pairRemoteEnvironment } from "./environmentCatalog.js";
import type { MultiEnvironmentClient } from "./multiEnvironmentClient.js";
import { environmentDisplayStatus } from "../shared/environmentStatus.js";

const stateLabel = { connecting: "Connecting…", connected: "Connected", error: "Reconnecting…", expired: "Expired", disabled: "Disabled" } as const;

export function registerEnvironmentCommands(input: {
  readonly catalog: EnvironmentCatalog; readonly client: MultiEnvironmentClient; readonly localEnvironmentId: () => string | undefined;
}): { readonly environmentAction: (action: string, environmentId?: string) => Promise<void>; readonly clearRecoveredIgnores: () => void; readonly disposables: vscode.Disposable[] } {
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
  const removeEnvironment = async (environmentId: string) => {
    const record = (await catalog.list()).find((entry) => entry.environmentId === environmentId);
    if (!record) return;
    const confirmed = await vscode.window.showWarningMessage(`Remove ${record.label}?`, {
      modal: true, detail: "Its sessions disappear from every VS Code profile on this machine. Revoke the client in T3 Code on that machine to invalidate the pairing there.",
    }, "Remove");
    if (confirmed === "Remove") await catalog.remove(record.environmentId);
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
    else if (action === "Reconnect") client.reconnectRemote(record.environmentId);
    else if (action === "Remove") await removeEnvironment(record.environmentId);
  };
  /** Buttons in the sidebar's Environments section. */
  const environmentAction = async (action: string, environmentId?: string): Promise<void> => {
    if (action === "add" || action === "pairAgain") { await addEnvironment(); return; }
    if (!environmentId) throw new Error("Choose a machine first.");
    if (action === "enable" || action === "disable") await catalog.setEnabled(environmentId, action === "enable");
    else if (action === "reconnect") client.reconnectRemote(environmentId);
    else if (action === "remove") await removeEnvironment(environmentId);
    else if (action === "ignore") {
      // Only the problem showing now is ignored; a different one later still counts.
      const status = client.remoteStatuses().find((entry) => entry.environmentId === environmentId);
      const shown = status ? environmentDisplayStatus(status, Date.now()) : undefined;
      if (shown !== "reconnecting" && shown !== "expiring" && shown !== "expired") throw new Error("This machine has nothing to ignore.");
      await catalog.setIgnored(environmentId, shown);
    } else throw new Error("Unknown environment action.");
  };
  // A machine that revoked this computer is removed from every profile, with a way back.
  client.onRemoteRevoked = (record) => {
    void catalog.removeIfToken(record.environmentId, record.accessToken).then(async (removed) => {
      if (!removed) return; // Already re-paired elsewhere.
      const choice = await vscode.window.showWarningMessage(`T3 VSCode: ${record.label} revoked this computer's access and was removed.`, "Pair again");
      if (choice === "Pair again") await addEnvironment();
    }).catch(() => undefined);
  };
  /** An ignored outage ends when this window sees its machine come back, so a later failure counts again. */
  const previousStates = new Map<string, string>();
  const clearRecoveredIgnores = () => {
    for (const status of client.remoteStatuses()) {
      // A retry passes through "connecting"; only the last settled state tells whether the machine recovered.
      if (status.state === "connecting") continue;
      const recovered = previousStates.get(status.environmentId) === "error" && status.state === "connected";
      previousStates.set(status.environmentId, status.state);
      if (recovered && status.ignoredStatus === "reconnecting") void catalog.setIgnored(status.environmentId, null).catch(() => undefined);
    }
  };
  return { environmentAction, clearRecoveredIgnores, disposables: [
    vscode.commands.registerCommand("t3-vscode.addEnvironment", addEnvironment),
    vscode.commands.registerCommand("t3-vscode.manageEnvironments", manageEnvironments),
  ] };
}
