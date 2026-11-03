import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PeerLinksState } from "../shared/peerLinks";
import { MachineCapabilities } from "./components/PeerLinksSection";
import { mergeMachines } from "./machines";
import { agentChipLabel } from "./components/PeerLinksSection";
import { removalConsequences } from "./components/MachineRemoveMenu";
const peers: PeerLinksState = { environmentId: "local", loaded: true, machines: [], links: [{ environmentId: "both", label: "Both", access: "read-only", status: "reachable", paired: true }, { environmentId: "agents", label: "VPS", access: "approval-required", status: "reachable", paired: false }] };
test("Machines merge local, conversations only, agents only and both by identity", () => {
  const rows = mergeMachines({ local: { label: "Local", host: "localhost" }, indicator: "ok", rows: ["both", "conversations"].map(environmentId => ({ environmentId, label: "Same name", host: "host", status: "connected", expiresAt: null, ignored: false })) }, peers);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => [row.environmentId, row.local, row.conversations, row.agents?.access]), [["local", true, true, undefined], ["both", false, true, "read-only"], ["conversations", false, true, undefined], ["agents", false, false, "approval-required"]]);
  for (const row of rows) {
    const html = renderToStaticMarkup(createElement(MachineCapabilities, { machine: row, peers, pair: () => {} }));
    assert.equal(html.includes("Conversations</span>"), row.conversations);
    assert.equal(html.includes("Agents ("), !!row.agents);
    assert.equal(html.includes("Remove agent access"), false, "removal lives in the machine's remove menu");
    assert.equal(html.includes("Let agents use this"), !row.local && !row.agents);
    assert.equal(html.includes("Pair to see conversations"), !row.conversations);
  }
});
test("Local machine never receives self agent access", () => {
  const rows = mergeMachines({ local: { label: "Local", host: "localhost" }, indicator: "ok", rows: [] }, { ...peers, links: [{ ...peers.links[0]!, environmentId: "local" }] });
  assert.equal(rows[0]?.agents, undefined);
});
test("Policy denial disables missing agent capability", () => {
  const html = renderToStaticMarkup(createElement(MachineCapabilities, { machine: { environmentId: "remote", label: "Remote", local: false, conversations: true }, peers: { ...peers, denial: "Acme does not allow connecting from other devices." }, pair: () => {} }));
  assert.match(html, /disabled=""/); assert.match(html, /Acme/);
});

test("Agent chips name the access, and each removal states what it removes and what stays", () => {
  assert.equal(agentChipLabel({ status: "reachable", access: "auto" }), "Agents (Auto)");
  assert.equal(agentChipLabel({ status: "reachable", access: "read-only" }), "Agents (Read only)");
  assert.equal(agentChipLabel({ status: "expired", access: "auto" }), "Agents (expired)");
  const text = removalConsequences({ label: "GPU box" });
  assert.match(text.conversations, /GPU box’s conversations/); assert.match(text.conversations, /Nothing is deleted/); assert.match(text.conversations, /agents keep/);
  assert.match(text.agents, /can no longer launch or drive threads on GPU box/); assert.match(text.agents, /conversations stay/);
});
