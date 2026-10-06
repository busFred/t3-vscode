import * as vscode from "vscode";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import type { HostStateSnapshot } from "../shared/bridge.js";
import { accountWindows, meterLabels, meterText, selectedUsageAccounts, usageAccounts, type UsageAccount } from "../shared/usage.js";

export class UsageStatusBar implements vscode.Disposable {
  private readonly items = new Map<string, vscode.StatusBarItem>();
  private readonly configureItem = vscode.window.createStatusBarItem("t3-vscode.configureUsage", vscode.StatusBarAlignment.Right, 19);
  private readonly state: () => HostStateSnapshot;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(state: () => HostStateSnapshot) {
    this.state = state;
    this.configureItem.name = "T3 VSCode usage meters";
    this.configureItem.text = "$(ellipsis)";
    this.configureItem.tooltip = "T3 VSCode: choose provider accounts for the status bar";
    this.configureItem.command = "t3-vscode.configureUsage";
    this.timer = setInterval(() => this.update(), 60_000);
  }
  update(): void {
    const state = this.state();
    const config = vscode.workspace.getConfiguration("t3-vscode");
    const accounts = usageAccounts(state);
    const instanceId = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
    const selected = state.phase === "ready" ? selectedUsageAccounts(accounts, {
      followActive: config.get<boolean>("usage.followActiveConversation", true), pinnedAccounts: config.get<ReadonlyArray<string>>("usage.pinnedAccounts", []),
    }, instanceId) : [];
    const keys = new Set(selected.map((account) => account.key));
    for (const [key, item] of this.items) if (!keys.has(key)) { item.dispose(); this.items.delete(key); }
    selected.forEach((account, index) => {
      let item = this.items.get(account.key);
      if (!item) { item = vscode.window.createStatusBarItem(`t3-vscode.usage.${account.key}`, vscode.StatusBarAlignment.Right, 100 - index); this.items.set(account.key, item); }
      const siblings = selected.filter((other) => other.brand === account.brand);
      const alias = siblings.length > 1 ? ` ${siblings.indexOf(account) + 1}` : "";
      item.name = `T3 VSCode · ${account.label}`;
      item.text = `$(t3-vscode-${account.brand})${alias} ${meterText(account)}`;
      item.tooltip = this.tooltip(account);
      item.command = { command: "t3-vscode.showUsage", title: "Usage", arguments: [account.key] };
      item.accessibilityInformation = { label: `${account.label} remaining usage. Month, week, session: ${meterText(account)}. Open limits.` };
      item.show();
    });
    if (state.phase === "ready") this.configureItem.show(); else this.configureItem.hide();
  }
  private tooltip(account: UsageAccount): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString("", true);
    tooltip.appendText(account.label + (account.email && account.email !== account.label ? ` · ${account.email}` : "") + "\n\n");
    tooltip.appendMarkdown("| Window | Remaining | Reset |\n| :-- | --: | :-- |\n");
    accountWindows(account).forEach((window, index) => {
      tooltip.appendMarkdown(`| ${meterLabels[index]} | ${window ? `${remainingPercent(window)}%` : "—"} | ${window ? formatResetsIn(window, Date.now()) ?? "Not reported" : "Not reported"} |\n`);
    });
    if (account.limits.unavailable?.message) tooltip.appendText(`\n${account.limits.unavailable.message}\n`);
    tooltip.appendText("\nClick for account limits. Use ⋯ to customize meters.");
    return tooltip;
  }
  async configure(): Promise<void> {
    const state = this.state();
    const accounts = usageAccounts(state);
    const config = vscode.workspace.getConfiguration("t3-vscode");
    const pinned = new Set(config.get<ReadonlyArray<string>>("usage.pinnedAccounts", []));
    const choices = [{ label: "$(arrow-swap) Follow the active conversation", description: "Use the provider of the focused chat", picked: config.get<boolean>("usage.followActiveConversation", true), key: "follow" }, ...accounts.map((account) => ({
      label: `$(t3-vscode-${account.brand}) ${account.label}`, description: account.email || account.plan || account.sourceLabel || account.driver,
      detail: `Month | Week | Session remaining: ${meterText(account)}`, picked: pinned.has(account.key), key: account.key,
    }))];
    const selected = await vscode.window.showQuickPick(choices, { canPickMany: true, title: "T3 VSCode: Configure Status Meters", placeHolder: "Follow the active conversation and/or pin individual accounts", matchOnDescription: true });
    if (!selected) return;
    await config.update("usage.followActiveConversation", selected.some((item) => item.key === "follow"), vscode.ConfigurationTarget.Global);
    await config.update("usage.pinnedAccounts", selected.filter((item) => item.key !== "follow").map((item) => item.key), vscode.ConfigurationTarget.Global);
    this.update();
  }
  dispose(): void { clearInterval(this.timer); this.configureItem.dispose(); for (const item of this.items.values()) item.dispose(); this.items.clear(); }
}
