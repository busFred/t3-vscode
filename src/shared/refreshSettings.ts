/** Shared refresh preferences are expressed in minutes; zero disables only periodic refresh. */
export const DEFAULT_REFRESH_INTERVAL_MINUTES = 10;
/** Larger Node timeout delays overflow to one millisecond. */
export const MAX_REFRESH_TIMEOUT_MS = 2 ** 31 - 1;

export interface RefreshSettingsInput {
  readonly defaultIntervalMinutes?: unknown;
  readonly usageIntervalMinutes?: unknown;
  readonly worktreeIntervalMinutes?: unknown;
  /** Only explicitly configured legacy values belong here, never the configuration schema default. */
  readonly legacyUsageIntervalSeconds?: unknown;
}

export interface RefreshSettings {
  readonly defaultIntervalMinutes: number;
  readonly usageIntervalMinutes: number;
  readonly worktreeIntervalMinutes: number;
}

/** VS Code inspection distinguishes saved preferences from the schema's legacy default. */
export function explicitLegacyUsageSeconds(inspection: {
  readonly defaultValue?: unknown;
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
} | undefined): unknown {
  return inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue;
}

function validInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function resolveRefreshSettings(input: RefreshSettingsInput = {}): RefreshSettings {
  const defaultIntervalMinutes = validInterval(input.defaultIntervalMinutes) ? input.defaultIntervalMinutes : DEFAULT_REFRESH_INTERVAL_MINUTES;
  // The former usage setting had a fifteen-second minimum. Preserve that behavior only for legacy overrides.
  const legacyUsageMinutes = validInterval(input.legacyUsageIntervalSeconds)
    ? (input.legacyUsageIntervalSeconds === 0 ? 0 : Math.max(15, input.legacyUsageIntervalSeconds) / 60)
    : defaultIntervalMinutes;
  return {
    defaultIntervalMinutes,
    usageIntervalMinutes: validInterval(input.usageIntervalMinutes) ? input.usageIntervalMinutes : legacyUsageMinutes,
    worktreeIntervalMinutes: validInterval(input.worktreeIntervalMinutes) ? input.worktreeIntervalMinutes : defaultIntervalMinutes,
  };
}

/** Convert resolved minutes to a safe timer interval without discarding fractional minutes. */
export function refreshIntervalMs(minutes: number): number | null {
  return minutes === 0 ? null : Math.min(MAX_REFRESH_TIMEOUT_MS, minutes * 60_000);
}
