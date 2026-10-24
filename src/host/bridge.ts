import { parseWorktreeChoice } from "./worktrees.js";
import { runWorktreeNativeAction, type WorktreeNativePort } from "./worktreeNativeActions.js";
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
  private readonly viewActions: { openSessionTab?: (threadId: string, preview: boolean) => PromiseLike<unknown>; keepTab?: (viewId: string) => PromiseLike<unknown>; closeTaskTab?: (viewId: string) => void; editScheduledTask?: (request: ScheduledTaskEditorRequest, preview?: boolean) => PromiseLike<unknown> | unknown; openInTab?: (viewId: string, transfer?: DraftTransfer) => PromiseLike<unknown> | unknown; newChatTab?: (viewId: string) => PromiseLike<unknown> | unknown; newWorktreeChat?: (viewId: string, projectId: string, choice: unknown) => PromiseLike<unknown> | unknown; showUsage?: (viewId: string, accountKey?: string) => PromiseLike<unknown> | unknown; configureUsage?: () => PromiseLike<unknown>; environmentAction?: (action: string, environmentId?: string) => PromiseLike<unknown> };
  constructor(hostState: HostState, registry: WebviewRegistry, showSettings: () => PromiseLike<unknown> = async () => (await import("vscode")).commands.executeCommand("workbench.action.openSettings", "@ext:hungtienhuang.t3-vscode"),
    prompts = {
      rename: async (title: string): Promise<string | undefined> => (await import("vscode")).window.showInputBox({ title: "Rename thread", value: title, validateInput: (value) => value.trim() ? null : "Enter a title." }),
      confirmDelete: async (title: string): Promise<boolean> => (await (await import("vscode")).window.showWarningMessage(`Delete "${title}"?`, { modal: true }, "Delete thread")) === "Delete thread",
    }, openDiff: BridgeHandler["openDiff"] = async () => { throw new Error("Native diff editor is unavailable."); },
    viewActions: {
      openSessionTab?: (threadId: string, preview: boolean) => PromiseLike<unknown>;
      keepTab?: (viewId: string) => PromiseLike<unknown>;
      closeTaskTab?: (viewId: string) => void;
      editScheduledTask?: (request: ScheduledTaskEditorRequest, preview?: boolean) => PromiseLike<unknown> | unknown;
      openInTab?: (viewId: string, transfer?: DraftTransfer) => PromiseLike<unknown> | unknown;
      newChatTab?: (viewId: string) => PromiseLike<unknown> | unknown; newWorktreeChat?: (viewId: string, projectId: string, choice: unknown) => PromiseLike<unknown> | unknown;
      showUsage?: (viewId: string, accountKey?: string) => PromiseLike<unknown> | unknown;
      configureUsage?: () => PromiseLike<unknown>;
      environmentAction?: (action: string, environmentId?: string) => PromiseLike<unknown>;
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
        case "refreshWorktrees": await this.hostState.refreshWorktrees(params.cleanupEnvironments === true); break;
        case "configureWorktree": await this.hostState.configureWorktree(params.choice, params.projectId === undefined ? undefined : stringParam(params, "projectId"), viewId); break;
        case "newWorktreeChat": {
          if (!this.viewActions.newWorktreeChat) throw new Error("Worktree chat tabs are unavailable.");
          await this.viewActions.newWorktreeChat(viewId, stringParam(params, "projectId"), parseWorktreeChoice(params.choice)); break;
        }
        case "saveWorktreeSettings": {
          if (!this.hostState.worktrees) throw new Error("Worktree support is unavailable.");
          await this.hostState.worktrees.saveSettings(stringParam(params, "projectId"), params.settings); break;
        }
        case "worktreeReview": {
          if (!this.hostState.worktrees) throw new Error("Worktree support is unavailable.");
          if (params.baseRef !== undefined && typeof params.baseRef !== "string") throw new Error("Invalid review base.");
          return { id: message.id, result: await this.hostState.worktrees.review(stringParam(params, "projectId"), stringParam(params, "path"), params.baseRef as string | undefined) };
        }
        case "worktreeAction": {
          if (!this.hostState.worktrees) throw new Error("Worktree support is unavailable.");
          if (params.action === "continue") {
            if (typeof params.copyEdits !== "boolean") throw new Error("Choose whether to copy local edits.");
            const state = this.hostState.snapshot(viewId), thread = state.threads.find((entry) => entry.id === state.activeThreadId);
            if (!thread || thread.projectId !== stringParam(params, "projectId")) throw new Error("Choose this conversation’s project.");
            const native = this.nativeWorktreePort();
            if (await native.confirm("Continue this conversation in a new worktree?", `The conversation history stays attached. ${params.copyEdits ? "Local edits will be copied to the new checkout." : "The new checkout starts from the current branch."}`, "Continue in worktree")) await this.hostState.continueInWorktree(viewId, params.copyEdits);
          } else await runWorktreeNativeAction(this.hostState.worktrees, params, this.nativeWorktreePort(), { retry: (id) => this.hostState.retryWorktreePreparation(id) });
          break;
        }
        case "sessionBranch": {
          const threadId = stringParam(params, "threadId");
          if (params.action === "adopt") await this.hostState.adoptCheckoutBranch(threadId);
          else if (params.action === "policy") await this.hostState.setSessionBranchPolicy(threadId, params.policy ?? null);
          else if (params.action === "switch") {
            const thread = this.hostState.snapshot(viewId).threads.find((entry) => entry.id === threadId);
            if (!thread?.worktreePath || !thread.branch) throw new Error("This session does not record a branch for its checkout.");
            const detail = `Checkout: ${thread.worktreePath}\n\nThe checkout switches to ${thread.branch}. Every session using this checkout sees the switch. Uncommitted tracked changes stop the switch; commits on the current branch are kept on that branch.`;
            if (await this.nativeWorktreePort().confirm(`Switch this checkout to ${thread.branch}?`, detail, "Switch branch")) await this.hostState.switchCheckoutToSessionBranch(threadId);
          } else throw new Error("Unsupported session branch action.");
          break;
        }
        case "refreshScheduledTasks": await this.hostState.refreshScheduledTasks(); break;
        case "saveScheduledTask": await this.hostState.saveScheduledTask(params); break;
        case "setScheduledTaskEnabled": await this.hostState.setScheduledTaskEnabled(stringParam(params, "taskId"), stringParam(params, "projectId"), params.enabled); break;
        case "runScheduledTask": await this.hostState.runScheduledTask(stringParam(params, "taskId"), stringParam(params, "projectId")); break;
        case "editScheduledTask": {
          const request = this.hostState.scheduledTaskEditorRequest(params);
          if (this.viewActions.editScheduledTask) await this.viewActions.editScheduledTask(request, params.preview === true);
          else this.registry.postWhenReady(SIDEBAR_VIEW_ID, Events.editScheduledTask, request);
          break;
        }
        case "openSessionTab": {
          const threadId = stringParam(params, "threadId");
          if (this.viewActions.openSessionTab) await this.viewActions.openSessionTab(threadId, params.preview === true);
          else { await this.hostState.selectThread(threadId, viewId); await this.viewActions.openInTab?.(viewId); }
          break;
        }
        case "openTaskManager": await (await import("vscode")).commands.executeCommand("t3.webview.focus"); this.registry.postWhenReady(SIDEBAR_VIEW_ID, Events.showTaskManager, undefined); break;
        case "keepTab": await this.viewActions.keepTab?.(viewId); break;
        case "closeTaskTab": this.viewActions.closeTaskTab?.(viewId); break;
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
          if (params.touched === true) await this.viewActions.keepTab?.(viewId);
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
          const sourceThreadId = stringParam(params, "sourceThreadId"), itemId = stringParam(params, "itemId");
          const [diff, merges] = await Promise.all([
            this.hostState.prepareTurnDiff(id(), sourceThreadId, itemId, viewId).catch(() => null),
            this.hostState.turnDiffMerges(id(), sourceThreadId, itemId, viewId).catch(() => []),
          ]);
          if (!diff && !merges.length) throw new Error("This turn's diff is not available.");
          const summarize = (files: NonNullable<typeof diff>["files"]) => files.map((file) => ({ path: file.newPath, additions: file.additions, deletions: file.deletions }));
          return { id: message.id, result: { cwd: diff?.cwd ?? merges[0]!.cwd, branch: diff?.branch ?? "", files: diff ? summarize(diff.files) : [],
            ...(merges.length ? { merges: merges.map((merge) => ({ sourceThreadId: merge.sourceThreadId, sourceTitle: merge.sourceTitle, sourceBranch: merge.sourceBranch, destinationBranch: merge.destinationBranch, appliedAt: merge.appliedAt, files: merge.files })) } : {}) } };
        }
        case "openTurnDiff": {
          if (params.path !== undefined && typeof params.path !== "string") throw new Error("Invalid diff path.");
          const diff = await this.hostState.prepareTurnDiff(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId"), viewId);
          await this.openDiff(diff, (file) => this.hostState.loadTurnDiffFile(diff, file, viewId), params.path as string | undefined); break;
        }
        case "openMergeDiff": {
          const threadId = id(), appliedAt = stringParam(params, "appliedAt"), path = stringParam(params, "path");
          const merge = await this.hostState.mergePatchFile(threadId, appliedAt, path);
          const diff: TurnDiff = { threadId, title: merge.sourceTitle, turnNumber: 0, displayLabel: `Merged from ${merge.sourceTitle}`, cwd: merge.cwd, baseRef: "merge-patch", headRef: "merge-patch",
            files: [{ additions: 0, deletions: 0, oldPath: path, newPath: path, changeType: "change" }] };
          await this.openDiff(diff, async () => ({ oldContents: "This merge was applied to the working tree without a saved \"before\" snapshot; showing the recorded patch instead.", newContents: merge.patchText }));
          break;
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
        case "answerSecretRequest": {
          // Params carry the secret: validate shape only, never echo, log or retain them.
          const answer = params.answer;
          if (!isObject(answer) || (answer.type !== "save" && answer.type !== "decline")) throw new Error("Invalid secret answer.");
          if (answer.type === "save" && (typeof answer.secret !== "string" || !answer.secret.trim())) throw new Error("Enter the secret.");
          await this.hostState.answerSecretRequest({ threadId: id(), turnItemId: stringParam(params, "turnItemId"),
            answer: answer.type === "save" ? { type: "save", secret: (answer.secret as string).trim() } : { type: "decline" } });
          break;
        }
        case "dismissRequest": await this.hostState.dismissRequest(id(), stringParam(params, "requestId")); break;
        case "loadHistory": await this.hostState.loadHistory(id()); break;
        case "loadItemDetail": await this.hostState.loadItemDetail(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId")); break;
        case "threadAction":
          if (params.title !== undefined && typeof params.title !== "string") throw new Error("Invalid thread title.");
          await this.performThreadAction(id(), stringParam(params, "action"), typeof params.title === "string" ? params.title : undefined, viewId); break;
        case "forkFromResponse": await this.hostState.forkFromResponse(id(), stringParam(params, "sourceThreadId"), stringParam(params, "itemId"), viewId); break;
        case "revertConversation": {
          const threadId = id();
          const { text } = await this.hostState.revertConversation(threadId, stringParam(params, "sourceThreadId"), stringParam(params, "itemId"), viewId);
          // Attachments and inline references do not survive the rewind; the original text does.
          this.registry.postWhenReady(viewId, Events.initializeDraft, { draftKey: threadId, draft: { text, contexts: [] } });
          break;
        }
        case "dismissRewindMarker": await this.hostState.dismissRewindMarker(id(), viewId); break;
        case "restorePreview": return { id: message.id, result: await this.hostState.restorePreview(id(), stringParam(params, "sourceThreadId"), this.restoreLocator(params), viewId) };
        case "restoreFiles": {
          if (!Array.isArray(params.keep) || !params.keep.every((path) => typeof path === "string")) throw new Error("Invalid files to keep.");
          if (params.mode !== "keep" && params.mode !== "everything") throw new Error("Invalid restore mode.");
          return { id: message.id, result: await this.hostState.restoreFiles(id(), stringParam(params, "sourceThreadId"), this.restoreLocator(params), params.keep, params.mode, viewId) };
        }
        case "openRestoreDiff": {
          const result = await this.hostState.restoreDiffFile(id(), stringParam(params, "sourceThreadId"), this.restoreLocator(params), stringParam(params, "path"), viewId);
          const file: TurnDiffFile = { additions: 0, deletions: 0, oldPath: result.path, newPath: result.path, changeType: "change" };
          const diff: TurnDiff = { threadId: id(), title: "Restore preview", turnNumber: 0, displayLabel: `Restore preview · ${result.path}`, cwd: result.cwd, baseRef: "", headRef: "", files: [file] };
          await this.openDiff(diff, async () => ({ oldContents: result.oldContents, newContents: result.newContents }));
          break;
        }
        case "compareRestoredFile": {
          const result = await this.hostState.compareRestoredFile(id(), stringParam(params, "path"), stringParam(params, "yoursPath"), viewId);
          const file: TurnDiffFile = { additions: 0, deletions: 0, oldPath: result.path, newPath: result.path, changeType: "change" };
          const diff: TurnDiff = { threadId: id(), title: "Restore comparison", turnNumber: 0, displayLabel: `Restored vs. yours · ${result.path}`, cwd: result.cwd, baseRef: "", headRef: "", files: [file] };
          await this.openDiff(diff, async () => ({ oldContents: result.oldContents, newContents: result.newContents }));
          break;
        }
        case "openInTab": {
          const transfer = parseDraftTransfer(params, this.hostState.snapshot(viewId).activeThreadId ?? "new");
          if (this.viewActions.openInTab) await this.viewActions.openInTab(viewId, transfer);
          else await (await import("vscode")).commands.executeCommand("t3-vscode.openExistingChatInTab", viewId);
          break;
        }
        case "watchSessions": {
          const ids = Array.isArray(params.threadIds) ? params.threadIds.filter((id): id is string => typeof id === "string") : [];
          await this.hostState.watchSessions(ids, viewId); break;
        }
        case "environmentAction":
          if (!this.viewActions.environmentAction) throw new Error("Environments are unavailable.");
          await this.viewActions.environmentAction(stringParam(params, "action"), params.environmentId === undefined ? undefined : stringParam(params, "environmentId"));
          break;
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
        case "openLink": await this.openLink(stringParam(params, "href"), typeof params.threadId === "string" ? params.threadId : this.hostState.snapshot(viewId).activeThreadId ?? undefined); break;
      }
      return { id: message.id, result: this.hostState.snapshot(viewId) };
    } catch (cause) { return { id: message.id, error: cause instanceof Error ? cause.message : String(cause) }; }
  }
  /** A restore target is either the hovered user message, or (from a rewind marker) a checkpoint remembered directly. */
  private restoreLocator(params: Record<string, unknown>): { itemId: string } | { checkpointId: string; scopeId: string } {
    if (typeof params.itemId === "string") return { itemId: params.itemId };
    return { checkpointId: stringParam(params, "checkpointId"), scopeId: stringParam(params, "scopeId") };
  }
  private nativeWorktreePort(): WorktreeNativePort {
    return {
      confirm: async (message, detail, action) => (await (await import("vscode")).window.showWarningMessage(message, { modal: true, detail }, action)) === action,
      openWindow: async (path) => { const vscode = await import("vscode"); return vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), { forceNewWindow: true }); },
      terminal: async (command) => { const vscode = await import("vscode"); const terminal = vscode.window.createTerminal({ name: command.title, cwd: command.cwd, shellPath: command.executable, shellArgs: command.args, env: command.env }); terminal.show(); },
      openDiff: this.openDiff,
    };
  }
  private async openLink(href: string, threadId?: string): Promise<void> {
    const vscode = await import("vscode");
    if (/^https?:\/\//i.test(href)) { await vscode.env.openExternal(vscode.Uri.parse(href)); return; }
    const link = resolveChatFileLink(href, this.hostState.workspaceForThread(threadId));
    const target = { ...link, path: this.hostState.localPathForThread(threadId, link.path) };
    const uri = vscode.Uri.file(target.path);
    // The @ menu offers directories beside files, and a directory has no document to show. A link
    // that names a position is already known to be a file, so it never pays for the extra stat.
    const stat = target.line ? undefined : await Promise.resolve(vscode.workspace.fs.stat(uri)).catch(() => undefined);
    if (stat && stat.type & vscode.FileType.Directory) { await vscode.commands.executeCommand("revealInExplorer", uri); return; }
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (target.line) {
      const position = new vscode.Position(target.line - 1, (target.column ?? 1) - 1);
      const end = target.endLine ? new vscode.Position(target.endLine - 1, target.endColumn === undefined ? document.lineAt(Math.min(document.lineCount - 1, target.endLine - 1)).text.length : target.endColumn - 1) : position;
      editor.selection = new vscode.Selection(position, end); editor.revealRange(new vscode.Range(position, end));
    }
  }
  pushState(): void { this.registry.pushStates((viewId) => this.hostState.snapshot(viewId)); }
}
