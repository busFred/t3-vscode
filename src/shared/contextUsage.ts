import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { deriveLatestContextWindowSnapshot, latestProviderTurnTokenUsage } from "@t3tools/client-runtime/state/context-window";

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
 * Delegates to T3's own derivation (`client-runtime/state/context-window`) rather than re-deriving
 * it. That covers two cases the earlier local version missed: a provider that reports usage on the
 * provider thread rather than per turn, and a forked conversation, which inherits the usage of the
 * run it forked from until it records a turn of its own.
 *
 * Only usage with a `maxTokens` ceiling can show a ring (#8144); a turn the provider never sized
 * stays excluded rather than rendering a meter with no scale. Ties on `updatedAt` go to the later
 * entry, since live upserts append.
 */
export function latestContextUsage(projection: OrchestrationV2ThreadProjection | null | undefined): ContextUsageSnapshot | null {
  if (!projection) return null;
  const providerThread = projection.providerThreads.find((thread) => thread.id === projection.thread.activeProviderThreadId);
  const live = latestProviderTurnTokenUsage(projection.providerTurns, projection, providerThread);
  const snapshot = deriveLatestContextWindowSnapshot(projection.visibleTurnItems, live, providerThread);
  const maxTokens = snapshot?.maxTokens ?? null;
  if (!snapshot || maxTokens === null || maxTokens <= 0) return null;
  const cached = snapshot.cachedInputTokens ?? null;
  return {
    usedTokens: snapshot.usedTokens,
    maxTokens,
    updatedAt: snapshot.updatedAt,
    ...(cached === null ? {} : { cachedInputTokens: cached }),
  };
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
