import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { collectLimitAccounts, remainingPercent, type LimitAccount, type LimitPresentations } from "@t3tools/shared/usageLimits";
import type { HostStateSnapshot } from "./bridge.js";

export type ProviderBrand = "codex" | "claude" | "kimi" | "other";
export function providerBrand(driver: string, name = ""): ProviderBrand {
  const label = `${driver} ${name}`.toLowerCase();
  return /codex|openai/.test(label) ? "codex" : /claude|anthropic/.test(label) ? "claude" : /kimi/.test(label) ? "kimi" : "other";
}
export interface UsageAccount extends LimitAccount {
  readonly instanceIds: ReadonlyArray<string>;
  readonly label: string;
  readonly brand: ProviderBrand;
}
export function limitPresentations(state: HostStateSnapshot): LimitPresentations {
  return state.environment ? new Map([[state.environment.environmentId as EnvironmentId, {
    entry: { target: { label: state.environment.label } },
    serverConfig: { providers: state.providers, usageLimitSources: state.usageLimitSources },
  }]]) : new Map();
}
const identity = (driver: string, email: string | undefined, fingerprint: string | undefined, fallback: string) =>
  email?.trim() ? `${driver}:email:${email.trim().toLowerCase()}` : fingerprint ? `${driver}:credential:${fingerprint}` : fallback;
const providerKey = (provider: ServerProvider, environmentId: string) => identity(provider.driver, provider.auth?.email, provider.usageLimits?.credentialFingerprint, `${environmentId}:${provider.instanceId}`);

/** Keep accounts separate, deduplicate shared credentials, and retain unavailable providers as “—”. */
export function usageAccounts(state: HostStateSnapshot): ReadonlyArray<UsageAccount> {
  if (!state.environment) return [];
  const environmentId = state.environment.environmentId;
  const accounts = new Map<string, UsageAccount>();
  for (const account of collectLimitAccounts(limitPresentations(state))) {
    const key = identity(account.driver, account.email, account.limits.credentialFingerprint, account.key);
    const providers = state.providers.filter((provider) => providerKey(provider, environmentId) === key);
    accounts.set(key, { ...account, key, instanceIds: providers.map((provider) => provider.instanceId),
      label: account.displayName || account.email || account.sourceLabel || account.driver,
      brand: providerBrand(account.driver, account.displayName ?? "") });
  }
  for (const provider of state.providers.filter((provider) => provider.enabled && provider.installed)) {
    const key = providerKey(provider, environmentId);
    if (accounts.has(key)) continue;
    accounts.set(key, { key, driver: provider.driver, displayName: provider.displayName || null, email: provider.auth?.email,
      plan: provider.auth?.label, accentColor: provider.accentColor, sourceLabel: null, redeem: null,
      environments: [{ environmentId: environmentId as EnvironmentId, label: state.environment.label }],
      limits: provider.usageLimits ?? { checkedAt: provider.checkedAt, windows: [] },
      instanceIds: state.providers.filter((candidate) => providerKey(candidate, environmentId) === key).map((candidate) => candidate.instanceId),
      label: provider.displayName || provider.instanceId, brand: providerBrand(provider.driver, provider.displayName) });
  }
  return [...accounts.values()];
}
export interface MeterRow { readonly window: UsageWindow | null; readonly label: string; readonly short: string; readonly primary: boolean }
type UsageWindow = LimitAccount["limits"]["windows"][number];
const primaryRows = [{ kind: "session", label: "Session", short: "S" }, { kind: "weekly", label: "Week", short: "W" }, { kind: "monthly", label: "Month", short: "M" }] as const;
// Providers name the general weekly allowance differently; anything else weekly is a model-specific quota (e.g. Claude Opus or Fable).
const generalWeekly = (window: UsageWindow) => /^(weekly|seven_day|primary|secondary)$/i.test(window.id) || /^(weekly|week)$/i.test(window.label);
const rank = (window: UsageWindow) => window.kind === "session" ? 0 : window.kind === "weekly" ? (generalWeekly(window) ? 1 : 2) : window.kind === "monthly" ? 3 : 4;
/**
 * Rows shortest to longest: session, week, model-specific weeks, month, then anything else.
 * A specialised model quota (e.g. Claude Opus) never replaces the general quota of its kind.
 * Only reported windows are listed; when none are, the three standard rows remain as “not reported” placeholders.
 */
export function accountWindows(account: UsageAccount): ReadonlyArray<MeterRow> {
  const reported = account.limits.unavailable ? [] : account.limits.windows.map((window, index) => ({ window, index })).sort((left, right) => rank(left.window) - rank(right.window) || left.index - right.index);
  if (!reported.length) return primaryRows.map((row) => ({ window: null, label: row.label, short: row.short, primary: true }));
  const seen = new Set<string>();
  // An account reporting only model-specific weeks still needs a general Week, so the first one stands in for it.
  const standIn = reported.some(({ window }) => window.kind === "weekly" && generalWeekly(window)) ? undefined : reported.find(({ window }) => window.kind === "weekly")?.window;
  return reported.map(({ window }) => {
    const row = primaryRows.find((candidate) => candidate.kind === window.kind);
    const primary = row !== undefined && (window.kind !== "weekly" || generalWeekly(window) || window === standIn) && !seen.has(row.kind);
    if (primary) seen.add(row.kind);
    return { window, label: primary ? row.label : window.label, short: primary ? row.short : window.label, primary };
  });
}
export function meterText(account: UsageAccount): string {
  const reported = accountWindows(account).filter((row) => row.window && row.primary);
  if (!reported.length) return "Usage unavailable";
  return reported.map((row) => `${reported.length === 1 ? row.label : row.short} ${remainingPercent(row.window!)}%`).join(" · ");
}
export interface MeterPreferences { readonly followActive: boolean; readonly pinnedAccounts: ReadonlyArray<string> }
export function selectedUsageAccounts(accounts: ReadonlyArray<UsageAccount>, preferences: MeterPreferences, instanceId?: string): ReadonlyArray<UsageAccount> {
  const active = preferences.followActive ? accounts.find((account) => account.instanceIds.includes(instanceId ?? "")) : undefined;
  const keys = new Set([...(active ? [active.key] : []), ...preferences.pinnedAccounts]);
  return [...keys].flatMap((key) => { const account = accounts.find((account) => account.key === key); return account ? [account] : []; });
}

/**
 * Provider instance a background usage refresh should target, or `undefined` to refresh every instance.
 *
 * A targeted refresh only updates the instance it names, so it is safe only while a single meter is displayed.
 * With several meters shown, pinned accounts for other providers would otherwise never advance, so sweep instead.
 */
export function usageRefreshTarget(selected: ReadonlyArray<UsageAccount>, providers: ReadonlyArray<ServerProvider>, instanceId?: string): string | undefined {
  if (selected.length !== 1) return undefined;
  const account = selected[0]!;
  if (instanceId && account.instanceIds.includes(instanceId)) return instanceId;
  // A disabled or uninstalled instance never reports a fresh read, which would leave the meter pinned to an older one.
  const live = account.instanceIds.find((id) => providers.some((provider) => provider.instanceId === id && provider.enabled && provider.installed));
  return live ?? account.instanceIds[0];
}
