import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { peerChoiceAnswer, peerReachableUrls, type PeerMachine } from "./peerLinks.js";
const item = { id: TurnItemId.make("request"), threadId: ThreadId.make("thread") };
const machine: PeerMachine = { environmentId: "build", label: "Build machine", urls: ["https://build.example", "http://build.lan:3773"], paired: true, linked: false };

test("Card picker reuses existing links without sending access or pairing credentials", () => {
  assert.deepEqual(peerChoiceAnswer(item, { ...machine, linked: true }, "", "unused-secret", "full-access"), { threadId: item.threadId, turnItemId: item.id, answer: { type: "use-existing", environmentId: "build" } });
});
test("Card picker sends known-machine identity and ordered URLs for a new link", () => {
  assert.deepEqual(peerChoiceAnswer(item, machine, "https://unused.example", "  one-use-code  ", "read-only"), { threadId: item.threadId, turnItemId: item.id, answer: { type: "link", environmentId: "build", label: "Build machine", urls: machine.urls, pairingCode: "one-use-code", access: "read-only" } });
  assert.equal(peerChoiceAnswer(item, machine, "", " ", "auto"), null);
});
test("Card retains manual fallback, including an address for a machine known only over SSH", () => {
  const answer = peerChoiceAnswer(item, undefined, " https://manual.example ", "code", "approval-required");
  assert.deepEqual(answer?.answer, { type: "link", urls: ["https://manual.example"], pairingCode: "code", access: "approval-required" });
  assert.equal(peerChoiceAnswer(item, { ...machine, urls: [] }, " https://ssh.example ", "code", "auto")?.answer.type, "link");
  assert.deepEqual(peerChoiceAnswer({ ...item, environmentId: EnvironmentId.make("named"), label: "Named" }, undefined, "https://named.example", "code", "auto")?.answer, { type: "link", environmentId: "named", label: "Named", urls: ["https://named.example"], pairingCode: "code", access: "auto" });
  assert.equal(peerChoiceAnswer(item, undefined, "", "code", "auto"), null);
});
test("Known-machine choices omit loopback, forwarded, credentialed and non-HTTP routes", () => {
  assert.deepEqual(peerReachableUrls(["http://127.0.0.1:3773", "http://127.3.2.1", "http://[::1]:3773", "http://localhost:3000", "ssh://build", "https://user:password@build", "https://build?token=secret", "https://build#secret", "http://build.lan", "https://build.example", "https://build.example"]), ["http://build.lan", "https://build.example"]);
});
