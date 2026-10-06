/**
 * Webview-side bridge client (singleton — acquireVsCodeApi may only be called
 * once per session). Mirrors kimi-code/apps/vscode webview-ui bridge service:
 * request/response correlated by id, events dispatched to handlers.
 */

import { Events, Methods, type BridgeEvent, type RpcMethod, type RpcResult } from "../shared/bridge";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T;
  setState<T>(state: T): void;
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

class Bridge {
  private readonly api: VsCodeApi | null =
    typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

  private requestId = 0;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  private readonly eventHandlers = new Map<string, Set<(data: unknown) => void>>();

  constructor() {
    window.addEventListener("message", this.handleMessage);
  }

  private handleMessage = (event: MessageEvent): void => {
    const msg = event.data as RpcResult & { event?: BridgeEvent; data?: unknown };
    if (msg && typeof msg === "object" && typeof msg.id === "string" && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(entry.timeout);
      if (msg.error !== undefined) entry.reject(new Error(msg.error));
      else entry.resolve(msg.result);
      return;
    }
    if (msg && typeof msg === "object" && typeof msg.event === "string") {
      this.eventHandlers.get(msg.event)?.forEach((handler) => handler(msg.data));
    }
  };

  request<T>(method: RpcMethod, params?: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (!this.api) {
      return Promise.reject(new Error("Bridge is not running inside a VS Code webview."));
    }
    const id = `${++this.requestId}_${Date.now()}`;
    const api = this.api;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      api.postMessage({ id, method, params } as { id: string; method: string; params?: unknown });
    });
  }

  on(event: BridgeEvent, handler: (data: unknown) => void): () => void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }
  readViewState<T>(): T | undefined { return this.api?.getState<T>(); }
  saveViewState<T>(state: T): void { this.api?.setState(state); }
}

export const bridge = new Bridge();
export { Events, Methods };
