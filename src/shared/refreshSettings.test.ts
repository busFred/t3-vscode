import test from "node:test";
import assert from "node:assert/strict";
import { MAX_REFRESH_TIMEOUT_MS, explicitLegacyUsageSeconds, refreshIntervalMs, resolveRefreshSettings } from "./refreshSettings.js";

test("usage and worktrees inherit the ten-minute default when unset or null", () => {
  assert.deepEqual(resolveRefreshSettings(), { defaultIntervalMinutes: 10, usageIntervalMinutes: 10, worktreeIntervalMinutes: 10 });
  assert.deepEqual(resolveRefreshSettings({ defaultIntervalMinutes: 3.5, usageIntervalMinutes: null, worktreeIntervalMinutes: null }),
    { defaultIntervalMinutes: 3.5, usageIntervalMinutes: 3.5, worktreeIntervalMinutes: 3.5 });
});

test("independent overrides preserve fractions and zero without changing the default", () => {
  const settings = resolveRefreshSettings({ defaultIntervalMinutes: 12, usageIntervalMinutes: 0.1, worktreeIntervalMinutes: 0 });
  assert.deepEqual(settings, { defaultIntervalMinutes: 12, usageIntervalMinutes: 0.1, worktreeIntervalMinutes: 0 });
  assert.equal(refreshIntervalMs(settings.usageIntervalMinutes), 6_000);
  assert.equal(refreshIntervalMs(settings.worktreeIntervalMinutes), null);
  assert.deepEqual(resolveRefreshSettings({ defaultIntervalMinutes: 0, usageIntervalMinutes: 0.5 }),
    { defaultIntervalMinutes: 0, usageIntervalMinutes: 0.5, worktreeIntervalMinutes: 0 });
});

test("invalid preferences fall back to valid inherited intervals", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "5", null]) {
    assert.equal(resolveRefreshSettings({ defaultIntervalMinutes: value }).defaultIntervalMinutes, 10);
    const settings = resolveRefreshSettings({ defaultIntervalMinutes: 4, usageIntervalMinutes: value, worktreeIntervalMinutes: value });
    assert.equal(settings.usageIntervalMinutes, 4);
    assert.equal(settings.worktreeIntervalMinutes, 4);
  }
});

test("explicit legacy seconds preserve their conversion and minimum until a new override is set", () => {
  assert.equal(resolveRefreshSettings({ defaultIntervalMinutes: 7, legacyUsageIntervalSeconds: 90 }).usageIntervalMinutes, 1.5);
  assert.equal(resolveRefreshSettings({ defaultIntervalMinutes: 7, legacyUsageIntervalSeconds: 600 }).usageIntervalMinutes, 10);
  assert.equal(resolveRefreshSettings({ legacyUsageIntervalSeconds: 1 }).usageIntervalMinutes, 0.25);
  assert.equal(resolveRefreshSettings({ legacyUsageIntervalSeconds: 0 }).usageIntervalMinutes, 0);
  assert.equal(resolveRefreshSettings({ usageIntervalMinutes: 0.1, legacyUsageIntervalSeconds: 90 }).usageIntervalMinutes, 0.1);
  assert.equal(resolveRefreshSettings({ usageIntervalMinutes: 0, legacyUsageIntervalSeconds: 90 }).usageIntervalMinutes, 0);
  assert.equal(resolveRefreshSettings({ defaultIntervalMinutes: 7 }).usageIntervalMinutes, 7, "an absent legacy override never supplies the old schema default");
});


test("legacy inspection ignores the schema default and keeps explicit configuration precedence", () => {
  assert.equal(explicitLegacyUsageSeconds(undefined), undefined);
  assert.equal(explicitLegacyUsageSeconds({ defaultValue: 600 }), undefined);
  assert.equal(resolveRefreshSettings({ defaultIntervalMinutes: 7, legacyUsageIntervalSeconds: explicitLegacyUsageSeconds({ defaultValue: 600 }) }).usageIntervalMinutes, 7);
  assert.equal(explicitLegacyUsageSeconds({ defaultValue: 600, globalValue: 600 }), 600, "a saved value equal to the former default is still explicit");
  assert.equal(explicitLegacyUsageSeconds({ globalValue: 90, workspaceValue: 120 }), 120);
  assert.equal(explicitLegacyUsageSeconds({ globalValue: 90, workspaceValue: 120, workspaceFolderValue: 0 }), 0);
});


test("large finite minute values cannot overflow Node timeout delays", () => {
  assert.equal(refreshIntervalMs(Number.MAX_VALUE), MAX_REFRESH_TIMEOUT_MS);
  assert.equal(refreshIntervalMs(MAX_REFRESH_TIMEOUT_MS / 60_000 + 1), MAX_REFRESH_TIMEOUT_MS);
  assert.equal(refreshIntervalMs(0.125), 7_500);
  assert.equal(refreshIntervalMs(0), null);
});
