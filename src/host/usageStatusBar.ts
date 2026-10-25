import * as vscode from "vscode";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import type { HostStateSnapshot } from "../shared/bridge.js";
import { explicitLegacyUsageSeconds, resolveRefreshSettings, type RefreshSettings } from "../shared/refreshSettings.js";
import { UsageRefreshScheduler } from "../shared/usageRefresh.js";
import { accountWindows, groupTitle, usageNotices, meterText, pooledAccount, resolveAccountsDisplay, resolveMeterWindows, selectedUsageAccounts, soonestReset, usageGroups, usageRefreshTarget, type MeterWindow, type UsageAccount, type UsageGroup } from "../shared/usage.js";

/** Read explicit legacy values separately so its schema default cannot mask the shared default. */
export function readRefreshSettings(): RefreshSettings {
  const config = vscode.workspace.getConfiguration("t3-vscode");
  const legacy = config.inspect<number>("usage.refreshIntervalSeconds");
  return resolveRefreshSettings({
    defaultIntervalMinutes: config.get("refresh.defaultIntervalMinutes"),
    usageIntervalMinutes: config.get("refresh.usageIntervalMinutes"),
    worktreeIntervalMinutes: config.get("refresh.worktreeIntervalMinutes"),
    legacyUsageIntervalSeconds: explicitLegacyUsageSeconds(legacy),
  });
}

export class UsageStatusBar implements vscode.Disposable {
  private readonly items = new Map<string, vscode.StatusBarItem>();
  private readonly state: () => HostStateSnapshot;
  private readonly busy: () => boolean;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly refresher: UsageRefreshScheduler;
  /** Provider instance a background refresh should target, or undefined to sweep every instance. */
  private target: string | undefined;
  constructor(state: () => HostStateSnapshot, refresh: (instanceId?: string) => Promise<void>, busy: () => boolean = () => false) {
    this.state = state;
    this.busy = busy;
    this.timer = setInterval(() => this.update(), 60_000);
    this.refresher = new UsageRefreshScheduler(() => refresh(this.target));
  }
  update(): void {
    const state = this.state();
    const config = vscode.workspace.getConfiguration("t3-vscode");
    this.refresher.configureMinutes(readRefreshSettings().usageIntervalMinutes);
    const instanceId = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
    const meters = state.phase === "ready" ? this.meters(state, config, instanceId) : [];
    const windows = resolveMeterWindows(config.get("usage.statusBarWindows"));
    const members = [...new Map(meters.flatMap((meter) => meter.members).map((account) => [account.key, account])).values()];
    this.target = usageRefreshTarget(members, state.providers, instanceId);
    this.refresher.setDisplayed(meters.length > 0);
    this.refresher.setBusy(this.busy());
    this.refresher.setReady(state.phase === "ready");
    // A pooled meter keeps its provider's id as accounts come and go, so VS Code keeps its position and visibility.
    const keys = new Set(meters.map((meter) => meter.group?.key ?? meter.account.key));
    for (const [key, item] of this.items) if (!keys.has(key)) { item.dispose(); this.items.delete(key); }
    meters.forEach(({ account, group }, index) => {
      const key = group?.key ?? account.key;
      let item = this.items.get(key);
      if (!item) { item = vscode.window.createStatusBarItem(`t3-vscode.usage.${key}`, vscode.StatusBarAlignment.Right, 100 - index); this.items.set(key, item); }
      const siblings = meters.filter((other) => other.account.brand === account.brand);
      const alias = siblings.length > 1 ? ` ${siblings.findIndex((other) => other.account === account) + 1}` : "";
      const text = meterText(account, windows);
      item.name = `T3 VSCode · ${group ? groupTitle(group) : account.label}`;
      item.text = `$(t3-vscode-${account.brand})${alias} ${text}`;
      item.tooltip = this.tooltip(account, group, windows, usageNotices(state, account.driver));
      item.command = { command: "t3-vscode.showUsage", title: "Usage", arguments: [key] };
      item.accessibilityInformation = { label: `${group ? groupTitle(group) : account.label} remaining usage: ${text}. Open Account & Usage.` };
      item.show();
    });
  }
  /**
   * Pooled: one meter per provider, for the active conversation's provider and every pinned one.
   * Per account: one meter per chosen account, as before pooling existed.
   */
  private meters(state: HostStateSnapshot, config: vscode.WorkspaceConfiguration, instanceId: string | undefined): ReadonlyArray<{ readonly account: UsageAccount; readonly group?: UsageGroup; readonly members: ReadonlyArray<UsageAccount> }> {
    const groups = usageGroups(state);
    const followActive = config.get<boolean>("usage.followActiveConversation", true);
    const pinnedAccounts = config.get<ReadonlyArray<string>>("usage.pinnedAccounts", []);
    if (resolveAccountsDisplay(config.get("usage.statusBarAccounts")) === "perAccount") {
      return selectedUsageAccounts(groups.flatMap((group) => group.accounts), { followActive, pinnedAccounts }, instanceId).map((account) => ({ account, members: [account] }));
    }
    const pinnedProviders = config.get<ReadonlyArray<string>>("usage.pinnedProviders", []);
    const active = followActive ? groups.find((group) => group.accounts.some((account) => account.instanceIds.includes(instanceId ?? ""))) : undefined;
    // Accounts pinned before pooling still pin their provider.
    const pinned = groups.filter((group) => pinnedProviders.includes(group.driver) || group.accounts.some((account) => pinnedAccounts.includes(account.key)));
    return [...new Set([...(active ? [active] : []), ...pinned])].map((group) => ({ account: pooledAccount(group), group, members: group.accounts }));
  }
  private tooltip(account: UsageAccount, group: UsageGroup | undefined, windows: ReadonlyArray<MeterWindow>, notices: ReadonlyArray<string>): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString("", true);
    const pooled = group !== undefined && group.reporting.length > 1;
    tooltip.appendText((group ? groupTitle(group) : account.label + (account.email && account.email !== account.label ? ` · ${account.email}` : "")) + "\n\n");
    tooltip.appendMarkdown(`| Window | ${pooled ? "Average remaining" : "Remaining"} | Reset |\n| :-- | --: | :-- |\n`);
    accountWindows(account).forEach(({ window, label }) => {
      const first = pooled && window ? soonestReset(group, window) : undefined;
      const reset = window ? formatResetsIn(window, Date.now()) ?? "Not reported" : "Not reported";
      tooltip.appendMarkdown(`| ${label} | ${window ? `${remainingPercent(window)}%` : "—"} | ${reset}${first ? ` (${first.email || first.label})` : ""} |\n`);
    });
    if (pooled) for (const member of group.reporting) tooltip.appendText(`\n${member.email || member.label}: ${meterText(member, windows)}`);
    // Real failures keep their reason; API-key harnesses are already left out.
    for (const notice of notices) tooltip.appendText(`\n${notice}`);
    tooltip.appendText("\n\nPercentages show remaining allowance. Click for account limits. To customize meters, open the Command Palette and run T3 VSCode: Configure Status Meters.");
    return tooltip;
  }
  async configure(): Promise<void> {
    const groups = usageGroups(this.state());
    const config = vscode.workspace.getConfiguration("t3-vscode");
    const current = resolveAccountsDisplay(config.get("usage.statusBarAccounts"));
    const mode = await vscode.window.showQuickPick([
      { label: "$(layers) Pooled", description: "One meter per provider: average remaining, soonest reset", value: "pooled" as const },
      { label: "$(list-flat) Per account", description: "One meter for each account you choose", value: "perAccount" as const },
    ].map((item) => ({ ...item, ...(item.value === current ? { detail: "Current" } : {}) })), { title: "T3 VSCode: Configure Status Meters (1/2)", placeHolder: "How should providers with several accounts appear in the status bar?" });
    if (!mode) return;
    const pinnedAccounts = new Set(config.get<ReadonlyArray<string>>("usage.pinnedAccounts", []));
    const pinnedProviders = new Set(config.get<ReadonlyArray<string>>("usage.pinnedProviders", []));
    const windows = resolveMeterWindows(config.get("usage.statusBarWindows"));
    type Choice = vscode.QuickPickItem & { readonly key?: string; readonly kind?: vscode.QuickPickItemKind; readonly group?: "show" | "window" };
    const separator = (label: string): Choice => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const targets: Choice[] = mode.value === "pooled"
      ? groups.map((group) => ({ label: `$(t3-vscode-${group.brand}) ${group.label}`, description: groupTitle(group), detail: `Remaining: ${meterText(pooledAccount(group), windows)}`,
        picked: pinnedProviders.has(group.driver) || group.accounts.some((account) => pinnedAccounts.has(account.key)), key: group.driver, group: "show" }))
      : groups.flatMap((group) => group.accounts.map((account) => ({ label: `$(t3-vscode-${account.brand}) ${account.email || account.label}`, description: account.plan || account.sourceLabel || account.driver,
        detail: `Remaining: ${meterText(account, windows)}`, picked: pinnedAccounts.has(account.key), key: account.key, group: "show" as const })));
    const windowChoices: Choice[] = ([["session", "Session"], ["week", "Week"], ["modelWeeks", "Model weeks (Fable, Opus…)"], ["month", "Month"]] as const)
      .map(([key, label]) => ({ label, picked: windows.includes(key), key, group: "window" }));
    const selected = await vscode.window.showQuickPick<Choice>([
      separator("Show"), { label: "$(arrow-swap) Follow the active conversation", description: "Use the provider of the focused chat", picked: config.get<boolean>("usage.followActiveConversation", true), key: "follow" },
      ...targets, separator("Windows"), ...windowChoices,
    ], { canPickMany: true, title: "T3 VSCode: Configure Status Meters (2/2)", placeHolder: mode.value === "pooled" ? "Pin providers and choose windows" : "Pin accounts and choose windows", matchOnDescription: true });
    if (!selected) return;
    if (!selected.some((item) => item.group === "window")) { void vscode.window.showWarningMessage("Choose at least one usage window for the status bar."); return; }
    const shown = selected.filter((item) => item.group === "show").map((item) => item.key!);
    await config.update("usage.statusBarAccounts", mode.value, vscode.ConfigurationTarget.Global);
    await config.update("usage.followActiveConversation", selected.some((item) => item.key === "follow"), vscode.ConfigurationTarget.Global);
    if (mode.value === "pooled") {
      await config.update("usage.pinnedProviders", shown, vscode.ConfigurationTarget.Global);
      // Unpinning a provider must also release the accounts that pinned it before pooling.
      await config.update("usage.pinnedAccounts", [...pinnedAccounts].filter((key) => !groups.some((group) => !shown.includes(group.driver) && group.accounts.some((account) => account.key === key))), vscode.ConfigurationTarget.Global);
    } else await config.update("usage.pinnedAccounts", shown, vscode.ConfigurationTarget.Global);
    await config.update("usage.statusBarWindows", selected.filter((item) => item.group === "window").map((item) => item.key!), vscode.ConfigurationTarget.Global);
    this.update();
  }
  dispose(): void { clearInterval(this.timer); this.refresher.dispose(); for (const item of this.items.values()) item.dispose(); this.items.clear(); }
}
