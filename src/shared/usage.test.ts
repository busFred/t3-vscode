import assert from "node:assert/strict";
import test from "node:test";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import { harness, provider } from "../host/testing/fakeTransport.js";
import { meterText, selectedUsageAccounts, usageAccounts, usageRefreshTarget } from "./usage.js";

test("Meters keep subscriptions separate, deduplicate shared accounts and preserve missing quota windows", async (t) => {
  const { host } = await harness(); t.after(() => host.dispose());
  const first = { ...provider, instanceId: ProviderInstanceId.make("codex-personal"), driver: ProviderDriverKind.make("codex"), displayName: "Personal",
    auth: { status: "authenticated" as const, email: "personal@example.test" }, usageLimits: { checkedAt: "2026-10-06T00:00:00Z", windows: [{ id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 9 }, { id: "session", kind: "session" as const, label: "Session", usedPercent: 36 }] } };
  const second = { ...first, instanceId: ProviderInstanceId.make("codex-work"), displayName: "Work", auth: { status: "authenticated" as const, email: "work@example.test" }, usageLimits: { ...first.usageLimits, windows: [{ id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 45 }] } };
  const duplicate = { ...first, instanceId: ProviderInstanceId.make("codex-copy"), auth: { status: "authenticated" as const, email: "PERSONAL@example.test" } };
  const unavailable = { ...provider, instanceId: ProviderInstanceId.make("unavailable"), displayName: "Unavailable", usageLimits: { checkedAt: "2026-10-06T00:00:00Z", windows: [], unavailable: { reason: "unsupported" as const } } };
  const accounts = usageAccounts({ ...host.snapshot(), providers: [first, second, duplicate, unavailable] });
  assert.equal(accounts.length, 3);
  const personal = accounts.find((account) => account.label === "Personal")!;
  const work = accounts.find((account) => account.label === "Work")!;
  assert.deepEqual(personal.instanceIds, ["codex-personal", "codex-copy"]);
  assert.equal(meterText(personal), "W 91% · S 64%");
  assert.equal(meterText(work), "Week 55%");
  assert.equal(meterText({ ...personal, limits: { ...personal.limits, windows: [{ id: "monthly", kind: "monthly", label: "Month", usedPercent: 0 }, ...personal.limits.windows] } }), "M 100% · W 91% · S 64%");
  assert.equal(meterText({ ...personal, limits: { ...personal.limits, windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 100 }] } }), "Session 0%");
  assert.equal(meterText(accounts.find((account) => account.label === "Unavailable")!), "Usage unavailable");
  assert.deepEqual(selectedUsageAccounts(accounts, { followActive: true, pinnedAccounts: [personal.key, work.key] }, "codex-copy").map((account) => account.key), [personal.key, work.key]);
  assert.deepEqual(selectedUsageAccounts(accounts, { followActive: false, pinnedAccounts: [work.key] }, "codex-personal"), [work]);
});

test("Background refreshes target a single displayed meter's live instance and sweep when several are shown", async (t) => {
  const { host } = await harness(); t.after(() => host.dispose());
  const limits = { checkedAt: "2026-10-06T00:00:00Z", windows: [{ id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 9 }] };
  const dead = { ...provider, instanceId: ProviderInstanceId.make("codex-dead"), driver: ProviderDriverKind.make("codex"), displayName: "Personal", installed: false,
    auth: { status: "authenticated" as const, email: "personal@example.test" }, usageLimits: limits };
  const live = { ...dead, instanceId: ProviderInstanceId.make("codex-live"), installed: true };
  const claude = { ...provider, instanceId: ProviderInstanceId.make("claude-work"), driver: ProviderDriverKind.make("claude"), displayName: "Work",
    auth: { status: "authenticated" as const, email: "work@example.test" }, usageLimits: limits };
  const providers = [dead, live, claude];
  const accounts = usageAccounts({ ...host.snapshot(), providers });
  const personal = accounts.find((account) => account.label === "Personal")!;
  const work = accounts.find((account) => account.label === "Work")!;
  assert.deepEqual(personal.instanceIds, ["codex-dead", "codex-live"]);

  assert.equal(usageRefreshTarget([personal], providers, "codex-dead"), "codex-dead", "The active conversation's own instance is always worth refreshing");
  assert.equal(usageRefreshTarget([personal], providers), "codex-live", "Without an active instance, skip one that is not installed and cannot report a fresh read");
  const disabled = [{ ...dead, installed: true, enabled: false }, live, claude];
  assert.equal(usageRefreshTarget([usageAccounts({ ...host.snapshot(), providers: disabled }).find((account) => account.label === "Personal")!], disabled), "codex-live",
    "A disabled instance is skipped for the same reason as an uninstalled one");
  assert.equal(usageRefreshTarget([work], providers, "codex-live"), "claude-work", "An active instance outside the displayed account does not become the target");
  assert.equal(usageRefreshTarget([personal, work], providers, "codex-live"), undefined, "Several meters sweep, so a pinned account for another provider still advances");
  assert.equal(usageRefreshTarget([], providers, "codex-live"), undefined);
  assert.equal(usageRefreshTarget([{ ...work, instanceIds: [] }], providers), undefined, "An account with no instance left has nothing to target");
});
