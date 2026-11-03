import type { McpAppCallToolResult, McpAppHost } from "@t3tools/client-runtime/mcp-apps";
import type { McpAppToolInfo, McpAppReadResourceResult } from "@t3tools/contracts";

/** Explicit app intents; source and conversation identities are validated by the host. */
export interface McpAppRequests {
  "tool-call": { input: Record<string, never>; output: Parameters<McpAppHost["setToolCall"]>[0] };
  "tools/info": { input: { name: string }; output: McpAppToolInfo };
  "tools/call": { input: { name: string; arguments: Record<string, unknown> }; output: McpAppCallToolResult };
  "resources/read": { input: { uri: string }; output: McpAppReadResourceResult };
  "ui/update-model-context": { input: { content?: ReadonlyArray<unknown>; structuredContent?: Record<string, unknown> }; output: void };
  "ui/message": { input: { text: string }; output: void };
  "ui/open-link": { input: { url: string }; output: void };
  "ui/download-file": { input: { files: ReadonlyArray<{ name: string; bytes?: ReadonlyArray<number>; uri?: string }> }; output: void };
}
export type McpAppRequest = { [M in keyof McpAppRequests]: { method: M; params: McpAppRequests[M]["input"] } }[keyof McpAppRequests];
