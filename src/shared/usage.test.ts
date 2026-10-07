import assert from "node:assert/strict";
import test from "node:test";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import { harness, provider } from "../host/testing/fakeTransport.js";
import { meterText, selectedUsageAccounts, usageAccounts } from "./usage.js";

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
