import { McpAppCallToolInput, McpAppToolInfoInput, McpAppReadResourceInput, McpAppUpdateModelContextInput } from "@t3tools/contracts";
import { mcpResourceBytes } from "@t3tools/client-runtime/mcp-apps";
import type { McpAppReference } from "@t3tools/shared/mcpApp";
import * as Schema from "effect/Schema";
import type { T3Client } from "./t3Client.js";
import { isObject, paramsObject, stringParam } from "../shared/bridge.js";

export interface McpAppNativePort {
  confirm(message: string): Promise<boolean>;
  openLink(url: string): Promise<void>;
  saveFile(name: string, bytes: Uint8Array): Promise<void>;
}
export type McpAppTransport = Pick<T3Client, "mcpAppCallTool" | "mcpAppToolInfo" | "mcpAppReadResource" | "mcpAppUpdateModelContext">;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** Keep RPC authority in the host: app-supplied fields cannot replace validated scope. */
export async function relayMcpAppRequest(client: McpAppTransport, scope: { threadId: string; itemId: string; conversationThreadId: string }, app: McpAppReference,
  method: string, raw: unknown, native: McpAppNativePort & { sendMessage(text: string): Promise<void> }) {
  const params = paramsObject(raw);
  const input = { ...params, ...scope };
  const ask = async (message: string) => { if (!await native.confirm(message)) throw new Error("Declined by the user."); };
  switch (method) {
    case "tools/info": return client.mcpAppToolInfo(Schema.decodeUnknownSync(McpAppToolInfoInput)(input));
    case "tools/call": {
      const call = Schema.decodeUnknownSync(McpAppCallToolInput)(input);
      const info = await client.mcpAppToolInfo({ threadId: call.threadId, itemId: call.itemId, name: call.name });
      if (!info.callable) throw new Error("This app cannot call that tool.");
      if (!info.readOnly) await ask(`Allow ${app.server} to run ${info.title ?? call.name}?\n${JSON.stringify(call.arguments, null, 2)}`);
      return client.mcpAppCallTool(call);
    }
    case "resources/read": return client.mcpAppReadResource(Schema.decodeUnknownSync(McpAppReadResourceInput)(input));
    case "ui/update-model-context": return client.mcpAppUpdateModelContext(Schema.decodeUnknownSync(McpAppUpdateModelContextInput)(input));
    case "ui/open-link": {
      const url = stringParam(params, "url");
      if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links can be opened.");
      await native.openLink(url); return;
    }
    case "ui/message": {
      const text = stringParam(params, "text").trim();
      if (!text) throw new Error("ui/message needs non-empty text.");
      await ask(`Send this message from ${app.server}?\n${text}`);
      await native.sendMessage(text); return;
    }
    case "ui/download-file": {
      const files = params.files;
      if (!Array.isArray(files) || files.length === 0 || files.length > 32) throw new Error("Invalid app download.");
      if (!files.every((file) => isObject(file) && typeof file.name === "string" && file.name.length > 0 && file.name.length <= 200
        && !/[\\/:*?"<>|\x00-\x1f]/.test(file.name) && file.name !== "." && file.name !== "..")) throw new Error("Invalid app download name.");
      await ask(`Save ${files.map((file) => file.name).join(", ")} from ${app.server}?`);
      for (const file of files) {
        let bytes: Uint8Array | undefined;
        if (Array.isArray(file.bytes) && file.bytes.length <= MAX_DOWNLOAD_BYTES && file.bytes.every((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) bytes = Uint8Array.from(file.bytes);
        else if (typeof file.uri === "string") {
          const result = await client.mcpAppReadResource(Schema.decodeUnknownSync(McpAppReadResourceInput)({ ...scope, uri: file.uri }));
          bytes = mcpResourceBytes(result.contents[0]);
        }
        if (!bytes || bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`${file.name} has no contents or is too large to save.`);
        await native.saveFile(file.name, bytes);
      }
      return;
    }
    default: throw new Error(`Unsupported MCP app method: ${method}`);
  }
}
