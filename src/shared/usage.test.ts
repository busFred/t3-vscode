import assert from "node:assert/strict";
import test from "node:test";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import { harness, provider } from "../host/testing/fakeTransport.js";
import { accountWindows, groupOf, groupTitle, meterText, perAccountRows, pooledAccount, resolveMeterWindows, selectedUsageAccounts, soonestReset, usageAccounts, usageGroups, usageNotices, usageRefreshTarget } from "./usage.js";

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
  assert.equal(meterText(personal), "S 64% · W 91%");
  assert.equal(meterText(work), "Week 55%");
  assert.equal(meterText({ ...personal, limits: { ...personal.limits, windows: [{ id: "monthly", kind: "monthly", label: "Month", usedPercent: 0 }, ...personal.limits.windows] } }), "S 64% · W 91% · M 100%");
  assert.equal(meterText({ ...personal, limits: { ...personal.limits, windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 100 }] } }), "Session 0%");
  assert.equal(meterText(accounts.find((account) => account.label === "Unavailable")!), "Usage unavailable");
  assert.deepEqual(selectedUsageAccounts(accounts, { followActive: true, pinnedAccounts: [personal.key, work.key] }, "codex-copy").map((account) => account.key), [personal.key, work.key]);
  assert.deepEqual(selectedUsageAccounts(accounts, { followActive: false, pinnedAccounts: [work.key] }, "codex-personal"), [work]);
});

test("Claude windows list shortest to longest, with model-specific weeks after the general week and before the month", async (t) => {
  const { host } = await harness(); t.after(() => host.dispose());
  const windows = [{ id: "monthly", kind: "monthly" as const, label: "Month", usedPercent: 10 }, { id: "seven_day_fable", kind: "weekly" as const, label: "Weekly Fable", usedPercent: 20 },
    { id: "seven_day", kind: "weekly" as const, label: "Weekly", usedPercent: 30 }, { id: "five_hour", kind: "session" as const, label: "Session", usedPercent: 40 }];
  const claude = { ...provider, instanceId: ProviderInstanceId.make("claude-order"), driver: ProviderDriverKind.make("claude"), displayName: "Order",
    auth: { status: "authenticated" as const, email: "order@example.test" }, usageLimits: { checkedAt: "2026-10-06T00:00:00Z", windows } };
  const [account] = usageAccounts({ ...host.snapshot(), providers: [claude] });
  assert.deepEqual(accountWindows(account!).map((row) => row.label), ["Session", "Week", "Weekly Fable", "Month"]);
  assert.equal(meterText(account!), "S 60% · W 70% · M 90%");
  assert.deepEqual(accountWindows({ ...account!, limits: { ...account!.limits, windows: [windows[2]!] } }).map((row) => row.label), ["Week"]);
  assert.equal(meterText({ ...account!, limits: { ...account!.limits, windows: [windows[1]!] } }), "Week 80%");
  assert.deepEqual(accountWindows({ ...account!, limits: { ...account!.limits, windows: [] } }).map((row) => row.label), ["Session", "Week", "Month"]);
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

test("Hub accounts group under their provider, pool by average with the soonest reset, and API-key harnesses stay silent", async (t) => {
  const { host } = await harness(); t.after(() => host.dispose());
  const now = Date.parse("2026-10-24T12:00:00Z");
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  const claudeKey = { ...provider, instanceId: ProviderInstanceId.make("claude"), driver: ProviderDriverKind.make("claudeAgent"), displayName: "Claude",
    auth: { status: "authenticated" as const, type: "apiKey", label: "Claude API Key" }, usageLimits: { checkedAt: at(0), windows: [], unavailable: { reason: "probeFailed" as const, message: "Could not read usage." } } };
  const codexKey = { ...provider, instanceId: ProviderInstanceId.make("codex"), driver: ProviderDriverKind.make("codex"), displayName: "Codex",
    auth: { status: "authenticated" as const }, usageLimits: { checkedAt: at(0), windows: [], unavailable: { reason: "probeFailed" as const, message: "Codex could not read usage (JSON-RPC -32600)." } } };
  const hubAccount = (email: string, session: number, sessionReset: number, week: number) => ({ id: `${email}.json`, driver: ProviderDriverKind.make("claudeAgent"), email, plan: "Claude Subscription",
    usageLimits: { checkedAt: at(0), windows: [{ id: "five_hour", kind: "session" as const, label: "Session", usedPercent: session, resetsAt: at(sessionReset) }, { id: "seven_day", kind: "weekly" as const, label: "Weekly", usedPercent: week, resetsAt: at(100) }] } });
  const hub = { id: "hub" as never, kind: "cliproxy" as const, label: "CLI Proxy", checkedAt: at(0),
    accounts: [hubAccount("late@example.test", 17, 4, 8), hubAccount("soon@example.test", 28, 2, 60), hubAccount("mid@example.test", 72, 3, 91)] };
  const state = { ...host.snapshot(), providers: [claudeKey, codexKey], usageLimitSources: [hub] };
  const groups = usageGroups(state, now);
  assert.deepEqual(groups.map(groupTitle), ["Claude · 3 accounts", "Codex"]);
  const claude = groups[0]!;
  assert.equal(claude.plan, "Claude Subscription ×3");
  assert.equal(claude.source, "CLI Proxy");
  assert.deepEqual(claude.reporting.map((account) => account.email), ["soon@example.test", "mid@example.test", "late@example.test"]);
  assert.equal(groupOf(groups, claude.reporting[1]!.key), claude);
  const pooled = pooledAccount(claude, now);
  // Remaining 72 / 28 / 83 average to 61; the week to 47.
  assert.equal(meterText(pooled), "S 61% · W 47%");
  assert.equal(accountWindows(pooled)[0]!.window!.resetsAt, at(2));
  assert.equal(soonestReset(claude, accountWindows(pooled)[0]!.window!, now)?.email, "soon@example.test");
  const rows = perAccountRows(claude, now);
  assert.deepEqual(rows.map((row) => row.label), ["Session", "Week"]);
  assert.deepEqual(rows[1]!.columns.map(({ window }) => window?.usedPercent), [60, 91, 8]);
  const codex = groups[1]!;
  assert.deepEqual(accountWindows(pooledAccount(codex, now)).map((row) => row.window), [null, null, null]);
  assert.deepEqual(usageNotices(state), []);
  assert.deepEqual(usageNotices({ ...state, usageLimitSources: [{ ...hub, accounts: [], error: "HTTP 401" }] }), ["CLI Proxy: HTTP 401"]);
  assert.deepEqual(usageNotices({ ...state, providers: [{ ...codexKey, usageLimits: { ...codexKey.usageLimits, unavailable: { reason: "probeFailed" as const, message: "Timed out." } } }] }), ["Codex: Timed out."]);
  assert.equal(meterText(pooled, resolveMeterWindows(["week"])), "Week 47%");
  assert.equal(meterText(pooled, resolveMeterWindows([])), "No selected window");
});
