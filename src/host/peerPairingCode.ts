/** Host-only minting: credentials never cross the webview bridge. */
import { mcpClientScopes, AuthMcpClientAccess } from "@t3tools/contracts";
import { makeEnvironmentHttpApiGroupClient } from "@t3tools/client-runtime/rpc/http";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";

export async function mintPeerPairingCode(origin: string, token: string, access: AuthMcpClientAccess): Promise<string> {
  try {
    const checkedAccess = Schema.decodeUnknownSync(AuthMcpClientAccess)(access);
    return await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiGroupClient(origin, "auth");
      const result = yield* client.pairingCredential({ headers: { authorization: `Bearer ${token}` }, payload: { label: "T3 Code link", scopes: mcpClientScopes(checkedAccess) } });
      return result.credential;
    }).pipe(Effect.timeout("8 seconds")), FetchHttpClient.layer));
  } catch { throw new Error("Could not get a pairing code from there. Paste a code from there instead."); }
}
