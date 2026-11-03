import test from "node:test";
import assert from "node:assert/strict";
import { serverVersionSupported, unsupportedServerMessage } from "./serverVersion.js";

test("Servers older than 0.1.5 are refused; nightlies and newer releases connect", () => {
  for (const version of ["0.0.45", "0.1.4", "0.1.4-nightly.20261020.1"]) assert.equal(serverVersionSupported(version), false, version);
  for (const version of ["0.1.5", "0.1.5-nightly.20261028.1", "0.1.6", "v0.1.7-nightly.20261103.4106", "0.2.0", "1.0.0", "dev"]) assert.equal(serverVersionSupported(version), true, version);
  assert.match(unsupportedServerMessage("0.1.4"), /0\.1\.4 is too old.*0\.1\.5 or later/);
});
