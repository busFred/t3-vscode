/** VS Code adapter for typed UI intents. Never exposes a generic T3 RPC tunnel. */
import type * as vscode from "vscode";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Events, isObject, paramsObject, stringParam, validateRpcMessage, type BridgeEvent, type HostStateSnapshot, type RpcResult } from "../shared/bridge.js";
import { SIDEBAR_VIEW_ID, type HostState } from "./hostState.js";

export class WebviewRegistry {
  private readonly webviews = new Map<string, vscode.Webview>();
  private readonly ready = new Set<string>();
  private readonly pending = new Map<string, Array<{ event: BridgeEvent; data: unknown }>>();
  private focused = SIDEBAR_VIEW_ID;
  get focusedViewId(): string { return this.webviews.has(this.focused) ? this.focused : SIDEBAR_VIEW_ID; }
  focus(id: string): void { if (this.webviews.has(id)) this.focused = id; }
  add(id: string, webview: vscode.Webview): void { this.webviews.set(id, webview); this.ready.delete(id); }
  remove(id: string): void { this.webviews.delete(id); this.ready.delete(id); this.pending.delete(id); if (this.focused === id) this.focused = SIDEBAR_VIEW_ID; }
  postWhenReady(id: string, event: BridgeEvent, data: unknown): void {
    if (this.ready.has(id)) { void this.webviews.get(id)?.postMessage({ event, data }); return; }
    const queue = this.pending.get(id) ?? []; queue.push({ event, data }); this.pending.set(id, queue);
  }
  markReady(id: string): void {
    const webview = this.webviews.get(id); if (!webview) return;
    this.ready.add(id);
    const queue = this.pending.get(id); this.pending.delete(id);
    for (const message of queue ?? []) void webview.postMessage(message);
  }
  pushStates(stateForView: (viewId: string) => HostStateSnapshot): void {
    for (const [viewId, webview] of this.webviews) {
      void webview.postMessage({ event: Events.stateChanged, data: stateForView(viewId) });
    }
  }
}
export class BridgeHandler {
  private readonly hostState: HostState;
  private readonly registry: WebviewRegistry;
  private readonly showSettings: () => PromiseLike<unknown>;
  constructor(hostState: HostState, registry: WebviewRegistry, showSettings: () => PromiseLike<unknown> = async () => (await import("vscode")).commands.executeCommand("workbench.action.openSettings", "@ext:t3-vscode.t3-vscode")) { this.hostState = hostState; this.registry = registry; this.showSettings = showSettings; }
  attach(webview: vscode.Webview, viewId: string): void {
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(raw, viewId).then(async (result) => {
        await webview.postMessage(result);
        if (!result.error && isObject(raw) && raw.method === "getState") this.registry.markReady(viewId);
      });
    });
  }
  private async handle(raw: unknown, viewId: string): Promise<RpcResult> {
    const message = validateRpcMessage(raw);
    if (!message) return { id: isObject(raw) && typeof raw.id === "string" ? raw.id : "", error: "Invalid bridge request." };
    try {
      // Identity is captured by the host, never supplied by a renderer.
      this.hostState.snapshot(viewId);
      const params = message.params === undefined ? {} : paramsObject(message.params);
      const id = () => stringParam(params, "threadId");
      switch (message.method) {
        case "getState": break;
        case "focusView": this.registry.focus(viewId); break;
        case "loadArchive": await this.hostState.loadArchive(); break;
        case "selectThread": await this.hostState.selectThread(id(), viewId); break;
        case "newThread": await this.hostState.newThread(params.projectId === undefined ? undefined : stringParam(params, "projectId"), viewId); break;
        case "chooseProject": await this.hostState.chooseProject(params.projectId === undefined ? undefined : stringParam(params, "projectId"), viewId); break;
        case "sendMessage": await this.hostState.sendMessage(stringParam(params, "text"), params.threadId === undefined ? undefined : id(), viewId); break;
        case "reconnect": await this.hostState.reconnect(); break;
        case "startPairing": await this.hostState.pairNow(); break;
        case "setModel": await this.hostState.setModel(params.threadId === undefined ? undefined : id(), params.modelSelection, viewId); break;
        case "setModelOption": await this.hostState.setModelOption(params.threadId === undefined ? undefined : id(), stringParam(params, "optionId"), params.value, viewId); break;
        case "toggleFavoriteModel": await this.hostState.toggleFavoriteModel(stringParam(params, "instanceId"), stringParam(params, "model")); break;
        case "setModes": await this.hostState.setModes(params.threadId === undefined ? undefined : id(), params, viewId); break;
        case "openSettings": await this.showSettings(); break;
        case "interrupt": await this.hostState.interrupt(id()); break;
        case "respondToRequest": {
          if (params.decision !== undefined && typeof params.decision !== "string") throw new Error("Invalid approval decision.");
          if (params.answers !== undefined && !isObject(params.answers)) throw new Error("Invalid answers.");
          await this.hostState.respondToRequest({ threadId: id(), requestId: stringParam(params, "requestId"),
            ...(params.decision !== undefined ? { decision: params.decision } : {}),
            ...(isObject(params.answers) ? { answers: params.answers } : {}) });
          break;
        }
        case "dismissRequest": await this.hostState.dismissRequest(id(), stringParam(params, "requestId")); break;
        case "loadHistory": await this.hostState.loadHistory(id()); break;
        case "loadItemDetail": await this.hostState.loadItemDetail(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId")); break;
        case "threadAction": await this.hostState.threadAction(id(), stringParam(params, "action"), typeof params.title === "string" ? params.title : undefined); break;
        case "openInTab": await (await import("vscode")).commands.executeCommand("t3-vscode.openInTab"); break;
        case "copyText": {
          if (typeof params.text !== "string") throw new Error("Invalid text.");
          await (await import("vscode")).env.clipboard.writeText(params.text); break;
        }
        case "openLink": await this.openLink(stringParam(params, "href"), typeof params.threadId === "string" ? params.threadId : undefined); break;
      }
      return { id: message.id, result: this.hostState.snapshot(viewId) };
    } catch (cause) { return { id: message.id, error: cause instanceof Error ? cause.message : String(cause) }; }
  }
  private async openLink(href: string, threadId?: string): Promise<void> {
    const vscode = await import("vscode");
    if (/^https?:\/\//i.test(href)) { await vscode.env.openExternal(vscode.Uri.parse(href)); return; }
    let target = href.startsWith("file:") ? href : decodeURIComponent(href);
    const location = /(?::(\d+)(?::(\d+))?|#L(\d+))$/.exec(target);
    if (location) target = target.slice(0, location.index);
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith("file:")) throw new Error("Unsupported link type.");
    const path = target.startsWith("file:") ? fileURLToPath(target) : target;
    const cwd = this.hostState.workspaceForThread(threadId);
    if (!isAbsolute(path) && !cwd) throw new Error("This thread has no workspace for relative file links.");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(isAbsolute(path) ? path : resolve(cwd!, path)));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (location) {
      const position = new vscode.Position(Math.max(0, Number(location[1] ?? location[3]) - 1), Math.max(0, Number(location[2] ?? 1) - 1));
      editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position));
    }
  }
  pushState(): void { this.registry.pushStates((viewId) => this.hostState.snapshot(viewId)); }
}
