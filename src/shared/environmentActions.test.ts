import test from "node:test";
import assert from "node:assert/strict";
import { environmentRowActions, ignoreChange } from "./environmentActions.js";
import type { EnvironmentDisplayStatus } from "./environmentStatus.js";

const actions = (status: EnvironmentDisplayStatus, ignored = false) => environmentRowActions({ status, ignored });

test("connected and disabled rows keep their existing actions", () => {
  assert.deepEqual(actions("connected"), { text: [], icons: ["reconnect", "disable", "remove"] });
  assert.deepEqual(actions("disabled"), { text: ["enable"], icons: ["remove"] });
  assert.deepEqual(actions("connecting"), { text: [], icons: [] });
});

test("a reconnecting row keeps Reconnect, Disable and Remove besides Ignore", () => {
  assert.deepEqual(actions("reconnecting"), { text: ["ignore"], icons: ["reconnect", "disable", "remove"] });
});

test("expiring and expired rows keep Pair again, Disable and Remove; only expired drops Reconnect", () => {
  assert.deepEqual(actions("expiring"), { text: ["pairAgain", "ignore"], icons: ["reconnect", "disable", "remove"] });
  assert.deepEqual(actions("expired"), { text: ["pairAgain", "ignore"], icons: ["disable", "remove"] });
});

test("an ignored problem offers Unignore instead of Ignore and keeps Disable and Remove", () => {
  for (const status of ["reconnecting", "expiring", "expired"] as const) {
    const { text, icons } = actions(status, true);
    assert.ok(text.includes("unignore") && !text.includes("ignore"), status);
    assert.ok(icons.includes("disable") && icons.includes("remove"), status);
  }
});

test("ignoreChange stores the shown problem, clears on unignore and refuses healthy machines", () => {
  assert.equal(ignoreChange("ignore", "expired"), "expired");
  assert.equal(ignoreChange("unignore", "reconnecting"), null);
  assert.equal(ignoreChange("unignore", undefined), null);
  assert.throws(() => ignoreChange("ignore", "connected"), /nothing to ignore/);
  assert.throws(() => ignoreChange("ignore", undefined), /nothing to ignore/);
});
