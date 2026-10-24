import test from "node:test";
import assert from "node:assert/strict";
import { EXPIRY_WARNING_MS, environmentDisplayStatus, environmentIndicator, expiryLabel, type EnvironmentDisplayStatus } from "./environmentStatus.js";

const NOW = 1_800_000_000_000, HOUR = 3_600_000, DAY = 24 * HOUR;

test("EXPIRY_WARNING_MS is three days", () => assert.equal(EXPIRY_WARNING_MS, 3 * DAY));

test("environmentDisplayStatus maps each connection state", () => {
  const status = (state: Parameters<typeof environmentDisplayStatus>[0]["state"], expiresAt: number | null = null, enabled = true) => environmentDisplayStatus({ state, enabled, expiresAt }, NOW);
  assert.equal(status("connected"), "connected");
  assert.equal(status("connecting"), "connecting");
  assert.equal(status("error"), "reconnecting");
  assert.equal(status("expired"), "expired");
  assert.equal(status("disabled"), "disabled");
  assert.equal(status("connected", NOW + 30 * DAY), "connected");
});

test("a connected machine is expiring at or inside the three-day threshold only", () => {
  const status = (expiresAt: number | null) => environmentDisplayStatus({ state: "connected", enabled: true, expiresAt }, NOW);
  assert.equal(status(NOW + EXPIRY_WARNING_MS + 1), "connected");
  assert.equal(status(NOW + EXPIRY_WARNING_MS), "expiring");
  assert.equal(status(NOW + HOUR), "expiring");
  assert.equal(status(NOW - 1), "expiring");
  assert.equal(status(null), "connected");
});

test("expiry only upgrades a connected machine; other states keep their status", () => {
  const near = NOW + HOUR;
  assert.equal(environmentDisplayStatus({ state: "connecting", enabled: true, expiresAt: near }, NOW), "connecting");
  assert.equal(environmentDisplayStatus({ state: "error", enabled: true, expiresAt: near }, NOW), "reconnecting");
  assert.equal(environmentDisplayStatus({ state: "expired", enabled: true, expiresAt: near }, NOW), "expired");
});

test("disabled takes precedence over every other state", () => {
  for (const state of ["connecting", "connected", "error", "expired", "disabled"] as const)
    assert.equal(environmentDisplayStatus({ state, enabled: false, expiresAt: NOW - DAY }, NOW), "disabled", state);
  assert.equal(environmentDisplayStatus({ state: "disabled", enabled: true, expiresAt: null }, NOW), "disabled");
});

const row = (status: EnvironmentDisplayStatus, ignored = false) => ({ status, ignored });
test("environmentIndicator is ok for no rows and for healthy rows", () => {
  assert.equal(environmentIndicator([]), "ok");
  assert.equal(environmentIndicator([row("connected"), row("connecting")]), "ok");
});

test("environmentIndicator: reconnecting and expiring warn, expired is an error, red beats yellow", () => {
  assert.equal(environmentIndicator([row("connected"), row("reconnecting")]), "warn");
  assert.equal(environmentIndicator([row("expiring")]), "warn");
  assert.equal(environmentIndicator([row("expired")]), "error");
  assert.equal(environmentIndicator([row("reconnecting"), row("expiring"), row("expired"), row("connected")]), "error");
  assert.equal(environmentIndicator([row("expired"), row("reconnecting")]), "error");
});

test("environmentIndicator skips ignored rows and never counts disabled ones", () => {
  assert.equal(environmentIndicator([row("expired", true)]), "ok");
  assert.equal(environmentIndicator([row("expired", true), row("reconnecting")]), "warn");
  assert.equal(environmentIndicator([row("expired", true), row("expiring", true), row("reconnecting", true)]), "ok");
  assert.equal(environmentIndicator([row("expired"), row("reconnecting", true)]), "error");
  assert.equal(environmentIndicator([row("disabled"), row("disabled", true)]), "ok");
  assert.equal(environmentIndicator([row("disabled"), row("expiring")]), "warn");
});

test("expiryLabel wording across the day and hour boundaries", () => {
  const label = (ms: number) => expiryLabel(NOW + ms, NOW);
  assert.equal(label(3 * DAY), "Expires in 3 days");
  assert.equal(label(2 * DAY), "Expires in 2 days");
  assert.equal(label(2 * DAY + 23 * HOUR), "Expires in 2 days");
  assert.equal(label(2 * DAY - HOUR), "Expires in 1 day");
  assert.equal(label(DAY), "Expires in 1 day");
  assert.equal(label(DAY - HOUR), "Expires in 23 hours");
  assert.equal(label(2 * HOUR), "Expires in 2 hours");
  assert.equal(label(HOUR), "Expires in 1 hour");
  assert.equal(label(HOUR - 1), "Expires within an hour");
  assert.equal(label(0), "Expires within an hour");
  assert.equal(label(-5 * DAY), "Expires within an hour");
});
