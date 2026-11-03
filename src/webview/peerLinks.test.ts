import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PeerLinksState } from "../shared/peerLinks";
import { PeerLinksSection } from "./components/PeerLinksSection";
const peers: PeerLinksState = { environmentId: "local", loaded: true, machines: [], links: [{ environmentId: "build", label: "Build", access: "read-only", status: "reachable", paired: true }] };
test("Peer UI identifies T3 server links, status, access and extension pairing separately", () => {
  const html = renderToStaticMarkup(createElement(PeerLinksSection, { peers }));
  for (const text of ["Linked environments · T3 server", "reachable", "Read only", "Also paired in VS Code", "Unlink", "Link a machine"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Pairing code/);
});
test("Peer UI shows setting or policy denial and offers no link actions", () => {
  for (const denial of ["Enable Linked environments in T3 Code Settings → Labs.", "Acme does not allow connecting from other devices."]) {
    const html = renderToStaticMarkup(createElement(PeerLinksSection, { peers: { ...peers, denial } }));
    assert.ok(html.includes(denial));
    assert.doesNotMatch(html, /Unlink|Link a machine|Build|Refresh links/);
  }
});
