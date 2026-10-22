import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

export interface ContextUsageSnapshot {
  readonly usedTokens: number;
  readonly maxTokens: number;
  readonly cachedInputTokens?: number;
  readonly updatedAt: string;
}
export type ContextUsageBand = "low" | "warning" | "error";

const WARNING_PERCENT = 55;
const ERROR_PERCENT = 85;

/**
 * Latest provider-reported usage for the thread, or null when none is known yet.
 *
 * Only a turn with a `maxTokens` ceiling can show a ring (#8144); turns the provider never sized stay excluded
 * rather than rendering a meter with no scale. Ties fall back to array order, matching the lack of a stronger
 * signal when two turns report the same instant.
 */
export function latestContextUsage(projection: OrchestrationV2ThreadProjection | null | undefined): ContextUsageSnapshot | null {
  if (!projection) return null;
  let latest: ContextUsageSnapshot | null = null;
  for (const turn of projection.providerTurns) {
    const usage = turn.tokenUsage;
    if (!usage || !usage.maxTokens) continue;
    if (latest && usage.updatedAt < latest.updatedAt) continue;
    latest = { usedTokens: usage.usedTokens, maxTokens: usage.maxTokens, updatedAt: usage.updatedAt,
      ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }) };
  }
  return latest;
}

export function contextUsagePercent(usage: Pick<ContextUsageSnapshot, "usedTokens" | "maxTokens">): number {
  if (usage.maxTokens <= 0) return 0;
  return Math.min(100, Math.round((usage.usedTokens / usage.maxTokens) * 100));
}

export function contextUsageBand(percent: number): ContextUsageBand {
  if (percent >= ERROR_PERCENT) return "error";
  if (percent >= WARNING_PERCENT) return "warning";
  return "low";
}

/** `124k`, `1.2M`, or the raw count under 1000; mirrors the T3 web app's context-window formatting. */
export function formatContextUsageTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`;
  // Rounding to the nearest thousand can itself reach 1000k (e.g. 999_999), which belongs in the M branch.
  const thousands = Math.round(value / 1_000);
  if (thousands < 1_000) return `${thousands}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function contextUsageTooltip(usage: ContextUsageSnapshot, percent = contextUsagePercent(usage)): string {
  const base = `Context window: ${formatContextUsageTokens(usage.usedTokens)} / ${formatContextUsageTokens(usage.maxTokens)} tokens (${percent}%)`;
  return usage.cachedInputTokens === undefined ? base : `${base} · ${formatContextUsageTokens(usage.cachedInputTokens)} cached`;
}
