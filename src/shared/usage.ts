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
export const meterKinds = ["monthly", "weekly", "session"] as const;
export const meterLabels = ["Month", "Week", "Session"] as const;
export function accountWindows(account: UsageAccount) {
  // A specialised model quota (e.g. Claude Opus) must not replace the general weekly quota.
  return meterKinds.map((kind) => account.limits.unavailable ? null : account.limits.windows.find((window) => window.kind === kind) ?? null);
}
export function meterText(account: UsageAccount): string {
  const reported = accountWindows(account).flatMap((window, index) => window ? [{ window, index }] : []);
  if (!reported.length) return "Usage unavailable";
  return reported.map(({ window, index }) => `${reported.length === 1 ? meterLabels[index] : ["M", "W", "S"][index]} ${remainingPercent(window)}%`).join(" · ");
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
