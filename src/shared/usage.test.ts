import assert from "node:assert/strict";
import test from "node:test";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import { harness, provider } from "../host/testing/fakeTransport.js";
import { accountPinMatches, updatedAccountPins, usageAccountName, accountWindows, groupOf, groupTitle, meterText, perAccountRows, pooledAccount, resolveMeterWindows, selectedUsageAccounts, soonestReset, usageAccounts, usageGroups, usageNotices, usageRefreshTarget } from "./usage.js";

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
  assert.deepEqual(groups.map(groupTitle), ["Claude · (3)", "Codex"]);
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

test("Pooled meters ignore the other windows of an account whose 7-day limit is used up, while per-account rows keep every real bar", async (t) => {
  const { host } = await harness(); t.after(() => host.dispose());
  const now = Date.parse("2026-10-24T12:00:00Z");
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  type Spec = { readonly session?: readonly [used: number, reset: number]; readonly week?: readonly [used: number, reset: number]; readonly fable?: readonly [used: number, reset: number] };
  const account = (email: string, spec: Spec) => ({ id: `${email}.json`, driver: ProviderDriverKind.make("claudeAgent"), email, plan: "Claude Subscription",
    usageLimits: { checkedAt: at(0), windows: [
      ...(spec.session ? [{ id: "five_hour", kind: "session" as const, label: "Session", usedPercent: spec.session[0], resetsAt: at(spec.session[1]) }] : []),
      ...(spec.week ? [{ id: "seven_day", kind: "weekly" as const, label: "Weekly", usedPercent: spec.week[0], resetsAt: at(spec.week[1]) }] : []),
      ...(spec.fable ? [{ id: "seven_day_fable", kind: "weekly" as const, label: "Fable", usedPercent: spec.fable[0], resetsAt: at(spec.fable[1]) }] : []),
    ] } });
  const groupOf3 = (accounts: ReadonlyArray<ReturnType<typeof account>>) => {
    const hub = { id: "hub" as never, kind: "cliproxy" as const, label: "CLI Proxy", checkedAt: at(0), accounts: [...accounts] };
    return usageGroups({ ...host.snapshot(), providers: [], usageLimitSources: [hub] }, now)[0]!;
  };
  const all = resolveMeterWindows(["session", "week", "modelWeeks"]);
  const exhausted = account("out@example.test", { session: [90, 1], week: [100, 50], fable: [95, 5] });
  const second = account("b@example.test", { session: [20, 2], week: [40, 100], fable: [10, 6] });
  const third = account("c@example.test", { session: [40, 3], week: [60, 100], fable: [30, 7] });

  const group = groupOf3([exhausted, second, third]);
  // T3 orders pool members by effective reset: the locked-out account's session only returns with its week, so it sorts last.
  assert.deepEqual(group.reporting.map((a) => a.email), ["b@example.test", "c@example.test", "out@example.test"]);
  const pooled = pooledAccount(group, now);
  // Session and Fable average only the two usable accounts (30 and 20 used); the week averages all three (100, 40, 60 used).
  assert.equal(meterText(pooled, all), "S 70% · W 33% · Fable 80%");
  assert.equal(soonestReset(group, accountWindows(pooled)[0]!.window!, now)?.email, "b@example.test");
  assert.equal(soonestReset(group, accountWindows(pooled)[1]!.window!, now)?.email, "out@example.test");
  // Fable shows when the locked-out account's own Fable resets (+5h), not the usable accounts' (+6h).
  assert.equal(soonestReset(group, accountWindows(pooled)[2]!.window!, now)?.email, "out@example.test");
  assert.equal(accountWindows(pooled)[2]!.window!.resetsAt, at(5));
  assert.equal(soonestReset(group, accountWindows(pooled)[0]!.window!, now), group.reporting[0]);

  // Two locked-out accounts whose Fable returns in 24h and one usable account whose Fable resets in 72h with 20% used.
  const day = groupOf3([account("a@example.test", { session: [90, 1], week: [100, 24], fable: [95, 24] }), account("b@example.test", { session: [80, 2], week: [100, 30], fable: [60, 24] }),
    account("c@example.test", { session: [10, 3], week: [40, 100], fable: [20, 72] })]);
  const dayPool = pooledAccount(day, now);
  const dayRows = accountWindows(dayPool).map((row) => row.window!);
  const daySession = dayRows[0]!, dayWeek = dayRows[1]!, dayFable = dayRows[2]!;
  assert.equal(dayFable.usedPercent, 20);
  assert.equal(dayFable.resetsAt, at(24));
  assert.equal(dayWeek.usedPercent, 80);
  assert.equal(dayWeek.resetsAt, at(24));
  assert.equal(daySession.usedPercent, 10);
  assert.equal(daySession.resetsAt, at(3));
  assert.equal(["a@example.test", "b@example.test"].includes(soonestReset(day, dayFable, now)!.email!), true);
  assert.equal(soonestReset(day, daySession, now)?.email, "c@example.test");
  assert.equal(soonestReset(day, dayFable, now), day.reporting.find((a) => a.email === soonestReset(day, dayFable, now)!.email));
  // Per-account mode still shows every account's own bars.
  const rows = perAccountRows(group, now);
  assert.deepEqual(rows.map((row) => row.label), ["Session", "Week", "Fable"]);
  assert.deepEqual(rows.map((row) => row.columns.map(({ window }) => window?.usedPercent)), [[20, 40, 90], [40, 60, 100], [10, 30, 95]]);
  assert.equal(group.reporting[0]!.limits.windows.length, 3);

  // Nothing usable left: every week is used up, so T3 reports each session as empty until its week resets;
  // the model week is still averaged over all of them.
  const stuck = groupOf3([exhausted, account("b@example.test", { session: [20, 2], week: [100, 100], fable: [10, 6] })]);
  assert.equal(meterText(pooledAccount(stuck, now), all), "S 0% · W 0% · Fable 47%");

  // An account with no weekly window is never excluded; an exhausted one only drops out of the windows others report.
  const noWeek = groupOf3([exhausted, account("none@example.test", { session: [20, 2] })]);
  assert.equal(meterText(pooledAccount(noWeek, now), all), "S 80% · W 0% · Fable 5%");
  assert.equal(soonestReset(noWeek, accountWindows(pooledAccount(noWeek, now))[0]!.window!, now)?.email, "none@example.test");

  // A single exhausted account keeps showing its own windows.
  assert.equal(meterText(pooledAccount(groupOf3([exhausted]), now), all), "S 10% · W 0% · Fable 5%");
  // Without an exhausted week every window pools as before.
  assert.equal(meterText(pooledAccount(groupOf3([account("x@example.test", { session: [90, 1], week: [99, 50] }), second]), now), all), "S 45% · W 30% · Fable 90%");
});


test("Workspace accounts stay distinct in pools, rows and legacy pins", async (t) => {
  const { host } = await harness(); t.after(() => host.dispose());
  const base = { ...provider, driver: ProviderDriverKind.make("codex"), displayName: "Codex",
    auth: { status: "authenticated" as const, email: "same@example.test" },
    usageLimits: { checkedAt: "2026-10-06T00:00:00Z", windows: [{ id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 20 }] } };
  const first = { ...base, instanceId: ProviderInstanceId.make("first"), auth: { ...base.auth, workspaceId: "one" } };
  const second = { ...base, instanceId: ProviderInstanceId.make("second"), auth: { ...base.auth, workspaceId: "two" },
    usageLimits: { ...base.usageLimits, windows: [{ ...base.usageLimits.windows[0]!, usedPercent: 60 }] } };
  const state = { ...host.snapshot(), providers: [first, second] };
  const group = usageGroups(state)[0]!;
  assert.equal(group.reporting.length, 2);
  assert.deepEqual(group.accounts.map(usageAccountName), ["same@example.test · one", "same@example.test · two"]);
  assert.deepEqual(group.accounts.map((account) => account.instanceIds), [["first"], ["second"]]);
  assert.equal(meterText(pooledAccount(group)), "Week 60%");
  assert.equal(perAccountRows(group)[0]!.columns.length, 2);
  const legacy = "codex:email:same@example.test";
  assert.deepEqual(selectedUsageAccounts(group.accounts, { followActive: false, pinnedAccounts: [legacy] }), group.accounts);
  assert.ok(group.accounts.every((account) => accountPinMatches(account, legacy)));
  assert.deepEqual(updatedAccountPins([legacy, "unseen:email:x"], group.accounts, group.accounts.map((account) => account.key)), [legacy, "unseen:email:x", ...group.accounts.map((account) => account.key)]);
  assert.deepEqual(selectedUsageAccounts(group.accounts, { followActive: false, pinnedAccounts: [group.accounts[0]!.key] }), [group.accounts[0]]);
  assert.deepEqual(updatedAccountPins([legacy], group.accounts, [group.accounts[0]!.key]), [group.accounts[0]!.key]);
  const merged = usageAccounts({ ...state, providers: [first, { ...base, instanceId: ProviderInstanceId.make("unscoped") }, { ...second, enabled: false }] });
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]!.instanceIds, ["first", "unscoped"]);
  const [plain] = usageAccounts({ ...state, providers: [base] });
  assert.equal(plain!.key, legacy);
  assert.equal(usageAccountName(plain!), "same@example.test");
  assert.equal(accountPinMatches(plain!, legacy), true);
});
