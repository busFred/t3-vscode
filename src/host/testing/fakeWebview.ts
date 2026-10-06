/** In-memory VS Code postMessage adapter; exercises the real host bridge without launching VS Code. */
import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { HostStateSnapshot, RpcMethod, RpcMessage, RpcResult } from "../../shared/bridge.js";

export class FakeWebview {
  readonly webview: vscode.Webview;
  readonly messages: unknown[] = [];
  onPostMessage: ((message: unknown) => void) | undefined;
  private handler: ((message: unknown) => void) | undefined;
  private readonly pending = new Map<string, (result: RpcResult) => void>();
  constructor() {
    this.webview = {
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        this.handler = handler; return { dispose: () => { this.handler = undefined; } };
      },
      postMessage: async (message: RpcResult) => {
        this.messages.push(message); this.onPostMessage?.(message);
        if (typeof message.id === "string") this.pending.get(message.id)?.(message);
        return true;
      },
    } as unknown as vscode.Webview;
  }
  receive(message: RpcMessage): Promise<RpcResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new Error("Bridge fixture request timed out.")); }, 5000);
      this.pending.set(message.id, (result) => { clearTimeout(timer); this.pending.delete(message.id); resolve(result); });
      this.handler?.(message);
    });
  }
  async request(method: RpcMethod, params?: unknown): Promise<HostStateSnapshot> {
    const result = await this.receive({ id: randomUUID(), method, params });
    if (result.error !== undefined) throw new Error(result.error);
    return result.result as HostStateSnapshot;
  }
}
