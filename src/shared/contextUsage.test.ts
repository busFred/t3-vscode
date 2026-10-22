import test from "node:test";
import assert from "node:assert/strict";
import { contextUsageBand, contextUsagePercent, contextUsageTooltip, formatContextUsageTokens, latestContextUsage } from "./contextUsage.js";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

const turn = (id: string, fields: Record<string, unknown> = {}) => ({ id, providerThreadId: "pt", nodeId: "node", runAttemptId: null, nativeTurnRef: null, ordinal: 1, status: "completed", startedAt: null, completedAt: null, ...fields });
const projection = (providerTurns: ReadonlyArray<unknown>) => ({ providerTurns } as unknown as OrchestrationV2ThreadProjection);

test("latestContextUsage is null without a projection, without any turn, or without a sized turn", () => {
  assert.equal(latestContextUsage(null), null);
  assert.equal(latestContextUsage(projection([])), null);
  assert.equal(latestContextUsage(projection([turn("a")])), null, "a turn with no tokenUsage at all");
  assert.equal(latestContextUsage(projection([turn("a", { tokenUsage: { usedTokens: 10, updatedAt: "2026-01-01T00:00:00Z" } })])), null, "a turn the provider never sized");
});

test("latestContextUsage picks the most recently updated sized turn and carries cachedInputTokens only when reported", () => {
  const older = turn("a", { tokenUsage: { usedTokens: 1000, maxTokens: 200_000, updatedAt: "2026-01-01T00:00:00Z" } });
  const newer = turn("b", { tokenUsage: { usedTokens: 124_000, maxTokens: 200_000, cachedInputTokens: 45_000, updatedAt: "2026-01-01T00:01:00Z" } });
  assert.deepEqual(latestContextUsage(projection([older, newer])), { usedTokens: 124_000, maxTokens: 200_000, cachedInputTokens: 45_000, updatedAt: "2026-01-01T00:01:00Z" });
  assert.deepEqual(latestContextUsage(projection([newer, older])), { usedTokens: 124_000, maxTokens: 200_000, cachedInputTokens: 45_000, updatedAt: "2026-01-01T00:01:00Z" });
});

test("latestContextUsage falls back to array order when updatedAt ties", () => {
  const first = turn("a", { tokenUsage: { usedTokens: 10, maxTokens: 100, updatedAt: "2026-01-01T00:00:00Z" } });
  const second = turn("b", { tokenUsage: { usedTokens: 20, maxTokens: 100, updatedAt: "2026-01-01T00:00:00Z" } });
  assert.deepEqual(latestContextUsage(projection([first, second])), { usedTokens: 20, maxTokens: 100, updatedAt: "2026-01-01T00:00:00Z" });
});

test("contextUsagePercent rounds to an integer and clamps at 100", () => {
  assert.equal(contextUsagePercent({ usedTokens: 124_000, maxTokens: 200_000 }), 62);
  assert.equal(contextUsagePercent({ usedTokens: 36_000, maxTokens: 200_000 }), 18);
  assert.equal(contextUsagePercent({ usedTokens: 250_000, maxTokens: 200_000 }), 100);
  assert.equal(contextUsagePercent({ usedTokens: 0, maxTokens: 0 }), 0);
});

test("contextUsageBand matches the documented thresholds", () => {
  assert.equal(contextUsageBand(0), "low");
  assert.equal(contextUsageBand(54), "low");
  assert.equal(contextUsageBand(55), "warning");
  assert.equal(contextUsageBand(84), "warning");
  assert.equal(contextUsageBand(85), "error");
  assert.equal(contextUsageBand(100), "error");
});

test("formatContextUsageTokens prints raw numbers under 1000, thousands as k and millions as M", () => {
  assert.equal(formatContextUsageTokens(950), "950");
  assert.equal(formatContextUsageTokens(124_000), "124k");
  assert.equal(formatContextUsageTokens(36_400), "36k");
  assert.equal(formatContextUsageTokens(1_200_000), "1.2M");
  assert.equal(formatContextUsageTokens(2_000_000), "2M");
});

test("formatContextUsageTokens rolls a thousands-rounding that reaches 1000k into the M branch", () => {
  assert.equal(formatContextUsageTokens(999_499), "999k");
  assert.equal(formatContextUsageTokens(999_500), "1M");
  assert.equal(formatContextUsageTokens(999_999), "1M");
});

test("contextUsageTooltip reports tokens, percent and cached tokens only when known", () => {
  assert.equal(contextUsageTooltip({ usedTokens: 124_000, maxTokens: 200_000, cachedInputTokens: 45_000, updatedAt: "" }), "Context window: 124k / 200k tokens (62%) · 45k cached");
  assert.equal(contextUsageTooltip({ usedTokens: 124_000, maxTokens: 200_000, updatedAt: "" }), "Context window: 124k / 200k tokens (62%)");
});
