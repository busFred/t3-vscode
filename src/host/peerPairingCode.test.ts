import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mintPeerPairingCode } from "./peerPairingCode";

test("Mint HTTP contract uses target bearer session and access-specific scopes; failures are masked", async t => {
  const requests: Array<{ url: string | undefined; authorization: string | undefined; body: unknown }> = [];
  let fail = false;
  const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += String(chunk);
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(fail ? 500 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(fail ? { message: "private-minted-code" } : { id: "pairing-1", credential: "private-minted-code", label: "T3 Code link", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal(await mintPeerPairingCode(origin, "target-session", "read-only"), "private-minted-code");
  assert.equal(requests[0]?.url, "/api/auth/pairing-token");
  assert.equal(requests[0]?.authorization, "Bearer target-session");
  assert.deepEqual(requests[0]?.body, { label: "T3 Code link", scopes: ["orchestration:read"] });
  fail = true;
  await assert.rejects(mintPeerPairingCode(origin, "target-session", "read-only"), error => error instanceof Error && !error.message.includes("private-minted-code") && !error.message.includes("target-session"));
});
