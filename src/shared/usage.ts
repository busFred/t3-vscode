import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitNotices, collectLimitPools, remainingPercent, type LimitAccount, type LimitPoolWindow, type LimitPresentations } from "@t3tools/shared/usageLimits";
import type { HostStateSnapshot } from "./bridge.js";

export type ProviderBrand = "codex" | "claude" | "kimi" | "other";
export function providerBrand(driver: string, name = ""): ProviderBrand {
  const label = `${driver} ${name}`.toLowerCase();
  return /codex|openai/.test(label) ? "codex" : /claude|anthropic/.test(label) ? "claude" : /kimi/.test(label) ? "kimi" : "other";
}
export interface UsageAccount extends LimitAccount {
  readonly instanceIds: ReadonlyArray<string>;
  readonly legacyKey?: string | undefined;
  readonly workspaceId?: string | undefined;
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
const providerKey = (provider: ServerProvider, environmentId: string) => {
  const base = identity(provider.driver, provider.auth?.email, provider.usageLimits?.credentialFingerprint, `${environmentId}:${provider.instanceId}`);
  return provider.auth?.workspaceId ? `${base}:${provider.auth.workspaceId}` : base;
};
export const usageAccountName = (account: UsageAccount) => account.workspaceId && account.email ? `${account.email} · ${account.workspaceId}` : account.email || account.label;
/** A legacy pin intentionally matches every workspace for the same account. */
export const accountPinMatches = (account: UsageAccount, pin: string) => account.key === pin || account.legacyKey === pin;
/** Keep unseen pins; replace visible legacy pins with the selected workspace keys. */
export function updatedAccountPins(pins: ReadonlyArray<string>, accounts: ReadonlyArray<UsageAccount>, selected: ReadonlyArray<string>): string[] {
  return [...new Set([...pins.filter((pin) => {
    const matches = accounts.filter((account) => accountPinMatches(account, pin));
    return !matches.length || (matches.some((account) => account.legacyKey === pin) && matches.every((account) => selected.includes(account.key)));
  }), ...selected])];
}

/** Keep accounts separate, deduplicate shared credentials, and retain unavailable providers as “—”. */
export function usageAccounts(state: HostStateSnapshot): ReadonlyArray<UsageAccount> {
  if (!state.environment) return [];
  const environmentId = state.environment.environmentId;
  const accounts = new Map<string, UsageAccount>();
  const reports = [...state.providers.filter((provider) => provider.enabled).map((provider) => ({ driver: provider.driver, email: provider.auth.email, workspaceId: provider.auth.workspaceId, fingerprint: provider.usageLimits?.credentialFingerprint })),
    ...(state.usageLimitSources ?? []).flatMap((source) => source.accounts.map((account) => ({ driver: account.driver, email: account.email, workspaceId: account.workspaceId, fingerprint: account.usageLimits.credentialFingerprint })))];
  const resolvedProviderKey = (provider: ServerProvider) => {
    const key = providerKey(provider, environmentId);
    if (provider.auth.workspaceId) return key;
    const known = new Set(reports.filter((report) => identity(report.driver, report.email, report.fingerprint, "") === key && report.workspaceId).map((report) => report.workspaceId!));
    return known.size === 1 ? `${key}:${[...known][0]}` : key;
  };
  for (const account of collectLimitAccounts(limitPresentations(state))) {
    const base = identity(account.driver, account.email, account.limits.credentialFingerprint, account.key);
    const native = state.providers.find((provider) => `${environmentId}:${provider.instanceId}` === account.key);
    const source = (state.usageLimitSources ?? []).flatMap((source) => source.accounts.map((entry) => ({ key: `${source.id}:${entry.id}${entry.workspaceId ? `:${entry.workspaceId}` : ""}`, entry }))).find((entry) => entry.key === account.key)?.entry;
    const reportWorkspace = native?.auth.workspaceId ?? source?.workspaceId;
    const known = new Set(reports.filter((report) => identity(report.driver, report.email, report.fingerprint, "") === base && report.workspaceId).map((report) => report.workspaceId!));
    const workspaceId = reportWorkspace ?? (known.size === 1 ? [...known][0] : undefined);
    const key = workspaceId ? `${base}:${workspaceId}` : base;
    const providers = state.providers.filter((provider) => resolvedProviderKey(provider) === key);
    accounts.set(key, { ...account, key, workspaceId, legacyKey: workspaceId ? base : undefined, instanceIds: providers.map((provider) => provider.instanceId),
      label: `${account.displayName || account.email || account.sourceLabel || account.driver}${workspaceId ? ` · ${workspaceId}` : ""}`,
      brand: providerBrand(account.driver, account.displayName ?? "") });
  }
  for (const provider of state.providers.filter((provider) => provider.enabled && provider.installed)) {
    const key = resolvedProviderKey(provider);
    if (accounts.has(key)) continue;
    const workspaceId = provider.auth?.workspaceId;
    accounts.set(key, { key, workspaceId, legacyKey: workspaceId ? identity(provider.driver, provider.auth?.email, provider.usageLimits?.credentialFingerprint, key) : undefined, driver: provider.driver, displayName: provider.displayName || null, email: provider.auth?.email,
      plan: provider.auth?.label, accentColor: provider.accentColor, sourceLabel: null, redeem: null,
      environments: [{ environmentId: environmentId as EnvironmentId, label: state.environment.label }],
      limits: provider.usageLimits ?? { checkedAt: provider.checkedAt, windows: [] },
      instanceIds: state.providers.filter((candidate) => resolvedProviderKey(candidate) === key).map((candidate) => candidate.instanceId),
      label: `${provider.displayName || provider.instanceId}${workspaceId ? ` · ${workspaceId}` : ""}`, brand: providerBrand(provider.driver, provider.displayName) });
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
/** Windows a status meter may show; model weeks are the specialised weekly quotas such as Claude Fable. */
export type MeterWindow = "session" | "week" | "modelWeeks" | "month";
export const DEFAULT_METER_WINDOWS: ReadonlyArray<MeterWindow> = ["session", "week", "month"];
const meterWindow = (row: MeterRow): MeterWindow | undefined => !row.window ? undefined : !row.primary ? (row.window.kind === "weekly" ? "modelWeeks" : undefined)
  : row.window.kind === "session" ? "session" : row.window.kind === "weekly" ? "week" : row.window.kind === "monthly" ? "month" : undefined;
export function resolveMeterWindows(value: unknown): ReadonlyArray<MeterWindow> {
  if (!Array.isArray(value)) return DEFAULT_METER_WINDOWS;
  return (["session", "week", "modelWeeks", "month"] as const).filter((window) => value.includes(window));
}
export function meterText(account: UsageAccount, windows: ReadonlyArray<MeterWindow> = DEFAULT_METER_WINDOWS): string {
  // Windows no meter can show (kind "other") leave the account as unavailable rather than deselected.
  const all = accountWindows(account).filter((row) => meterWindow(row) !== undefined);
  if (!all.length) return "Usage unavailable";
  const reported = all.filter((row) => windows.includes(meterWindow(row)!));
  if (!reported.length) return "No selected window";
  return reported.map((row) => `${reported.length === 1 ? row.label : row.short} ${remainingPercent(row.window!)}%`).join(" · ");
}
export interface MeterPreferences { readonly followActive: boolean; readonly pinnedAccounts: ReadonlyArray<string> }
export function selectedUsageAccounts(accounts: ReadonlyArray<UsageAccount>, preferences: MeterPreferences, instanceId?: string): ReadonlyArray<UsageAccount> {
  const active = preferences.followActive ? accounts.find((account) => account.instanceIds.includes(instanceId ?? "")) : undefined;
  return [...new Set([...(active ? [active] : []), ...preferences.pinnedAccounts.flatMap((pin) => accounts.filter((account) => accountPinMatches(account, pin)))])];
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

/** How several accounts of one provider are shown: one averaged meter, or one bar per account. */
export type AccountsDisplay = "pooled" | "perAccount";
export const resolveAccountsDisplay = (value: unknown): AccountsDisplay => value === "perAccount" ? "perAccount" : "pooled";

/**
 * A harness that can never report subscription limits (API key) is “unavailable”, not failing.
 * Codex answers an API-key read with JSON-RPC -32600 on servers that predate its `unsupported` marking.
 */
export function apiKeyProvider(provider: ServerProvider): boolean {
  const message = provider.usageLimits?.unavailable?.reason === "probeFailed" ? provider.usageLimits.unavailable.message ?? "" : "";
  // Heuristic: only a Codex harness without a signed-in ChatGPT address, so a real invalid request still shows.
  const codexWithoutAccount = provider.driver === "codex" && !provider.auth?.email && /-32600\b/.test(message);
  return provider.auth?.type === "apiKey" || /\bapi key\b/i.test(provider.auth?.label ?? "") || codexWithoutAccount;
}

/** Hub failures and real probe failures for the panel; API-key harnesses stay silent. */
export function usageNotices(state: HostStateSnapshot, driver?: string): ReadonlyArray<string> {
  const providers = state.providers.filter((provider) => !apiKeyProvider(provider) && (driver === undefined || provider.driver === driver));
  return collectLimitNotices(limitPresentations({ ...state, providers }));
}

export interface UsageGroup {
  readonly key: string;
  readonly driver: string;
  readonly brand: ProviderBrand;
  readonly label: string;
  /** Accounts with reported windows, soonest session reset first; every per-account row keeps this order. */
  readonly reporting: ReadonlyArray<UsageAccount>;
  /** Every account, including API-key harnesses that report nothing. */
  readonly accounts: ReadonlyArray<UsageAccount>;
  /** `Claude Subscription ×3`, or the harness's own label when nothing reports. */
  readonly plan: string | undefined;
  /** Where the reporting accounts come from, such as a hub machine: `CLI Proxy`. */
  readonly source: string | undefined;
}
const BRAND_LABELS: Partial<Record<ProviderBrand, string>> = { claude: "Claude", codex: "Codex", kimi: "Kimi" };
const reports = (account: UsageAccount) => !account.limits.unavailable && account.limits.windows.length > 0;
export const groupKey = (driver: string) => `group:${driver}`;

/** One entry per provider: its native harness and every hub account, merged by T3's own account identity. */
export function usageGroups(state: HostStateSnapshot, now = Date.now()): ReadonlyArray<UsageGroup> {
  const byDriver = new Map<string, UsageAccount[]>();
  for (const account of usageAccounts(state)) byDriver.set(account.driver, [...byDriver.get(account.driver) ?? [], account]);
  return [...byDriver].map(([driver, accounts]) => {
    const reporting = (collectLimitPools(accounts.filter(reports), now)[0]?.accounts ?? []) as ReadonlyArray<UsageAccount>;
    const plans = [...new Set(reporting.flatMap((account) => account.plan ? [account.plan] : []))];
    const sources = [...new Set(reporting.flatMap((account) => account.sourceLabel ? [account.sourceLabel] : []))];
    const plan = reporting.length
      ? (plans.length === 1 && reporting.length > 1 ? `${plans[0]} ×${reporting.length}` : plans.join(", ")) || undefined
      : accounts.find((account) => account.plan)?.plan;
    const source = sources.join(", ") || undefined;
    const brand = accounts[0]!.brand;
    return { key: groupKey(driver), driver, brand, label: BRAND_LABELS[brand] ?? accounts[0]!.label, reporting, accounts, plan, source };
  });
}
export const groupOf = (groups: ReadonlyArray<UsageGroup>, key: string | undefined) =>
  key ? groups.find((group) => group.key === key || group.accounts.some((account) => account.key === key)) : undefined;

/** `Claude · (3)`, `Claude · me@example.com`, or just `Claude` when nothing reports. */
export function groupTitle(group: UsageGroup): string {
  if (group.reporting.length > 1) return `${group.label} · (${group.reporting.length})`;
  const only = group.reporting[0];
  return only ? `${group.label} · ${only.email || only.label}` : group.label;
}

/** The general 7-day window is used up: the account is locked out until it resets, whatever its other windows say. */
const weeklyExhausted = (account: UsageAccount) => account.limits.windows.some((window) => window.kind === "weekly" && generalWeekly(window) && remainingPercent(window) <= 0);
/**
 * The windows to pool across the group. An account whose general weekly window is exhausted cannot be used until
 * that resets, so its other windows (session, model-specific weeks, month) are left out; its weekly window still counts.
 * A window that only exhausted accounts report keeps all of them, so no meter disappears.
 */
function pooledWindows(group: UsageGroup, now: number): ReadonlyArray<LimitPoolWindow> {
  const [all] = collectLimitPools(group.reporting, now);
  if (!all || !group.reporting.some(weeklyExhausted)) return all?.windows ?? [];
  const usable = group.reporting.map((account) => weeklyExhausted(account)
    ? { ...account, limits: { ...account.limits, windows: account.limits.windows.filter((window) => window.kind === "weekly" && generalWeekly(window)) } } : account);
  const [filtered] = collectLimitPools(usable, now);
  const lockedOut = new Set(group.reporting.filter(weeklyExhausted).map((account) => account.key));
  return all.windows.map((window) => {
    const usableWindow = filtered?.windows.find((candidate) => candidate.kind === window.kind && candidate.id === window.id);
    if (!usableWindow) return window;
    // A model-specific week (Fable, ...) is averaged over the usable accounts, but it is next usable again when the
    // locked-out accounts' same window resets, so that earliest reset is the one shown.
    const returning = window.kind === "weekly" && !generalWeekly(window) ? window.resets.find((reset) => lockedOut.has(reset.member.account.key)) : undefined;
    return returning ? { ...usableWindow, resets: [returning, ...usableWindow.resets] } : usableWindow;
  });
}

/**
 * The group as one account: each window's average share used across the reporting accounts, resetting when
 * the soonest of them does. A single reporting account is returned as is; none leaves the harness placeholder.
 */
export function pooledAccount(group: UsageGroup, now = Date.now()): UsageAccount {
  if (group.reporting.length <= 1) return group.reporting[0] ?? group.accounts[0]!;
  const checkedAt = group.reporting.map((account) => account.limits.checkedAt).sort().at(-1)!;
  const windows = pooledWindows(group, now).map((window) => ({ ...(window.resets[0]?.member.window ?? window.members[0]!.window), id: window.id, kind: window.kind, label: window.label, usedPercent: window.usedPercent }));
  return { ...group.reporting[0]!, key: group.key, label: group.label, email: undefined, plan: group.plan, sourceLabel: null,
    instanceIds: group.accounts.flatMap((account) => account.instanceIds), limits: { checkedAt, windows } };
}
/** The reporting account whose window resets first, to name it on hover. */
export function soonestReset(group: UsageGroup, window: UsageWindow, now = Date.now()): UsageAccount | undefined {
  const pool = pooledWindows(group, now).find((candidate) => candidate.kind === window.kind && candidate.id === window.id);
  const key = pool?.resets[0]?.member.account.key;
  return group.reporting.find((account) => account.key === key);
}

export interface AccountRow extends MeterRow { readonly columns: ReadonlyArray<{ readonly account: UsageAccount; readonly window: UsageWindow | null }> }
/** Per-account rows: the pooled row order, one slot per reporting account in the group's fixed order. */
export function perAccountRows(group: UsageGroup, now = Date.now()): ReadonlyArray<AccountRow> {
  return accountWindows(pooledAccount(group, now)).map((row) => ({ ...row, columns: group.reporting.map((account) => ({ account,
    window: row.window ? account.limits.windows.find((window) => window.kind === row.window!.kind && window.id === row.window!.id) ?? null : null })) }));
}
