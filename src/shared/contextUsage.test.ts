import test from "node:test";
import assert from "node:assert/strict";
import { contextUsageBand, contextUsagePercent, contextUsageTooltip, formatContextUsageTokens, latestContextUsage } from "./contextUsage.js";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const turn = (id: string, fields: Record<string, unknown> = {}) => ({ id, providerThreadId: "pt", nodeId: "node", runAttemptId: null, nativeTurnRef: null, ordinal: 1, status: "completed", startedAt: null, completedAt: null, ...fields });
// A real projection always carries these; the derivation reads the active provider thread, the
// thread's fork origin and its visible items alongside the turns.
const projection = (providerTurns: ReadonlyArray<unknown>, over: Record<string, unknown> = {}) => ({
  providerTurns, providerThreads: [], contextTransfers: [], visibleTurnItems: [],
  thread: { id: "thread", activeProviderThreadId: null, forkedFrom: null, modelSelection: { instanceId: "codex", model: "gpt-6-luna" } },
  ...over,
} as unknown as OrchestrationV2ThreadProjection);

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

test("Usage reported on the provider thread is used where no turn reported any", () => {
  // Some providers report the window on the thread rather than per turn; the earlier local
  // derivation looked only at turns and showed no meter at all.
  const usage = latestContextUsage(projection([], {
    thread: { id: "thread", activeProviderThreadId: "pt-1", forkedFrom: null, modelSelection: { instanceId: "codex", model: "gpt-6-luna" } },
    providerThreads: [{ id: "pt-1", updatedAt: DateTime.makeUnsafe("2026-01-02T00:00:00Z"), contextUsage: { usedTokens: 60_000, maxTokens: 200_000 } }],
  }));
  assert.deepEqual([usage?.usedTokens, usage?.maxTokens], [60_000, 200_000]);
});

test("A fork inherits the usage of the run it came from until it records a turn of its own", () => {
  const forked = projection([], {
    thread: { id: "child", activeProviderThreadId: null, forkedFrom: { type: "run", threadId: "parent", runId: "run-1" }, modelSelection: { instanceId: "codex", model: "gpt-6-luna" } },
    contextTransfers: [{ type: "fork", targetThreadId: "child", sourceThreadId: "parent", sourcePoint: { runId: "run-1" },
      sourceProviderInstanceId: "codex", status: "pending",
      sourceTokenUsage: { usedTokens: 90_000, maxTokens: 200_000, updatedAt: "2026-01-03T00:00:00Z" } }],
  });
  assert.deepEqual(latestContextUsage(forked), { usedTokens: 90_000, maxTokens: 200_000, updatedAt: "2026-01-03T00:00:00Z" });
});

test("A thread's own turn still outranks an inherited fork usage", () => {
  const forked = projection([turn("own", { tokenUsage: { usedTokens: 5_000, maxTokens: 200_000, updatedAt: "2026-01-04T00:00:00Z" } })], {
    thread: { id: "child", activeProviderThreadId: null, forkedFrom: { type: "run", threadId: "parent", runId: "run-1" }, modelSelection: { instanceId: "codex", model: "gpt-6-luna" } },
    contextTransfers: [{ type: "fork", targetThreadId: "child", sourceThreadId: "parent", sourcePoint: { runId: "run-1" },
      sourceProviderInstanceId: "codex", status: "pending",
      sourceTokenUsage: { usedTokens: 90_000, maxTokens: 200_000, updatedAt: "2026-01-03T00:00:00Z" } }],
  });
  assert.equal(latestContextUsage(forked)?.usedTokens, 5_000);
});
