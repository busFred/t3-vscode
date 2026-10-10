import type { ScheduledTaskEditorRequest } from "../shared/scheduledTasks.js";
import { parseSearchFilters } from "../shared/sessionSearch.js";
/** VS Code adapter for typed UI intents. Never exposes a generic T3 RPC tunnel. */
import type * as vscode from "vscode";
import { Events, isObject, paramsObject, stringParam, validateRpcMessage, type BridgeEvent, type HostStateSnapshot, type RpcResult } from "../shared/bridge.js";
import { SIDEBAR_VIEW_ID, type HostState } from "./hostState.js";
import { resolveChatFileLink } from "./fileLinks.js";
import type { TurnDiff, TurnDiffFile } from "./turnDiff.js";
import type { ReviewDiffFileContentsResult } from "@t3tools/contracts";
import { parseDraftTransfer, type DraftTransfer } from "../shared/viewDraft.js";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@t3tools/contracts";
import { searchPreferencePatch } from "../shared/sessionSearchPresentation.js";

export class WebviewRegistry {
  private readonly webviews = new Map<string, vscode.Webview>();
  private readonly chatViews = new Set<string>();
  private readonly ready = new Set<string>();
  private readonly pending = new Map<string, Array<{ event: BridgeEvent; data: unknown }>>();
  private focused = SIDEBAR_VIEW_ID;
  private readonly focusListeners = new Set<() => void>();
  get focusedViewId(): string { return this.chatViews.has(this.focused) ? this.focused : SIDEBAR_VIEW_ID; }
  focus(id: string): void { if (this.chatViews.has(id) && this.focused !== id) { this.focused = id; this.focusListeners.forEach((listener) => listener()); } }
  onDidFocusView(listener: () => void): () => void { this.focusListeners.add(listener); return () => this.focusListeners.delete(listener); }
  add(id: string, webview: vscode.Webview, acceptsChatFocus = true): void { this.webviews.set(id, webview); if (acceptsChatFocus) this.chatViews.add(id); else this.chatViews.delete(id); this.ready.delete(id); }
  remove(id: string): void { this.webviews.delete(id); this.chatViews.delete(id); this.ready.delete(id); this.pending.delete(id); if (this.focused === id) { this.focused = SIDEBAR_VIEW_ID; this.focusListeners.forEach((listener) => listener()); } }
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
  private readonly prompts: { rename: (title: string) => PromiseLike<string | undefined>; confirmDelete: (title: string) => PromiseLike<boolean> };
  private readonly openDiff: (diff: TurnDiff, load: (file: TurnDiffFile) => Promise<ReviewDiffFileContentsResult>, path?: string) => Promise<void>;
  private readonly viewActions: { editScheduledTask?: (request: ScheduledTaskEditorRequest) => PromiseLike<unknown> | unknown; openInTab?: (viewId: string, transfer?: DraftTransfer) => PromiseLike<unknown> | unknown; newChatTab?: (viewId: string) => PromiseLike<unknown> | unknown; showUsage?: (viewId: string, accountKey?: string) => PromiseLike<unknown> | unknown; configureUsage?: () => PromiseLike<unknown> };
  constructor(hostState: HostState, registry: WebviewRegistry, showSettings: () => PromiseLike<unknown> = async () => (await import("vscode")).commands.executeCommand("workbench.action.openSettings", "@ext:hungtienhuang.t3-vscode"),
    prompts = {
      rename: async (title: string): Promise<string | undefined> => (await import("vscode")).window.showInputBox({ title: "Rename thread", value: title, validateInput: (value) => value.trim() ? null : "Enter a title." }),
      confirmDelete: async (title: string): Promise<boolean> => (await (await import("vscode")).window.showWarningMessage(`Delete "${title}"?`, { modal: true }, "Delete thread")) === "Delete thread",
    }, openDiff: BridgeHandler["openDiff"] = async () => { throw new Error("Native diff editor is unavailable."); },
    viewActions: {
      editScheduledTask?: (request: ScheduledTaskEditorRequest) => PromiseLike<unknown> | unknown;
      openInTab?: (viewId: string, transfer?: DraftTransfer) => PromiseLike<unknown> | unknown;
      newChatTab?: (viewId: string) => PromiseLike<unknown> | unknown;
      showUsage?: (viewId: string, accountKey?: string) => PromiseLike<unknown> | unknown;
      configureUsage?: () => PromiseLike<unknown>;
    } = {}) { this.hostState = hostState; this.registry = registry; this.showSettings = showSettings; this.prompts = prompts; this.openDiff = openDiff; this.viewActions = viewActions; }
  async performThreadAction(id: string, action: string, title?: string, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    const thread = this.hostState.snapshot(viewId).threads.find((thread) => thread.id === id);
    if (!thread) throw new Error("This thread is not available in the current workspace.");
    if (action === "rename" && title === undefined) {
      title = await this.prompts.rename(thread.title);
      if (title === undefined) return;
    }
    if (action === "delete" && !await this.prompts.confirmDelete(thread.title)) return;
    // A native prompt may stay open after its originating chat tab has closed.
    this.hostState.snapshot(viewId);
    await this.hostState.threadAction(id, action, title);
  }
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
        case "searchSession": {
          if (typeof params.query !== "string" || typeof params.caseSensitive !== "boolean" || typeof params.wholeWord !== "boolean" || !["all", "messages"].includes(String(params.scope))) throw new Error("Invalid session search options.");
          this.hostState.searchSession(id(), { query: params.query, caseSensitive: params.caseSensitive, wholeWord: params.wholeWord, scope: params.scope as "all" | "messages", ...parseSearchFilters(params) }, viewId); break;
        }
        case "cancelSessionSearch": this.hostState.cancelSessionSearch(viewId); break;
        case "setSearchPreferences": await this.hostState.setSearchPreferences(searchPreferencePatch(params)); break;
        case "sessionSearchPreviews": {
          if (!Array.isArray(params.matchIds) || params.matchIds.length > 50 || !params.matchIds.every((value) => typeof value === "string" && value.length <= 2048)) throw new Error("Invalid search preview request.");
          return { id: message.id, result: this.hostState.sessionSearchPreviews(id(), stringParam(params, "query"), params.matchIds, viewId) };
        }
        case "revealSessionMatch": this.hostState.revealSessionMatch(stringParam(params, "matchId"), viewId); break;
        case "refreshScheduledTasks": await this.hostState.refreshScheduledTasks(); break;
        case "saveScheduledTask": await this.hostState.saveScheduledTask(params); break;
        case "setScheduledTaskEnabled": await this.hostState.setScheduledTaskEnabled(stringParam(params, "taskId"), stringParam(params, "projectId"), params.enabled); break;
        case "runScheduledTask": await this.hostState.runScheduledTask(stringParam(params, "taskId"), stringParam(params, "projectId")); break;
        case "editScheduledTask": {
          const request = this.hostState.scheduledTaskEditorRequest(params);
          if (this.viewActions.editScheduledTask) await this.viewActions.editScheduledTask(request);
          else this.registry.postWhenReady(SIDEBAR_VIEW_ID, Events.editScheduledTask, request);
          break;
        }
        case "getState": break;
        case "searchThreads": {
          if (typeof params.query !== "string") throw new Error("Invalid search query.");
          return { id: message.id, result: await this.hostState.searchThreads(params.query, viewId) };
        }
        case "composerSuggestions": {
          if (typeof params.query !== "string" || typeof params.atPromptStart !== "boolean") throw new Error("Invalid composer query.");
          return { id: message.id, result: await this.hostState.composerSuggestions(stringParam(params, "kind"), params.query, params.atPromptStart, viewId) };
        }
        case "restoreComposerDraft": return { id: message.id, result: await this.hostState.restoreComposerDraft(stringParam(params, "draftKey"), viewId) };
        case "saveComposerDraft": {
          const key = stringParam(params, "draftKey");
          const draft = parseDraftTransfer(params, key, true); if (!draft) throw new Error("Invalid draft.");
          const selection = params.selection;
          if (selection !== undefined && (!isObject(selection) || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || Number(selection.start) < 0 || Number(selection.end) < Number(selection.start))) throw new Error("Invalid draft cursor.");
          this.hostState.saveComposerDraft(key, draft.draft, selection as { start: number; end: number } | undefined, viewId);
          return { id: message.id, result: true };
        }
        case "composerState": {
          if ((params.active !== undefined && typeof params.active !== "boolean") || (params.touched !== undefined && typeof params.touched !== "boolean")) throw new Error("Invalid composer state.");
          await this.hostState.composerState(id(), params.active as boolean | undefined, params.touched === true, viewId); break;
        }
        case "uploadAttachment": {
          const base64 = stringParam(params, "base64");
          if (base64.length > Math.ceil(PROVIDER_SEND_TURN_MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("Invalid attachment data or file too large.");
          const bytes = Buffer.from(base64, "base64");
          return { id: message.id, result: await this.hostState.uploadAttachment(stringParam(params, "name"), stringParam(params, "mimeType"), bytes, viewId, params.threadId === undefined ? undefined : id(), params.slotKey === undefined ? undefined : stringParam(params, "slotKey")) };
        }
        case "pickAttachments": {
          const vscode = await import("vscode");
          const files = await vscode.window.showOpenDialog({ title: "Attach files to T3 VSCode", openLabel: "Attach", canSelectFiles: true, canSelectFolders: false, canSelectMany: true });
          const attachments = []; const errors: string[] = [];
          const threadId = this.hostState.snapshot(viewId).activeThreadId;
          for (const file of files ?? []) {
            try {
              if (file.scheme !== "file") throw new Error("Choose a file on this machine.");
              const info = await stat(file.fsPath);
              if (!info.isFile() || info.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) throw new Error("Choose a file of at most 50 MB.");
              attachments.push(await this.hostState.uploadAttachment(basename(file.fsPath), "", await readFile(file.fsPath), viewId, threadId));
            } catch (cause) { errors.push(`${basename(file.fsPath)}: ${cause instanceof Error ? cause.message : String(cause)}`); }
          }
          return { id: message.id, result: { attachments, errors } };
        }
        case "releaseAttachment": await this.hostState.releaseAttachment(stringParam(params, "attachmentId"), viewId); break;
        case "chatAsset": {
          const reference = paramsObject(params.reference);
          const kind = stringParam(reference, "kind");
          const assetReference = kind === "html" ? { kind } as const : kind === "attachment" ? { kind, attachmentId: stringParam(reference, "attachmentId") } as const : kind === "media" ? { kind, path: stringParam(reference, "path") } as const : null;
          if (!assetReference) throw new Error("Unsupported chat asset.");
          return { id: message.id, result: await this.hostState.chatAsset(id(), { sourceThreadId: stringParam(params, "sourceThreadId"), itemId: stringParam(params, "itemId") }, assetReference, viewId) };
        }
        case "refreshUsage": await this.hostState.refreshUsage(); break;
        case "turnDiffSummary": {
          const diff = await this.hostState.prepareTurnDiff(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId"), viewId);
          const summarize = (files: typeof diff.files) => files.map((file) => ({ path: file.newPath, additions: file.additions, deletions: file.deletions }));
          return { id: message.id, result: { files: summarize(diff.files) } };
        }
        case "openTurnDiff": {
          if (params.path !== undefined && typeof params.path !== "string") throw new Error("Invalid diff path.");
          const diff = await this.hostState.prepareTurnDiff(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId"), viewId);
          await this.openDiff(diff, (file) => this.hostState.loadTurnDiffFile(diff, file, viewId), params.path as string | undefined); break;
        }
        case "focusView": this.registry.focus(viewId); break;
        case "loadArchive": await this.hostState.loadArchive(); break;
        case "selectThread": await this.hostState.selectThread(id(), viewId); break;
        case "newThread": await this.hostState.newThread(params.projectId === undefined ? undefined : stringParam(params, "projectId"), viewId); break;
        case "newChatTab": {
          if (!this.viewActions.newChatTab) throw new Error("New chat tabs are unavailable in this view.");
          await this.viewActions.newChatTab(viewId); break;
        }
        case "chooseProject": await this.hostState.chooseProject(params.projectId === undefined ? undefined : stringParam(params, "projectId"), viewId); break;
        case "sendMessage": {
          if (params.attachmentIds !== undefined && (!Array.isArray(params.attachmentIds) || params.attachmentIds.length > 100 || !params.attachmentIds.every((id) => typeof id === "string"))) throw new Error("Invalid message attachments.");
          const references = params.attachmentReferences;
          if (references !== undefined && (!Array.isArray(references) || references.length > 100 || !references.every((entry) => isObject(entry) && typeof entry.contextId === "string" && typeof entry.attachmentId === "string"))) throw new Error("Invalid inline attachments.");
          await this.hostState.sendMessage(stringParam(params, "text"), params.threadId === undefined ? undefined : id(), viewId, params.mode === undefined ? "auto" : stringParam(params, "mode"), params.attachmentIds as string[] | undefined, references as Array<{ contextId: string; attachmentId: string }> | undefined); break;
        }
        case "queueAction": {
          if (params.beforeRunId !== undefined && params.beforeRunId !== null && typeof params.beforeRunId !== "string") throw new Error("Invalid queue destination.");
          await this.hostState.queueAction(id(), stringParam(params, "action"), typeof params.runId === "string" ? params.runId : undefined, typeof params.text === "string" ? params.text : undefined,
            params.beforeRunId as string | null | undefined, viewId); break;
        }
        case "reconnect": await this.hostState.reconnect(); break;
        case "startPairing": await this.hostState.pairNow(); break;
        case "setModel": await this.hostState.setModel(params.threadId === undefined ? undefined : id(), params.modelSelection, viewId); break;
        case "setModelOption": await this.hostState.setModelOption(params.threadId === undefined ? undefined : id(), stringParam(params, "optionId"), params.value, viewId); break;
        case "toggleFavoriteModel": await this.hostState.toggleFavoriteModel(stringParam(params, "instanceId"), stringParam(params, "model")); break;
        case "setModelVisibility": await this.hostState.setModelVisibility(stringParam(params, "instanceId"), stringParam(params, "model"), params.visible); break;
        case "reorderModel": await this.hostState.reorderModel(stringParam(params, "instanceId"), stringParam(params, "model"), params.before, params.order); break;
        case "moveModel": await this.hostState.moveModel(stringParam(params, "instanceId"), stringParam(params, "model"), params.direction); break;
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
        case "threadAction":
          if (params.title !== undefined && typeof params.title !== "string") throw new Error("Invalid thread title.");
          await this.performThreadAction(id(), stringParam(params, "action"), typeof params.title === "string" ? params.title : undefined, viewId); break;
        case "forkFromResponse": await this.hostState.forkFromResponse(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId"), viewId); break;
        case "openInTab": {
          const transfer = parseDraftTransfer(params, this.hostState.snapshot(viewId).activeThreadId ?? "new");
          if (this.viewActions.openInTab) await this.viewActions.openInTab(viewId, transfer);
          else await (await import("vscode")).commands.executeCommand("t3-vscode.openExistingChatInTab", viewId);
          break;
        }
        case "configureUsage":
          if (this.viewActions.configureUsage) await this.viewActions.configureUsage();
          else await (await import("vscode")).commands.executeCommand("t3-vscode.configureUsage");
          break;
        case "showUsage":
          if (params.accountKey !== undefined && typeof params.accountKey !== "string") throw new Error("Invalid usage account.");
          if (this.viewActions.showUsage) await this.viewActions.showUsage(viewId, params.accountKey as string | undefined);
          else await (await import("vscode")).commands.executeCommand("t3-vscode.showUsage", params.accountKey);
          break;
        case "openWebUi": await (await import("vscode")).env.openExternal((await import("vscode")).Uri.parse(this.hostState.webUiUrl(viewId))); break;
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
    const target = resolveChatFileLink(href, this.hostState.workspaceForThread(threadId));
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.path));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (target.line) {
      const position = new vscode.Position(target.line - 1, (target.column ?? 1) - 1);
      const end = target.endLine ? new vscode.Position(target.endLine - 1, target.endColumn === undefined ? document.lineAt(Math.min(document.lineCount - 1, target.endLine - 1)).text.length : target.endColumn - 1) : position;
      editor.selection = new vscode.Selection(position, end); editor.revealRange(new vscode.Range(position, end));
    }
  }
  pushState(): void { this.registry.pushStates((viewId) => this.hostState.snapshot(viewId)); }
}
