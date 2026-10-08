import { ComposerDraftStore, type StoredComposerDraft } from "./composerDraftStore.js";
import type { ViewDraft } from "../shared/viewDraft.js";
import type { TextSelection } from "../shared/composerAttachments.js";
/** Shared T3 connection and projections, with navigation and drafts owned by each webview. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import {
  OrchestrationV2TurnItemJson, ModelSelection as ModelSelectionSchema, type ChatAttachment, getProviderAttachmentLimitError,
  ProviderApprovalDecision, ProviderInteractionMode, RuntimeMode,
  type OrchestrationV2ShellSnapshot, type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadProjection, type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2TurnItem, type OrchestrationV2ThreadShell, type ServerConfig, type OrchestrationV2ArchivedShellSnapshot, type OrchestrationV2ArchivedShellStreamItem,
} from "@t3tools/contracts";
import * as ShellState from "@t3tools/client-runtime/state/shell";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import { derivePendingThreadRequests, createQuestionHistoryProjector } from "@t3tools/client-runtime/state/thread-requests";
import { turnItemIsWorkspacePreparation } from "@t3tools/client-runtime/state/turn-item-presentation";
import { canForkProjectedAssistantItem, deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import { mergeOlderHistoryIntoProjection, EMPTY_THREAD_HISTORY_META, applyHistoryPageMeta, type ThreadHistoryMeta } from "@t3tools/client-runtime/state/thread-history-merge";
import { resolveWorkEntryToolPresentation } from "@t3tools/client-runtime/work-log/presentation";
import { turnItemNeedsDetailFetch, turnItemOutputText } from "@t3tools/client-runtime/work-log/item-detail";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type { HostStateSnapshot, HostPhase, ModelSelection, TranscriptItem, RequestResponse, ConversationDraft, ProjectSelection, ProjectSummary, FavoriteModel, ComposerSuggestion, ThreadSearchMatch } from "../shared/bridge.js";
import { slashSuggestions } from "../shared/composerSuggestions.js";
import { hasCompleteProviderWorkspaceSnapshot } from "@t3tools/client-runtime/providerSkills";
import { threadPullRequestSearchTerms } from "@t3tools/shared/threadPullRequests";
import { turnCheckpointRange, turnDiffFiles, turnDiffFileRequest, type TurnDiff, type TurnDiffFile } from "./turnDiff.js";
import { conversationActivity } from "./conversationActivity.js";
import { pairWithServer, PairingError } from "./pairing.js";
import { connectionSetup, discoverServer, type DiscoveredServer } from "./serverDiscovery.js";
import type { ConnectionProblem, ConnectionSetup } from "../shared/connectionSetup.js";
import type { CredentialStore } from "./sessionStore.js";
import type { T3Client, Subscription } from "./t3Client.js";
import { DEFAULT_APPEARANCE, resolveAppearance, type AppearanceSettings } from "../shared/appearance.js";
import { ThreadId } from "@t3tools/contracts";
import { htmlVisual, type ChatAssetReference, type ChatAssetSource } from "../shared/chatVisuals.js";
import { resolveMessageNavigation, type MessageNavigationPlacement } from "../shared/messageNavigation.js";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { attachmentMessageContext, attachmentUploadInput, type AttachmentReference, type DraftAttachment } from "../shared/composerAttachments.js";

import { SessionSearchJob } from "./sessionSearch.js";
import type { SessionSearchOptions } from "../shared/sessionSearch.js";
import { resolveSearchPreferences, type SearchPreferences, type SessionSearchPreview } from "../shared/sessionSearchPresentation.js";
import { defaultProviderModelPreference, getProviderModelPreference, orderedProviderModels, parseModelPreferencesImport, type ModelPickerPreferences } from "../shared/modelPreferences.js";

export type HostTransport = Pick<T3Client, "connected" | "onClose" | "onConfig" | "connect" | "disconnect" | "snapshotShell" | "subscribeShell" | "subscribeThread" | "getThreadProjection" | "dispatch" | "createProject" | "ensureScratchProject" | "getHistory" | "getTurnItem" | "snapshotArchive" | "subscribeArchive" | "searchThreads" | "searchPaths" | "refreshProviders" | "getSavedTurnDiff" | "getDiffFileContents" | "createAssetUrl" | "uploadAttachment" | "deleteAttachment"> & { readonly config: Pick<ServerConfig, "providers" | "scratchWorkspaceRoot" | "usageLimitSources"> | null };
export interface HostStateOptions {
  readonly draftStore?: ComposerDraftStore;
  readonly home: string;
  readonly credentials: CredentialStore;
  readonly serverStartupHint?: string | undefined;
  readonly workspaceRoot?: () => string | null;
  readonly workspaceRoots?: () => ReadonlyArray<string>;
  readonly appearance?: () => AppearanceSettings;
  readonly messageNavigation?: () => MessageNavigationPlacement;
  readonly favoriteModels?: () => ReadonlyArray<FavoriteModel>;
  readonly saveFavoriteModels?: (favorites: ReadonlyArray<FavoriteModel>) => PromiseLike<void>;
  readonly modelPreferences?: () => ModelPickerPreferences;
  readonly saveModelPreferences?: (preferences: ModelPickerPreferences) => PromiseLike<void>;
  readonly searchPreferences?: Partial<SearchPreferences>;
  readonly saveSearchPreferences?: (preferences: SearchPreferences) => PromiseLike<void>;
  readonly pickProject?: (projects: ReadonlyArray<ProjectSummary>, supportsNoProject: boolean, workspaceRoots: ReadonlyArray<string>) => Promise<ProjectSelection | null>;
  readonly discover?: typeof discoverServer;
  readonly pair?: typeof pairWithServer;
  readonly reconnectDelayMs?: number;
}
interface ThreadState {
  projection: OrchestrationV2ThreadProjection | null;
  sequence: number;
  history: ThreadHistoryMeta;
  loading: boolean;
  subscription: Subscription | null;
}
const threadActiveRun = (projection: OrchestrationV2ThreadProjection | null | undefined) => projection ? deriveThreadQueueWorkflowState(projection).activeRun : undefined;
const blankThread = (): ThreadState => ({ projection: null, sequence: -1, history: EMPTY_THREAD_HISTORY_META, loading: true, subscription: null });
export const SIDEBAR_VIEW_ID = "sidebar";
interface ViewState {
  activeThreadId: string | undefined;
  draftProjectId: string | undefined;
  draftWorkspaceRoot: string | null | undefined;
  draftModelSelection: ModelSelection | undefined;
  draftRuntimeMode: RuntimeMode;
  draftInteractionMode: ProviderInteractionMode;
  sending: boolean;
  chatActive: boolean;
  chatThreadId: string | undefined;
}
const blankView = (): ViewState => ({ activeThreadId: undefined, draftProjectId: undefined, draftWorkspaceRoot: undefined,
  draftModelSelection: undefined, draftRuntimeMode: "auto", draftInteractionMode: "default", sending: false, chatActive: false, chatThreadId: undefined });
const describeError = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
function authFailure(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && (
    ("reason" in cause && cause.reason === "authentication") ||
    ("_tag" in cause && cause._tag === "EnvironmentAuthInvalidError") ||
    ("status" in cause && cause.status === 401));
}

export class HostState {
  private readonly acceptedMessages = new Map<string, { messageId: string; startedAt: string }>();
  private readonly composerDrafts: ComposerDraftStore;
  private readonly draftUploads = new Set<string>();
  private readonly sessionSearches = new Map<string, SessionSearchJob>();
  private searchPreferences: SearchPreferences;
  private phase: HostPhase = "discovering";
  private notice: string | undefined;
  private connectionProblem: ConnectionProblem | undefined;
  private readonly setup: ConnectionSetup;
  private server: DiscoveredServer | null = null;
  private shell: OrchestrationV2ShellSnapshot | null = null;
  private readonly views = new Map<string, ViewState>([[SIDEBAR_VIEW_ID, blankView()]]);
  private archive: OrchestrationV2ArchivedShellSnapshot | null = null;
  private archiveSubscription: Subscription | null = null;
  private readonly threads = new Map<string, ThreadState>();
  private shellSubscription: Subscription | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly emptyThreads = new Set<string>();
  private readonly uploads = new Map<string, { attachment: ChatAttachment; environmentId: string; owners: Set<string>; sent: boolean }>();
  private revision = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<(state: HostStateSnapshot) => void, string>();
  private readonly encodedItems = new WeakMap<OrchestrationV2TurnItem, Omit<TranscriptItem, "key" | "sourceThreadId">>();
  private readonly projectQuestionHistory = createQuestionHistoryProjector();
  private readonly pathIdentities = new Map<string, string>();
  private readonly workspaceRefreshes = new Map<string, Promise<unknown>>();

  private readonly options: HostStateOptions;
  private readonly client: HostTransport;
  constructor(options: HostStateOptions, client: HostTransport) {
    this.options = options; this.client = client; this.composerDrafts = options.draftStore ?? new ComposerDraftStore();
    this.setup = connectionSetup(options.home, options.serverStartupHint);
    this.searchPreferences = resolveSearchPreferences(options.searchPreferences);
    client.onClose = () => {
      void this.enqueue(() => this.recoverConnection()).catch((cause) => {
        if (!this.disposed) this.setPhase("error", describeError(cause));
      });
    };
    client.onConfig = () => this.scheduleEmit();
  }
  onDidChangeState(listener: (state: HostStateSnapshot) => void, viewId = SIDEBAR_VIEW_ID): () => void {
    this.requireView(viewId);
    this.listeners.set(listener, viewId); listener(this.snapshot(viewId));
    return () => { this.listeners.delete(listener); };
  }
  registerView(viewId: string, sourceViewId?: string, chat = true): void {
    if (this.disposed) throw new Error("T3 extension is closed.");
    if (this.views.has(viewId)) throw new Error("This conversation view is already open.");
    // A handoff copies the selection once; subsequent changes belong to each view.
    const source = sourceViewId ? this.requireView(sourceViewId) : blankView();
    if (chat && sourceViewId) for (const upload of this.uploads.values()) if (upload.owners.has(sourceViewId)) upload.owners.add(viewId);
    this.views.set(viewId, { ...source, sending: false, chatActive: chat, chatThreadId: chat ? source.activeThreadId : undefined }); this.emit();
  }
  removeView(viewId: string): Promise<void> {
    this.cancelSessionSearch(viewId);
    if (viewId === SIDEBAR_VIEW_ID) return Promise.resolve();
    const closedThreadId = this.views.get(viewId)?.chatThreadId;
    this.views.delete(viewId);
    for (const [listener, id] of this.listeners) if (id === viewId) this.listeners.delete(listener);
    if (this.disposed) return Promise.resolve();
    return this.enqueue(async () => {
      this.composerDrafts.release(viewId);
      // Sends ahead of this closure must finish claiming uploads before abandonment deletes them.
      for (const [id, upload] of this.uploads) if (upload.owners.has(viewId)) await this.releaseAttachment(id, viewId).catch(() => undefined);
      if (closedThreadId) await this.cleanupEmptyThread(closedThreadId);
      await this.syncThreadSubscriptions(); this.emit();
    });
  }
  composerState(id: string, active: boolean | undefined, touched: boolean, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    // Record typing before asynchronous cleanup can run; even subsequently cleared text counts.
    const view = this.requireView(viewId);
    if (touched && view.activeThreadId === id) this.emptyThreads.delete(id);
    if (active === true && view.activeThreadId === id) { view.chatActive = true; view.chatThreadId = id; }
    else if (active === false && view.chatThreadId === id) { view.chatActive = false; view.chatThreadId = undefined; }
    return active === false ? this.enqueue(() => this.cleanupEmptyThread(id)) : Promise.resolve();
  }
  private async cleanupEmptyThread(id: string): Promise<void> {
    if (!this.emptyThreads.has(id) || !this.client.connected || [...this.views.values()].some((view) => view.chatThreadId === id)) return;
    const thread = this.findThread(id);
    if (!thread || thread.activeRunId || thread.archivedAt || thread.deletedAt || thread.title !== "New thread" || thread.pinnedAt || thread.settledOverride) return;
    // Check durable server data, rather than assuming an unloaded transcript is empty.
    const projection = await this.client.getThreadProjection(id).catch(() => null);
    if (!projection || projection.messages.length || projection.runs.length || projection.visibleTurnItems.some((row) => row.item.type === "user_message" || row.item.type === "assistant_message")
      || projection.thread.title !== "New thread" || projection.thread.pinnedAt || projection.thread.settledOverride
      || !this.emptyThreads.has(id) || [...this.views.values()].some((view) => view.chatThreadId === id)) return;
    await this.client.dispatch({ type: "thread.delete", commandId: randomUUID(), threadId: id });
    this.emptyThreads.delete(id); this.shell = await this.client.snapshotShell();
    await this.reconcileViews();
  }
  private requireView(viewId: string): ViewState {
    const view = this.views.get(viewId);
    if (!view) throw new Error("This conversation tab has been closed.");
    return view;
  }
  private draftScope(): string { return `${this.options.home}:${this.server?.descriptor.environmentId ?? ""}`; }
  async restoreComposerDraft(threadId: string, viewId = SIDEBAR_VIEW_ID): Promise<{ draft: ViewDraft; selection?: TextSelection | undefined }> {
    this.requireView(viewId);
    if (!this.client.connected || !this.server) throw new Error("Reconnect to T3 to recover this draft.");
    if (threadId !== "new") this.requireThread(threadId);
    const record = this.composerDrafts.claim(this.draftScope(), threadId, viewId);
    for (const file of record.draft.attachments ?? []) {
      let restored = file;
      const bytes = this.composerDrafts.file(record, file.key);
      if ((!file.attachment || !this.uploads.has(file.attachment.id)) && bytes && !this.draftUploads.has(`${record.id}:${file.key}`)) {
        try { restored = await this.completeDraftUpload(record, file, bytes, viewId); }
        catch (cause) { if (!this.client.connected) throw cause; restored = { ...file, pending: true, error: describeError(cause) }; }
      } else if (file.pending && !this.draftUploads.has(`${record.id}:${file.key}`)) restored = { ...file, pending: false, error: "Upload was interrupted before its file reached the extension. Attach it again." };
      // A recovery upload can finish after the user has removed a slot or attached another file.
      // Merge only into the original slot; never overwrite the current draft's attachment array.
      if (restored !== file && record.draft.attachments?.includes(file)) this.composerDrafts.save(record, {
        ...record.draft, attachments: record.draft.attachments.map(current => current === file ? restored : current),
      }, record.selection);
      const current = record.draft.attachments?.find(current => current.key === file.key);
      if (!current || current.pending || current.attachment?.id !== restored.attachment?.id) continue;
      if (restored.attachment && restored.environmentId === this.server?.descriptor.environmentId) {
        const upload = this.uploads.get(restored.attachment.id);
        if (upload) { upload.owners.add(viewId); upload.owners.add(`draft:${record.id}`); }
        else this.uploads.set(restored.attachment.id, { attachment: restored.attachment, environmentId: restored.environmentId!, owners: new Set([viewId, `draft:${record.id}`]), sent: false });
      }
    }
    return { draft: record.draft, selection: record.selection };
  }
  saveComposerDraft(threadId: string, draft: ViewDraft, selection: TextSelection | undefined, viewId = SIDEBAR_VIEW_ID): void {
    this.requireView(viewId);
    const known = this.composerDrafts.owned(this.draftScope(), threadId, viewId);
    // Local durability must not depend on the server staying connected between input and save.
    if (!this.client.connected && !known) throw new Error("Reconnect to T3 before opening this draft.");
    if (threadId !== "new") {
      if (this.client.connected) this.requireThread(threadId);
      if (draft.text || draft.contexts.length || draft.attachments?.length) this.emptyThreads.delete(threadId);
    }
    const record = known ?? this.composerDrafts.claim(this.draftScope(), threadId, viewId), owner = `draft:${record.id}`;
    const attachments = draft.attachments?.map(file => {
      const previous = record.draft.attachments?.find(old => old.key === file.key);
      // A final upload reply may beat a renderer save containing the earlier pending slot.
      if (file.pending && previous?.attachment) return { ...previous, ...(file.contextId ? { contextId: file.contextId } : {}) };
      if (!file.attachment) return file;
      const upload = this.uploads.get(file.attachment.id);
      if (!upload || !upload.owners.has(viewId) || upload.environmentId !== this.server?.descriptor.environmentId) throw new Error("Cannot save an attachment owned by another chat.");
      this.composerDrafts.copyAttachmentFile(record, file.key, file.attachment.id);
      return { ...file, attachment: upload.attachment, environmentId: upload.environmentId, ...((file.previewUrl ?? previous?.previewUrl) ? { previewUrl: (file.previewUrl ?? previous?.previewUrl)! } : {}) };
    });
    const retained = new Set(attachments?.flatMap(file => file.attachment ? [file.attachment.id] : []));
    for (const [id, upload] of this.uploads) {
      if (retained.has(id)) upload.owners.add(owner);
      else if (upload.owners.has(owner)) void this.releaseAttachment(id, owner).catch(() => undefined);
    }
    this.composerDrafts.save(record, { ...draft, ...(attachments ? { attachments } : {}) }, selection);
  }
  private async completeDraftUpload(record: StoredComposerDraft, file: DraftAttachment, bytes: Uint8Array, viewId: string): Promise<DraftAttachment> {
    const key = `${record.id}:${file.key}`, environmentId = this.server!.descriptor.environmentId;
    this.draftUploads.add(key);
    const releaseLease = this.composerDrafts.retain(record);
    try {
      const attachment = await this.client.uploadAttachment(attachmentUploadInput(file.name, file.mimeType, bytes.byteLength), bytes);
      const stillAttached = record.draft.attachments?.some(current => current.key === file.key);
      if (!stillAttached || this.server?.descriptor.environmentId !== environmentId) {
        await this.client.deleteAttachment(attachment.id).catch(() => undefined); throw new Error("The file was removed before its upload finished.");
      }
      const { error: _error, ...source } = file;
      const ready: DraftAttachment = { ...source, pending: false, attachment, environmentId,
        ...(attachment.type === "image" ? { previewUrl: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}` } : {}) };
      this.uploads.set(attachment.id, { attachment, environmentId, owners: new Set([`draft:${record.id}`, ...(this.views.has(viewId) ? [viewId] : [])]), sent: false });
      this.composerDrafts.save(record, { ...record.draft, attachments: record.draft.attachments!.map(current => current.key === file.key ? { ...ready, ...(current.contextId ? { contextId: current.contextId } : {}) } : current) }, record.selection);
      this.composerDrafts.flush();
      return ready;
    } finally { this.draftUploads.delete(key); releaseLease(); }
  }
  async uploadAttachment(name: string, mimeType: string, bytes: Uint8Array, viewId = SIDEBAR_VIEW_ID, threadId?: string, slotKey?: string): Promise<DraftAttachment> {
    const view = this.requireView(viewId);
    if (!this.client.connected || !this.server) throw new Error("T3 is disconnected. Retry after reconnecting.");
    if (threadId && view.activeThreadId !== threadId) throw new Error("The conversation changed before the file could be attached.");
    if (view.activeThreadId) this.emptyThreads.delete(view.activeThreadId);
    const input = attachmentUploadInput(name, mimeType, bytes.byteLength);
    const environmentId = this.server.descriptor.environmentId;
    const record = this.composerDrafts.owned(this.draftScope(), threadId ?? view.activeThreadId ?? "new", viewId);
    if (record) {
      const key = slotKey ?? randomUUID();
      const file: DraftAttachment = record.draft.attachments?.find(file => file.key === key) ?? { key, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, pending: true, contextId: `${input.type === "image" ? "image" : "file"}_${randomUUID()}` };
      if (!record.draft.attachments?.some(file => file.key === key)) this.composerDrafts.save(record, { ...record.draft, attachments: [...(record.draft.attachments ?? []), file] }, record.selection);
      this.composerDrafts.keepFile(record, key, bytes); this.composerDrafts.flush();
      return this.completeDraftUpload(record, file, bytes, viewId);
    }
    const attachment = await this.client.uploadAttachment(input, bytes);
    if (!this.views.has(viewId) || this.server?.descriptor.environmentId !== environmentId) {
      await this.client.deleteAttachment(attachment.id).catch(() => undefined); throw new Error("The chat closed before its file could be attached.");
    }
    this.uploads.set(attachment.id, { attachment, environmentId, owners: new Set([viewId]), sent: false });
    return { key: attachment.id, name: attachment.name, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, attachment, environmentId,
      ...(attachment.type === "image" ? { previewUrl: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}` } : {}) };
  }
  async releaseAttachment(id: string, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    const upload = this.uploads.get(id); if (!upload?.owners.delete(viewId) || upload.owners.size) return;
    this.uploads.delete(id);
    if (!upload.sent && this.client.connected && upload.environmentId === this.server?.descriptor.environmentId) await this.client.deleteAttachment(id);
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => {
      if (this.disposed) throw new Error("T3 extension is closed.");
      return action();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
  start(): Promise<void> { return this.enqueue(() => this.connect(false)); }
  reconnect(): Promise<void> { return this.enqueue(() => this.connect(false)); }
  pairNow(): Promise<void> { return this.enqueue(() => this.connect(true)); }
  refreshAppearance(): void { this.emit(); }

  private async stopSubscriptions(): Promise<void> {
    for (const viewId of this.sessionSearches.keys()) this.cancelSessionSearch(viewId);
    const shell = this.shellSubscription; const archive = this.archiveSubscription;
    const threads = [...this.threads.values()]; this.threads.clear();
    this.archiveSubscription = null;
    this.shellSubscription = null;
    await shell?.();
    for (const state of threads) await state.subscription?.();
    await archive?.();
  }
  private async connect(forcePair: boolean): Promise<void> {
    await this.stopSubscriptions();
    await this.client.disconnect();
    this.setPhase("discovering");
    const discovered = await (this.options.discover ?? discoverServer)(this.options.home, this.options.serverStartupHint);
    if (!discovered.ok) { this.setPhase("no-server", discovered.reason, discovered.problem); return; }
    if (this.server?.descriptor.environmentId !== discovered.server.descriptor.environmentId) {
      this.shell = null; this.archive = null;
      for (const view of this.views.values()) Object.assign(view, blankView());
    }
    this.server = discovered.server;
    try {
      const stored = forcePair ? null : await this.options.credentials.get();
      if (stored && stored.environmentId === this.server.descriptor.environmentId) {
        this.setPhase("connecting");
        try { await this.client.connect(this.server, stored.accessToken); }
        catch (cause) {
          if (!authFailure(cause)) throw cause;
          await this.options.credentials.clear();
        }
      }
      if (!this.client.connected) {
        this.setPhase("pairing");
        const session = await (this.options.pair ?? pairWithServer)({ home: this.options.home,
          origin: this.server.origin, environmentId: this.server.descriptor.environmentId });
        await this.options.credentials.save(session);
        this.setPhase("connecting");
        await this.client.connect(this.server, session.accessToken);
      }
      if (this.disposed) { await this.client.disconnect(); return; }
      this.shell = await this.client.snapshotShell();
      this.shellSubscription = await this.client.subscribeShell((item) => this.handleShell(item));
      if (this.archive) await this.subscribeArchive();
      await this.reconcileViews(true);
      this.setPhase("ready");
    } catch (cause) {
      const kind = cause instanceof PairingError ? cause.kind : this.phase === "pairing" ? "pairing" : "connection";
      this.setPhase("error", describeError(cause), { kind });
    }
  }
  private async recoverConnection(): Promise<void> {
    for (let attempt = 0; attempt < 3 && !this.disposed; attempt += 1) {
      this.setPhase("connecting", "Connection lost. Reconnecting…");
      await new Promise((resolve) => setTimeout(resolve, (this.options.reconnectDelayMs ?? 1000) * (attempt + 1)));
      if (this.disposed) return;
      await this.connect(false); // Re-discovers the origin and recreates every subscription.
      if (this.client.connected && this.phase === "ready") return;
    }
  }
  private handleShell(item: OrchestrationV2ShellStreamItem): void {
    if (item.kind === "synchronized") return;
    if (item.kind === "snapshot") {
      this.shell = ShellState.mergeShellSnapshotProjects(this.shell, item.snapshot,
        item.resolvedRepositoryIdentityRoots === undefined ? undefined : { resolvedRepositoryIdentityRoots: item.resolvedRepositoryIdentityRoots });
    } else if (this.shell) {
      this.shell = ShellState.applyShellStreamEvent(this.shell, item);
    }
    this.reconcileRemovedThreads();
    this.scheduleEmit();
  }
  loadArchive(): Promise<void> { return this.enqueue(() => this.subscribeArchive()); }
  private async subscribeArchive(): Promise<void> {
    if (this.archiveSubscription) return;
    this.archive = await this.client.snapshotArchive();
    this.archiveSubscription = await this.client.subscribeArchive((item) => this.handleArchive(item));
    this.emit();
  }
  private handleArchive(item: OrchestrationV2ArchivedShellStreamItem): void {
    if (item.kind === "snapshot") this.archive = item.snapshot;
    else if (this.archive && item.sequence > this.archive.snapshotSequence) {
      const id = item.kind === "thread.updated" ? item.thread.id : item.threadId;
      this.archive = { ...this.archive, snapshotSequence: item.sequence,
        threads: [...this.archive.threads.filter((thread) => thread.id !== id), ...(item.kind === "thread.updated" ? [item.thread] : [])] };
    }
    this.reconcileRemovedThreads();
    this.scheduleEmit();
  }
  private allThreads(): ReadonlyArray<OrchestrationV2ThreadShell> {
    const active = this.shell?.threads ?? [];
    const activeIds = new Set(active.map((thread) => thread.id));
    return [...active, ...(this.archive?.threads ?? this.shell?.archivedThreads ?? []).filter((thread) => !activeIds.has(thread.id))];
  }
  private workspaceRoots(): ReadonlyArray<string> {
    const root = this.options.workspaceRoot?.();
    return this.options.workspaceRoots?.() ?? (root ? [root] : []);
  }
  private pathIdentity(path: string): string {
    const absolute = resolve(path);
    let identity = this.pathIdentities.get(absolute);
    if (!identity) {
      try { identity = realpathSync.native(absolute); } catch { identity = absolute; }
      this.pathIdentities.set(absolute, identity);
    }
    return identity;
  }
  private pathInWorkspace(path: string): boolean {
    const roots = this.workspaceRoots();
    return !roots.length || roots.some((root) => this.pathIdentity(root) === this.pathIdentity(path));
  }
  private visibleProjects() { return this.shell?.projects.filter((project) => this.pathInWorkspace(project.workspaceRoot)) ?? []; }
  private visibleThreads(): ReadonlyArray<OrchestrationV2ThreadShell> {
    const projects = new Set(this.visibleProjects().map((project) => project.id));
    return this.allThreads().filter((thread) => !thread.deletedAt && projects.has(thread.projectId));
  }
  private findThread(id: string | undefined) { return this.visibleThreads().find((thread) => thread.id === id); }
  private latestThreadId(): string | undefined {
    return [...this.visibleThreads()].filter((thread) => !thread.archivedAt)
      .sort((a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt))[0]?.id;
  }
  private reconcileRemovedThreads(): void {
    if ([...this.views.values()].some((view) => view.activeThreadId && !this.findThread(view.activeThreadId))) {
      void this.enqueue(() => this.reconcileViews()).catch((cause) => { if (!this.disposed) this.setPhase("error", describeError(cause)); });
    }
  }
  private async reconcileViews(selectSidebar = false): Promise<void> {
    for (const [viewId, view] of this.views) {
      if (view.activeThreadId && !this.findThread(view.activeThreadId)) {
        view.activeThreadId = viewId === SIDEBAR_VIEW_ID ? this.latestThreadId() : undefined;
      } else if (selectSidebar && viewId === SIDEBAR_VIEW_ID && !view.activeThreadId) {
        view.activeThreadId = this.latestThreadId();
      }
      view.chatThreadId = view.chatActive ? view.activeThreadId : undefined;
    }
    await this.syncThreadSubscriptions(); this.emit();
  }
  workspaceChanged(): Promise<void> {
    return this.enqueue(async () => {
      this.pathIdentities.clear();
      for (const view of this.views.values()) {
        view.draftProjectId = undefined; view.draftWorkspaceRoot = undefined;
      }
      await this.reconcileViews(true);
    });
  }
  private requireThread(id: string): OrchestrationV2ThreadShell {
    if (!this.client.connected) throw new Error("T3 is disconnected.");
    const thread = this.findThread(id);
    if (!thread) throw new Error("This thread is not available in the current workspace. Refresh the thread list.");
    return thread;
  }
  selectThread(id: string, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(async () => {
      this.requireThread(id);
      const view = this.requireView(viewId);
      if (view.activeThreadId === id && this.threads.get(id)?.subscription) return;
      const previous = view.chatThreadId;
      this.cancelSessionSearch(viewId);
      view.activeThreadId = id;
      if (view.chatActive) view.chatThreadId = id;
      await this.syncThreadSubscriptions(); this.emit();
      if (previous && previous !== id) await this.cleanupEmptyThread(previous);
    });
  }
  private async syncThreadSubscriptions(): Promise<void> {
    const selected = new Set<string>(this.client.connected
      ? [...this.views.values()].map((view) => this.findThread(view.activeThreadId)?.id).filter((id) => id !== undefined) : []);
    for (const [id, state] of this.threads) {
      if (selected.has(id)) continue;
      // Delete first so callbacks and history responses in flight cannot revive this projection.
      this.threads.delete(id); await state.subscription?.();
    }
    for (const id of selected) {
      if (![...this.views.values()].some((view) => view.activeThreadId === id)) continue;
      if (this.threads.has(id)) continue;
      const state = blankThread(); this.threads.set(id, state);
      try {
        const subscription = await this.client.subscribeThread(id, (item) => {
          if (this.disposed || this.threads.get(id) !== state) return;
          this.handleThread(state, item);
        });
        if (this.disposed || this.threads.get(id) !== state) await subscription();
        else state.subscription = subscription;
      } catch (cause) { this.threads.delete(id); throw cause; }
    }
  }
  private handleThread(state: ThreadState, item: OrchestrationV2ThreadStreamItem): void {
    if (item.kind === "snapshot") {
      state.projection = item.projection; state.sequence = item.snapshotSequence; state.loading = false;
      state.history = { ...EMPTY_THREAD_HISTORY_META, historyCursor: item.historyCursor ?? null,
        hasMoreHistory: item.hasMoreHistory ?? false, latestLocalTurnOrdinal: item.latestLocalTurnOrdinal ?? null };
    } else if (item.kind === "event" && item.sequence > state.sequence) {
      state.projection = applyOrchestrationV2ProjectionEvent(state.projection, item.event, {
        partialTimeline: state.history.hasMoreHistory || state.history.expanded,
        latestLocalTurnOrdinal: state.history.latestLocalTurnOrdinal,
      });
      state.sequence = item.sequence;
      if (item.event.type === "turn-item.updated") {
        state.history = { ...state.history, latestLocalTurnOrdinal: Math.max(state.history.latestLocalTurnOrdinal ?? 0, item.event.payload.ordinal) };
      }
    } else if (item.kind === "synchronized") { state.loading = false; }
    if (state.projection) for (const job of this.sessionSearches.values()) {
      if (job.threadId === state.projection.thread.id) job.refresh(state.projection.visibleTurnItems);
    }
    this.scheduleEmit();
  }
  newThread(projectId?: string, viewId = SIDEBAR_VIEW_ID): Promise<string> { return this.enqueue(() => this.createThread(projectId, viewId)); }
  private availableModel(preferred?: ModelSelection | null): ModelSelection | null {
    const providers = this.client.config?.providers.filter((provider) => provider.enabled && provider.installed && provider.availability !== "unavailable") ?? [];
    if (preferred && providers.some((provider) => provider.instanceId === preferred.instanceId && provider.models.some((model) => model.slug === preferred.model))) return preferred;
    for (const provider of providers) {
      const model = provider.models.find((item) => item.isDefault) ?? provider.models[0];
      if (model) return { instanceId: provider.instanceId, model: model.slug };
    }
    return null;
  }
  private chooseModel(preferred?: ModelSelection | null): ModelSelection {
    const model = this.availableModel(preferred);
    if (!model) throw new Error("No available provider models. Configure a provider in T3 Code, then reconnect.");
    return model;
  }
  private compatibleRuntimeMode(selection: ModelSelection | null, preferred: RuntimeMode): RuntimeMode {
    const supported = this.client.config?.providers.find((provider) => provider.instanceId === selection?.instanceId)?.supportedRuntimeModes;
    if (!supported?.length || supported.includes(preferred)) return preferred;
    return supported.includes("approval-required") ? "approval-required" : supported[0]!;
  }
  private conversationDraft(view: ViewState): ConversationDraft {
    const roots = this.workspaceRoots();
    const chosenRoot = view.draftWorkspaceRoot === undefined ? roots[0] ?? null : view.draftWorkspaceRoot;
    const root = roots.length && (!chosenRoot || !this.pathInWorkspace(chosenRoot)) ? roots[0]! : chosenRoot;
    const active = this.findThread(view.activeThreadId);
    const projects = this.visibleProjects();
    const project = projects.find((item) => item.id === view.draftProjectId)
      ?? (root ? projects.find((item) => this.pathIdentity(item.workspaceRoot) === this.pathIdentity(root))
        : view.draftWorkspaceRoot === null ? undefined : projects.find((item) => item.id === active?.projectId));
    const modelSelection = this.availableModel(view.draftModelSelection ?? project?.defaultModelSelection ?? active?.modelSelection);
    const supportsNoProject = !roots.length && availableScratchWorkspaceRoot(this.client.connected ? "connected" : null, this.client.config) !== null;
    return { projectId: project?.id ?? null, workspaceRoot: project?.workspaceRoot ?? root, supportsNoProject, modelSelection,
      runtimeMode: this.compatibleRuntimeMode(modelSelection, view.draftRuntimeMode), interactionMode: view.draftInteractionMode };
  }
  chooseProject(projectId?: string, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(async () => {
      const view = this.requireView(viewId);
      if (projectId) this.applyProjectSelection(view, { projectId });
      else await this.pickDraftProject(viewId);
      this.emit();
    });
  }
  private applyProjectSelection(view: ViewState, selection: ProjectSelection): void {
    if ("noProject" in selection) {
      if (!this.conversationDraft(view).supportsNoProject) throw new Error("This server requires a project. Choose a project folder.");
      view.draftProjectId = undefined; view.draftWorkspaceRoot = null;
    } else if ("projectId" in selection) {
      const project = this.visibleProjects().find((item) => item.id === selection.projectId);
      if (!project) throw new Error("Project not found in the current workspace.");
      view.draftProjectId = project.id; view.draftWorkspaceRoot = project.workspaceRoot;
    } else {
      if (!isAbsolute(selection.workspaceRoot)) throw new Error("Choose an absolute project folder.");
      if (!this.pathInWorkspace(selection.workspaceRoot)) throw new Error("Choose a folder from the current VS Code workspace.");
      view.draftProjectId = undefined; view.draftWorkspaceRoot = resolve(selection.workspaceRoot);
    }
  }
  private async pickDraftProject(viewId: string): Promise<boolean> {
    const view = this.requireView(viewId);
    const projects = this.visibleProjects().map((project) => ({ id: project.id, title: project.title, workspaceRoot: project.workspaceRoot }));
    const selected = await this.options.pickProject?.(projects, this.conversationDraft(view).supportsNoProject, this.workspaceRoots());
    if (!selected) return false;
    this.applyProjectSelection(this.requireView(viewId), selected);
    return true;
  }
  private async createThread(requestedProjectId: string | undefined, viewId: string, activate = true): Promise<string> {
    const view = this.requireView(viewId);
    if (!this.client.connected) throw new Error("T3 is disconnected.");
    this.chooseModel();
    let draft = this.conversationDraft(view);
    let projectId = requestedProjectId ?? draft.projectId ?? undefined;
    if (projectId && !this.visibleProjects().some((project) => project.id === projectId)) throw new Error("Project not found in the current workspace.");
    if (!projectId && !draft.workspaceRoot) {
      if (draft.supportsNoProject) projectId = await this.client.ensureScratchProject();
      else {
        if (!await this.pickDraftProject(viewId)) throw new Error("Choose a project or open a folder before starting a conversation.");
        draft = this.conversationDraft(view);
        projectId = draft.projectId ?? undefined;
      }
    }
    if (!projectId) {
      const root = draft.workspaceRoot;
      if (root) {
        projectId = this.visibleProjects().find((project) => this.pathIdentity(project.workspaceRoot) === this.pathIdentity(root))?.id;
        if (!projectId) projectId = await this.client.createProject(root, basename(root));
      }
    }
    if (!projectId) throw new Error("Choose a project before starting a conversation.");
    this.shell = await this.client.snapshotShell();
    const project = this.shell.projects.find((candidate) => candidate.id === projectId);
    this.requireView(viewId);
    const model = this.chooseModel(view.draftModelSelection ?? project?.defaultModelSelection ?? draft.modelSelection);
    const id = randomUUID();
    await this.client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId: id, projectId,
      createdBy: "user", creationSource: "web", title: "New thread", modelSelection: model,
      runtimeMode: this.compatibleRuntimeMode(model, draft.runtimeMode), interactionMode: draft.interactionMode, branch: null, worktreePath: null });
    this.shell = await this.client.snapshotShell();
    this.emptyThreads.add(id);
    const previous = view.chatThreadId;
    if (activate && this.views.get(viewId) === view) { view.activeThreadId = id; if (view.chatActive) view.chatThreadId = id; }
    await this.syncThreadSubscriptions(); this.emit();
    if (activate && previous) await this.cleanupEmptyThread(previous);
    if (!this.views.has(viewId)) await this.cleanupEmptyThread(id);
    return id;
  }
  sendMessage(text: string, targetThreadId?: string, viewId = SIDEBAR_VIEW_ID, mode = "auto", attachmentIds: ReadonlyArray<string> = [], attachmentReferences: ReadonlyArray<AttachmentReference> = []): Promise<void> {
    return this.enqueue(async () => {
      this.requireView(viewId);
      if (!["auto", "queue", "steer"].includes(mode)) throw new Error("Unknown message delivery mode.");
      if (new Set(attachmentIds).size !== attachmentIds.length) throw new Error("Duplicate attachments are not allowed.");
      const attachments = attachmentIds.map((id) => {
        const upload = this.uploads.get(id);
        if (!upload?.owners.has(viewId) || upload.environmentId !== this.server?.descriptor.environmentId) throw new Error("This attachment is not available in the current chat. Remove it and attach it again.");
        return upload.attachment;
      });
      const limitError = getProviderAttachmentLimitError(attachments); if (limitError) throw new Error(limitError);
      const context = attachmentMessageContext(text, attachments, attachmentReferences);
      if (!text.trim() && !attachments.length) throw new Error("Enter a message or attach a file.");
      const id = targetThreadId ?? await this.createThread(undefined, viewId, false);
      const view = this.requireView(viewId);
      const thread = this.requireThread(id);
      if (thread.archivedAt) throw new Error("Restore this thread before sending a message.");
      if (thread.lineage.relationshipToParent === "subagent" && thread.creationSource === "provider") throw new Error("This subagent conversation is controlled by its provider. Return to the parent conversation to send instructions.");
      view.sending = true; this.emit();
      try {
        const messageId = randomUUID(), alreadyWorking = !!thread.activeRunId || !!(this.threads.get(id)?.projection && deriveThreadQueueWorkflowState(this.threads.get(id)!.projection!).activeRun) || this.acceptedMessages.has(id);
        await this.client.dispatch({ type: "message.dispatch", commandId: randomUUID(), threadId: id,
          createdBy: "user", creationSource: "web", messageId, text, attachments, ...(context ? { context } : {}),
          titleSeed: deriveThreadTitleSeed({ text, attachments }), ...(mode !== "queue" ? { deliveryIntent: mode } : {}), dispatchMode: { type: mode === "queue" ? "queue_after_active" : "start_immediately" } });
        this.emptyThreads.delete(id);
        if (!alreadyWorking) this.acceptedMessages.set(id, { messageId, startedAt: new Date().toISOString() });
        for (const id of attachmentIds) { const upload = this.uploads.get(id); if (upload) upload.sent = true; }
        const record = this.composerDrafts.owned(this.draftScope(), targetThreadId ?? "new", viewId);
        if (record) {
          for (const file of record.draft.attachments ?? []) if (file.attachment) await this.releaseAttachment(file.attachment.id, `draft:${record.id}`);
          this.composerDrafts.save(record, { text: "", contexts: [] }); this.composerDrafts.flush();
        }
        if (!targetThreadId && this.views.get(viewId) === view) { view.activeThreadId = id; if (view.chatActive) view.chatThreadId = id; await this.syncThreadSubscriptions(); }
      } catch (cause) {
        if (!targetThreadId) await this.cleanupEmptyThread(id).catch(() => undefined);
        throw cause;
      } finally { view.sending = false; this.emit(); }
    });
  }
  setModel(id: string | undefined, input: unknown, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(() => this.applyModelSelection(id, input, viewId));
  }
  private async applyModelSelection(id: string | undefined, input: unknown, viewId: string): Promise<void> {
      const view = this.requireView(viewId);
      const selection = Schema.decodeUnknownSync(ModelSelectionSchema)(input);
      const provider = this.client.config?.providers.find((item) => item.instanceId === selection.instanceId);
      if (!provider?.enabled || !provider.installed || provider.availability === "unavailable" || !provider.models.some((model) => model.slug === selection.model)) throw new Error("This model is unavailable.");
      if (id === undefined) {
        view.draftModelSelection = selection;
        view.draftRuntimeMode = this.compatibleRuntimeMode(selection, view.draftRuntimeMode);
        this.emit(); return;
      }
      const thread = this.requireThread(id);
      if (provider.requiresNewThreadForModelChange && thread.itemCount > 0 && (selection.model !== thread.modelSelection.model || selection.instanceId !== thread.modelSelection.instanceId)) throw new Error("This provider requires a new thread to change models.");
      await this.client.dispatch({ type: "thread.model-selection.set", commandId: randomUUID(), threadId: id, modelSelection: selection });
  }
  setModelOption(id: string | undefined, optionId: string, value: unknown, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(async () => {
      const view = this.requireView(viewId);
      const selection = id === undefined ? this.conversationDraft(view).modelSelection : this.requireThread(id).modelSelection;
      if (!selection) throw new Error("Choose a model first.");
      const model = this.client.config?.providers.find((provider) => provider.instanceId === selection.instanceId)?.models.find((model) => model.slug === selection.model);
      const descriptor = model?.capabilities?.optionDescriptors?.find((option) => option.id === optionId);
      if (!descriptor || (descriptor.type === "boolean" ? typeof value !== "boolean" : typeof value !== "string" || !descriptor.options.some((option) => option.id === value))) throw new Error("This model does not support that option value.");
      if (descriptor.type === "select" && typeof value === "string" && descriptor.promptInjectedValues?.includes(value)) throw new Error("This effort is controlled by the message text.");
      const options = [...(selection.options ?? []).filter((option) => option.id !== optionId), { id: optionId, value: value as string | boolean }];
      await this.applyModelSelection(id, { ...selection, options }, viewId);
    });
  }
  toggleFavoriteModel(instanceId: string, model: string): Promise<void> {
    return this.enqueue(async () => {
      const preferences = this.modelPreferences();
      const favorites = preferences.favoriteModels;
      const exists = favorites.some((favorite) => favorite.instanceId === instanceId && favorite.model === model);
      if (!exists && !this.client.config?.providers.some((provider) => provider.instanceId === instanceId && provider.models.some((entry) => entry.slug === model))) throw new Error("Model not found.");
      const next = exists ? favorites.filter((favorite) => favorite.instanceId !== instanceId || favorite.model !== model) : [...favorites, { instanceId, model }];
      if (this.options.saveModelPreferences) await this.options.saveModelPreferences({ ...preferences, favoriteModels: next });
      else if (this.options.saveFavoriteModels) await this.options.saveFavoriteModels(next);
      else throw new Error("Model favorites are unavailable.");
      this.emit();
    });
  }
  private modelPreferences(): ModelPickerPreferences {
    return this.options.modelPreferences?.() ?? { favoriteModels: this.options.favoriteModels?.() ?? [], providerModelPreferences: {} };
  }
  private async saveModelPreferences(preferences: ModelPickerPreferences): Promise<void> {
    if (!this.options.saveModelPreferences) throw new Error("Model preferences are unavailable.");
    await this.options.saveModelPreferences(preferences);
    this.emit();
  }
  importModelPreferences(json: string): Promise<void> {
    return this.enqueue(async () => {
      const imported = parseModelPreferencesImport(json);
      const current = this.modelPreferences();
      await this.saveModelPreferences({ favoriteModels: imported.favoriteModels ?? current.favoriteModels,
        providerModelPreferences: imported.providerModelPreferences ?? current.providerModelPreferences });
    });
  }
  setModelVisibility(instanceId: string, model: string, visible: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (typeof visible !== "boolean") throw new Error("Invalid model visibility.");
      const provider = this.client.config?.providers.find((provider) => provider.instanceId === instanceId);
      if (!provider?.models.some((entry) => entry.slug === model)) throw new Error("Model not found.");
      const current = this.modelPreferences();
      const previous = getProviderModelPreference(current.providerModelPreferences, instanceId) ?? defaultProviderModelPreference(provider);
      const hiddenModels = previous.hiddenModels.filter((slug) => slug !== model);
      if (!visible) hiddenModels.push(model);
      await this.saveModelPreferences({ ...current, providerModelPreferences: { ...current.providerModelPreferences,
        [instanceId]: { ...previous, hiddenModels } } });
    });
  }
  moveModel(instanceId: string, model: string, direction: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (direction !== "up" && direction !== "down") throw new Error("Invalid model direction.");
      const provider = this.client.config?.providers.find((provider) => provider.instanceId === instanceId);
      if (!provider?.models.some((entry) => entry.slug === model)) throw new Error("Model not found.");
      const current = this.modelPreferences();
      const previous = getProviderModelPreference(current.providerModelPreferences, instanceId) ?? defaultProviderModelPreference(provider);
      const order = orderedProviderModels(provider, previous).map((entry) => entry.slug);
      const from = order.indexOf(model), to = from + (direction === "up" ? -1 : 1);
      if (to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to]!, order[from]!];
      await this.saveModelPreferences({ ...current, providerModelPreferences: { ...current.providerModelPreferences,
        [instanceId]: { ...previous, modelOrder: [...order, ...previous.modelOrder.filter((slug) => !order.includes(slug))] } } });
    });
  }
  setModes(id: string | undefined, input: { runtimeMode?: unknown; interactionMode?: unknown }, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(async () => {
      const view = this.requireView(viewId);
      if (id === undefined) {
        const draft = this.conversationDraft(view);
        const mode = input.runtimeMode === undefined ? draft.runtimeMode : Schema.decodeUnknownSync(RuntimeMode)(input.runtimeMode);
        const interaction = input.interactionMode === undefined ? draft.interactionMode : Schema.decodeUnknownSync(ProviderInteractionMode)(input.interactionMode);
        if (this.compatibleRuntimeMode(draft.modelSelection, mode) !== mode) throw new Error("This provider does not support that permission mode.");
        view.draftRuntimeMode = mode; view.draftInteractionMode = interaction; this.emit(); return;
      }
      const thread = this.requireThread(id);
      if (input.runtimeMode !== undefined) {
        const mode = Schema.decodeUnknownSync(RuntimeMode)(input.runtimeMode);
        const supported = this.client.config?.providers.find((provider) => provider.instanceId === thread.modelSelection.instanceId)?.supportedRuntimeModes;
        if (supported && !supported.includes(mode)) throw new Error("This provider does not support that permission mode.");
        await this.client.dispatch({ type: "thread.runtime-mode.set", commandId: randomUUID(), threadId: id, runtimeMode: mode });
      }
      if (input.interactionMode !== undefined) await this.client.dispatch({ type: "thread.interaction-mode.set", commandId: randomUUID(), threadId: id,
        interactionMode: Schema.decodeUnknownSync(ProviderInteractionMode)(input.interactionMode) });
    });
  }
  interrupt(id: string): Promise<void> {
    return this.enqueue(async () => {
      const thread = this.requireThread(id);
      const current = this.threads.get(id)?.projection;
      let runId = thread.activeRunId ?? (current ? deriveThreadQueueWorkflowState(current).activeRun?.id : null);
      const accepted = this.acceptedMessages.get(id);
      if (!runId && accepted) {
        const projection = await this.client.getThreadProjection(id);
        const run = projection.runs.find(run => run.userMessageId === accepted.messageId);
        if (run?.status === "queued") { await this.client.dispatch({ type: "queued-run.cancel", commandId: randomUUID(), threadId: id, runId: run.id }); this.acceptedMessages.delete(id); this.emit(); return; }
        if (run && !["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(run.status)) runId = run.id;
      }
      if (!runId) return;
      await this.client.dispatch({ type: "run.interrupt", commandId: randomUUID(), threadId: id, runId, holdQueue: true });
    });
  }
  respondToRequest(input: RequestResponse): Promise<void> {
    return this.enqueue(async () => {
      this.requireThread(input.threadId);
      const state = this.threads.get(input.threadId)?.projection;
      const request = state?.runtimeRequests.find((request) => request.id === input.requestId && request.status === "pending");
      if (!request) throw new Error("This request is no longer pending.");
      if (request.responseCapability.type === "not_resumable") throw new Error("The provider process has ended. Restart the turn to respond.");
      const response = input.decision !== undefined
        ? { decision: Schema.decodeUnknownSync(ProviderApprovalDecision)(input.decision) }
        : { answers: input.answers ?? {} };
      await this.client.dispatch({ type: "runtime-request.respond", commandId: randomUUID(), ...input, ...response });
    });
  }
  dismissRequest(id: string, requestId: string): Promise<void> {
    return this.enqueue(async () => {
      this.requireThread(id);
      await this.client.dispatch({ type: "thread.user-input.dismiss", commandId: randomUUID(), threadId: id, requestId });
    });
  }
  threadAction(id: string, action: string, title?: string): Promise<void> {
    return this.enqueue(async () => {
      this.requireThread(id);
      if (action !== "delete") this.emptyThreads.delete(id);
      if (action === "rename") {
        if (!title?.trim()) throw new Error("Enter a thread title.");
        await this.client.dispatch({ type: "thread.metadata.update", commandId: randomUUID(), threadId: id, title });
      } else if (["archive", "unarchive", "pin", "unpin", "delete", "settle", "unsettle"].includes(action)) {
        await this.client.dispatch({ type: `thread.${action}`, commandId: randomUUID(), threadId: id, ...(action === "unsettle" ? { reason: "user" } : {}) });
      } else throw new Error("Unknown thread action.");
      this.shell = await this.client.snapshotShell();
      if (action === "archive" || action === "unarchive" || action === "delete") {
        this.archive = await this.client.snapshotArchive();
        await this.subscribeArchive();
      }
      await this.reconcileViews();
    });
  }
  private canForkRow(projection: OrchestrationV2ThreadProjection, row: OrchestrationV2ThreadProjection["visibleTurnItems"][number]): boolean {
    if (row.item.type !== "assistant_message" || row.item.runId === null || row.item.status !== "completed") return false;
    const run = projection.runs.find(run => run.id === row.item.runId);
    if (run && !["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(run.status) || this.findThread(row.sourceThreadId)?.activeRunId === row.item.runId) return false;
    const last = projection.visibleTurnItems.findLast(item => item.sourceThreadId === row.sourceThreadId && item.item.runId === row.item.runId && item.item.type === "assistant_message");
    if (last && last.sourceItemId !== row.sourceItemId) return false;
    const providerThread = projection.providerThreads.find((thread) => thread.id === row.item.providerThreadId);
    const session = projection.providerSessions.find((session) => session.id === providerThread?.providerSessionId);
    return canForkProjectedAssistantItem({ projectedItem: row, capabilities: session?.capabilities });
  }
  forkFromResponse(id: string, sourceThreadId: string, itemId: string, viewId = SIDEBAR_VIEW_ID): Promise<string> {
    return this.enqueue(async () => {
      this.requireView(viewId); this.requireThread(id);
      const projection = this.threads.get(id)?.projection;
      const row = projection?.visibleTurnItems.find((item) => item.sourceThreadId === sourceThreadId && item.sourceItemId === itemId);
      if (!projection || !row || !this.canForkRow(projection, row) || row.item.runId === null) throw new Error("This response cannot be forked.");
      this.requireThread(row.sourceThreadId);
      const targetId = randomUUID();
      await this.client.dispatch({ type: "thread.fork", commandId: randomUUID(), createdBy: "user", creationSource: "web",
        sourceThreadId: row.sourceThreadId, targetThreadId: targetId, sourcePoint: { type: "run", runId: row.item.runId } });
      this.shell = await this.client.snapshotShell();
      this.requireThread(targetId);
      this.requireView(viewId).activeThreadId = targetId;
      await this.syncThreadSubscriptions(); this.emit(); return targetId;
    });
  }
  async loadHistory(id: string): Promise<void> {
    this.requireThread(id);
    const state = this.threads.get(id);
    const cursor = state?.history.historyCursor;
    if (!state?.projection || !cursor || state.history.loading) return;
    state.history = { ...state.history, loading: true, error: null }; this.emit();
    try {
      const page = await this.client.getHistory(id, cursor);
      if (this.threads.get(id) !== state || state.history.historyCursor !== cursor) return;
      state.projection = mergeOlderHistoryIntoProjection(state.projection, page.items);
      state.history = applyHistoryPageMeta(state.history, page);
    } catch (cause) { state.history = { ...state.history, loading: false, error: describeError(cause) }; }
    this.emit();
  }
  async loadItemDetail(id: string, sourceId: string, itemId: string): Promise<void> {
    this.requireThread(id);
    const state = this.threads.get(id);
    const row = state?.projection?.visibleTurnItems.find((row) => row.sourceThreadId === sourceId && row.sourceItemId === itemId);
    if (!state?.projection || !row) throw new Error("Timeline item not found.");
    const result = await this.client.getTurnItem(sourceId, itemId);
    if (this.threads.get(id) !== state || !result.item) return;
    const fullItem = result.item;
    // Do not replace a newer streamed revision with a late detail response.
    if (!state.projection.visibleTurnItems.some((current) => current.item === row.item)) return;
    state.projection = { ...state.projection,
      turnItems: state.projection.turnItems.map((item) => item.id === fullItem.id ? fullItem : item),
      visibleTurnItems: state.projection.visibleTurnItems.map((current) => current === row ? { ...row, item: fullItem } : current) };
    this.emit();
  }
  workspaceForThread(id?: string): string | null {
    const thread = this.findThread(id);
    if (id && !thread) throw new Error("This thread is not available in the current workspace.");
    return thread?.worktreePath ?? this.visibleProjects().find((project) => project.id === thread?.projectId)?.workspaceRoot ?? this.workspaceRoots()[0] ?? null;
  }
  async searchThreads(query: string, viewId = SIDEBAR_VIEW_ID): Promise<ReadonlyArray<ThreadSearchMatch>> {
    this.requireView(viewId);
    const normalized = query.trim();
    if (normalized.length < 2) return [];
    if (normalized.length > 200) throw new Error("Search is limited to 200 characters.");
    const result = await this.client.searchThreads(normalized);
    this.requireView(viewId);
    const visible = new Set(this.visibleThreads().map((thread) => thread.id));
    return result.matches.filter((match) => visible.has(match.threadId));
  }
  cancelSessionSearch(viewId = SIDEBAR_VIEW_ID): void {
    this.sessionSearches.get(viewId)?.cancel();
    this.sessionSearches.delete(viewId);
  }
  async setSearchPreferences(patch: Partial<SearchPreferences>): Promise<void> {
    this.searchPreferences = resolveSearchPreferences({ ...this.searchPreferences, ...patch });
    this.emit();
    await this.options.saveSearchPreferences?.(this.searchPreferences);
  }
  sessionSearchPreviews(threadId: string, query: string, ids: readonly string[], viewId = SIDEBAR_VIEW_ID): SessionSearchPreview[] {
    const job = this.sessionSearches.get(viewId);
    if (!job || job.threadId !== threadId || job.options.query !== query || this.requireView(viewId).activeThreadId !== threadId) throw new Error("Search this conversation again.");
    return job.previews(ids);
  }
  searchSession(id: string, options: SessionSearchOptions, viewId = SIDEBAR_VIEW_ID): void {
    this.requireThread(id);
    if (this.requireView(viewId).activeThreadId !== id) throw new Error("Open this conversation before searching it.");
    if (!options.query || options.query.length > 500) throw new Error("Enter between 1 and 500 characters to search.");
    const state = this.threads.get(id);
    if (!state?.projection || state.loading) throw new Error("Wait for this conversation to finish loading.");
    this.cancelSessionSearch(viewId);
    const job = new SessionSearchJob(id, options, () => { if (this.sessionSearches.get(viewId) === job && this.views.has(viewId)) this.scheduleEmit(); });
    this.sessionSearches.set(viewId, job); this.emit();
    void job.scan(state.projection.visibleTurnItems, state.history.historyCursor, {
      present: (row) => ({ key: `${row.sourceThreadId}:${row.sourceItemId}`, sourceThreadId: row.sourceThreadId, sourceItemId: row.sourceItemId, ...this.presentItem(row.item) }),
      history: (cursor) => this.client.getHistory(id, cursor),
      detail: async (row) => { const result = await this.client.getTurnItem(row.sourceThreadId, row.sourceItemId); if (!result.item) throw new Error("Some activity details could not be loaded; the match count is incomplete."); return { ...row, item: result.item }; },
    }, state.history.hasMoreHistory);
  }
  revealSessionMatch(matchId: string, viewId = SIDEBAR_VIEW_ID): void {
    const job = this.sessionSearches.get(viewId);
    if (!job || job.threadId !== this.requireView(viewId).activeThreadId) throw new Error("Search this conversation again.");
    const match = job.state.matches.find((entry) => entry.id === matchId), state = this.threads.get(job.threadId);
    const row = match ? job.rows.get(match.rowKey) : undefined;
    if (!row || !state?.projection) throw new Error("The search result is no longer available.");
    this.requireThread(job.threadId);
    const existing = state.projection.visibleTurnItems.find((item) => item.sourceThreadId === row.sourceThreadId && item.sourceItemId === row.sourceItemId);
    if (existing) state.projection = { ...state.projection, visibleTurnItems: state.projection.visibleTurnItems.map((entry) => entry === existing && DateTime.toEpochMillis(entry.item.updatedAt) <= DateTime.toEpochMillis(row.item.updatedAt) ? row : entry) };
    else state.projection = mergeOlderHistoryIntoProjection(state.projection, [row]);
    this.emit();
  }
  async composerSuggestions(kind: string, query: string, atPromptStart: boolean, viewId = SIDEBAR_VIEW_ID): Promise<ReadonlyArray<ComposerSuggestion>> {
    const view = this.requireView(viewId);
    if (query.length > 256) throw new Error("Suggestion query is too long.");
    const thread = this.findThread(view.activeThreadId);
    const draft = this.conversationDraft(view);
    const cwd = thread ? this.workspaceForThread(thread.id) : draft.workspaceRoot ?? this.visibleProjects().find((project) => project.id === draft.projectId)?.workspaceRoot ?? null;
    const selection = thread?.modelSelection ?? draft.modelSelection;
    const instanceId = selection?.instanceId;
    if (kind === "path") {
      if (!cwd) return [];
      const result = await this.client.searchPaths(cwd, query);
      this.requireView(viewId);
      // Returned paths and their server ordering come from T3's workspace index.
      return result.entries.map((entry) => ({ id: `path:${entry.kind}:${entry.path}`, kind: entry.kind, value: entry.path, label: basename(entry.path), description: entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "" }));
    }
    if (kind !== "slash-command" && kind !== "skill") throw new Error("Unknown composer trigger.");
    let provider = this.client.config?.providers.find((provider) => provider.instanceId === instanceId);
    if (instanceId && cwd && !hasCompleteProviderWorkspaceSnapshot(provider, cwd)) {
      const key = `${instanceId}:${cwd}`;
      const pending = this.workspaceRefreshes.get(key) ?? this.client.refreshProviders(instanceId, cwd).finally(() => this.workspaceRefreshes.delete(key));
      this.workspaceRefreshes.set(key, pending);
      await pending;
      provider = this.client.config?.providers.find((provider) => provider.instanceId === instanceId);
    }
    this.requireView(viewId);
    const items = slashSuggestions(provider, cwd, kind === "skill" ? `skill:${query}` : query, atPromptStart);
    return kind === "skill" ? items.filter((item) => item.kind === "skill") : items;
  }
  async refreshUsage(): Promise<void> { await this.client.refreshProviders(); this.emit(); }
  queueAction(id: string, action: string, runId: string | undefined, text: string | undefined, beforeRunId: string | null | undefined, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(async () => {
      this.requireView(viewId); this.requireThread(id);
      const projection = this.threads.get(id)?.projection;
      if (!projection) throw new Error("This conversation's queue is not available.");
      const workflow = deriveThreadQueueWorkflowState(projection);
      const command = { commandId: randomUUID(), threadId: id };
      if (action === "resume") {
        if (!workflow.isHeld) throw new Error("This queue is not paused.");
        await this.client.dispatch({ ...command, type: "queue.resume" }); return;
      }
      const entry = workflow.queuedRuns.find((entry) => entry.run.id === runId);
      if (!entry) throw new Error("This message is no longer queued.");
      if (action === "steer") {
        if (!workflow.canPromoteToSteer || !workflow.activeRun) throw new Error("This provider cannot steer the current turn.");
        await this.client.dispatch({ ...command, type: "queued-message.promote-to-steer", queuedRunId: entry.run.id, targetRunId: workflow.activeRun.id });
      } else if (action === "cancel") await this.client.dispatch({ ...command, type: "queued-run.cancel", runId: entry.run.id });
      else if (action === "edit") {
        if (!text?.trim()) throw new Error("Enter a queued message.");
        await this.client.dispatch({ ...command, type: "queued-run.edit", runId: entry.run.id, text, ...(entry.context ? { context: entry.context } : {}) });
      } else if (action === "reorder") {
        if (!workflow.canReorder) throw new Error("This provider cannot reorder queued messages.");
        if (beforeRunId !== null && !workflow.queuedRuns.some((entry) => entry.run.id === beforeRunId)) throw new Error("The destination message is no longer queued.");
        await this.client.dispatch({ ...command, type: "queued-run.reorder", runId: entry.run.id, beforeRunId });
      } else throw new Error("Unknown queue action.");
    });
  }
  async prepareTurnDiff(id: string, sourceId: string, itemId: string, viewId = SIDEBAR_VIEW_ID): Promise<TurnDiff> {
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceId);
    const row = this.threads.get(id)?.projection?.visibleTurnItems.find((row) => row.sourceThreadId === sourceId && row.sourceItemId === itemId);
    if (row?.item.type !== "checkpoint") throw new Error("The selected item is not a saved turn checkpoint.");
    const projection = await this.client.getThreadProjection(sourceId);
    const range = turnCheckpointRange(projection, row.item.checkpointId);
    const patch = await this.client.getSavedTurnDiff(range);
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceId);
    const files = turnDiffFiles(patch);
    if (!files.length) throw new Error("This turn has no saved file changes.");
    return { ...range, files };
  }
  async loadTurnDiffFile(diff: TurnDiff, file: TurnDiffFile, viewId = SIDEBAR_VIEW_ID) {
    this.requireView(viewId); this.requireThread(diff.threadId);
    const result = await this.client.getDiffFileContents(turnDiffFileRequest(diff, file));
    this.requireView(viewId); this.requireThread(diff.threadId);
    return result;
  }
  async chatAsset(id: string, source: ChatAssetSource, reference: ChatAssetReference, viewId = SIDEBAR_VIEW_ID) {
    this.requireView(viewId); this.requireThread(id);
    const row = this.threads.get(id)?.projection?.visibleTurnItems.find((row) => row.sourceThreadId === source.sourceThreadId && row.sourceItemId === source.itemId);
    if (!row) throw new Error("The visual's message is no longer available. Load its history and try again.");
    const item = row.item;
    let resource: Parameters<HostTransport["createAssetUrl"]>[0];
    if (reference.kind === "html") {
      const visual = htmlVisual(Schema.encodeSync(OrchestrationV2TurnItemJson)(item));
      if (!visual) throw new Error("This item has no rendered HTML page.");
      resource = { _tag: "attachment", attachmentId: visual.attachmentId, fileName: "visualization.html", mimeType: "text/html", disposition: "inline" };
    } else if (reference.kind === "attachment") {
      const attachment = item.type === "user_message" ? item.attachments.find((entry) => entry.id === reference.attachmentId) : null;
      if (!attachment) throw new Error("This attachment does not belong to the selected message.");
      resource = { _tag: "attachment", attachmentId: attachment.id, fileName: attachment.name, mimeType: attachment.mimeType, disposition: "inline" };
    } else {
      const text = "text" in item && typeof item.text === "string" ? item.text : item.type === "subagent" ? item.result ?? item.progress ?? item.prompt : "";
      if (!text.includes(reference.path) && !text.includes(encodeURI(reference.path)) && !(item.type === "dynamic_tool" && item.viewedImagePath === reference.path)) throw new Error("This media reference does not belong to the selected message.");
      const thread = this.findThread(source.sourceThreadId) ?? this.requireThread(id);
      const cwd = this.workspaceForThread(thread.id) ?? undefined;
      const media = classifyMarkdownImageSource(reference.path, cwd);
      if (media._tag !== "WorkspaceFile") throw new Error("Unsupported local media reference.");
      resource = { _tag: "media-file", threadId: ThreadId.make(source.sourceThreadId), path: media.path };
    }
    const result = await this.client.createAssetUrl(resource);
    this.requireView(viewId); this.requireThread(id);
    return result;
  }
  private presentItem(item: OrchestrationV2TurnItem): Omit<TranscriptItem, "key" | "sourceThreadId"> {
    const cached = this.encodedItems.get(item);
    if (cached) return cached;
    const tool = resolveWorkEntryToolPresentation({ label: item.title ?? item.type, structuredPayload: item });
    const result = { item: Schema.encodeSync(OrchestrationV2TurnItemJson)(item), toolLabel: tool?.displayName ?? null,
      output: turnItemOutputText(item), needsDetail: turnItemNeedsDetailFetch(item) };
    this.encodedItems.set(item, result); return result;
  }
  snapshot(viewId = SIDEBAR_VIEW_ID): HostStateSnapshot {
    const view = this.requireView(viewId);
    const activeThreadId = this.findThread(view.activeThreadId)?.id;
    const state = activeThreadId ? this.threads.get(activeThreadId) : undefined;
    const projection = state?.projection;
    const descriptor = this.server?.descriptor;
    const threads = this.visibleThreads();
    const visibleThreadIds = new Set(threads.map((thread) => thread.id));
    const accepted = activeThreadId ? this.acceptedMessages.get(activeThreadId) : undefined;
    const acceptedRun = accepted ? projection?.runs.find(run => run.userMessageId === accepted.messageId) : undefined;
    const observedActive = threadActiveRun(projection);
    const acknowledgedWorking = accepted && !observedActive && !(acceptedRun && ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(acceptedRun.status)) ? accepted : undefined;
    if (accepted && !acknowledgedWorking && activeThreadId) this.acceptedMessages.delete(activeThreadId);
    return {
      ...(acknowledgedWorking ? { acknowledgedWorking } : {}),
      revision: this.revision, phase: this.phase, home: this.options.home,
      connectionSetup: { ...this.setup, ...(this.connectionProblem ? { problem: this.connectionProblem } : {}) },
      searchPreferences: this.searchPreferences,
      ...(this.sessionSearches.get(viewId) ? { sessionSearch: this.sessionSearches.get(viewId)!.state } : {}),
      workspaceRoots: this.workspaceRoots(), messageNavigation: resolveMessageNavigation(this.options.messageNavigation?.()),
      appearance: resolveAppearance(this.options.appearance?.() ?? DEFAULT_APPEARANCE),
      ...(this.notice ? { notice: this.notice } : {}),
      ...(descriptor ? { environment: { environmentId: descriptor.environmentId, label: descriptor.label, serverVersion: descriptor.serverVersion } } : {}),
      projects: this.visibleProjects().map((project) => ({ id: project.id, title: project.title, workspaceRoot: project.workspaceRoot })),
      threads: threads.map((thread) => ({
        id: thread.id, projectId: thread.projectId, title: thread.title, status: thread.status,
        modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode,
        updatedAt: DateTime.formatIso(thread.updatedAt), archived: thread.archivedAt !== null, pinned: thread.pinnedAt != null,
        activeRunId: thread.activeRunId,
        workingStartedAt: thread.activityRunStartedAt !== undefined
          ? (thread.activityRunStartedAt ? DateTime.formatIso(thread.activityRunStartedAt) : null)
          : thread.activeRunId && thread.activeRunId === thread.latestRunId && !thread.latestRunCompletedAt
            ? (thread.latestRunStartedAt || thread.latestRunRequestedAt ? DateTime.formatIso((thread.latestRunStartedAt ?? thread.latestRunRequestedAt)!) : null) : null,
        settled: thread.settledOverride === "settled", searchTerms: threadPullRequestSearchTerms(thread),
        branch: thread.branch,
        parentThreadId: thread.lineage.parentThreadId && visibleThreadIds.has(thread.lineage.parentThreadId) ? thread.lineage.parentThreadId : null,
        relationshipToParent: thread.lineage.relationshipToParent,
        providerNativeSubagent: thread.lineage.relationshipToParent === "subagent" && thread.creationSource === "provider",
        activityRunStatus: thread.activityRunStatus ?? null,
        pendingRuntimeRequest: (() => {
          const request = thread.pendingRuntimeRequest ?? this.threads.get(thread.id)?.projection?.runtimeRequests.find((request) => request.status === "pending");
          return request ? { id: request.id, kind: request.kind, createdAt: DateTime.formatIso(request.createdAt) } : null;
        })(),
      })),
      providers: this.client.config?.providers ?? [],
      archiveLoaded: this.archive !== null,
      usageLimitSources: this.client.config?.usageLimitSources ?? [],
      favoriteModels: this.modelPreferences().favoriteModels,
      providerModelPreferences: this.modelPreferences().providerModelPreferences,
      draft: this.conversationDraft(view),
      ...(activeThreadId ? { activeThreadId } : {}),
      ...conversationActivity(projection),
      transcript: projection ? this.projectQuestionHistory(projection).filter((row) => !turnItemIsWorkspacePreparation(row.item)).map((row) => ({
        key: `${row.sourceThreadId}:${row.sourceItemId}`, sourceThreadId: row.sourceThreadId, sourceItemId: row.sourceItemId,
        ...this.presentItem(row.item), canFork: visibleThreadIds.has(row.sourceThreadId) && this.canForkRow(projection, row),
      })) : [],
      pending: projection ? derivePendingThreadRequests(projection) : { approvals: [], userInputs: [] },
      history: { hasMore: state?.history.hasMoreHistory ?? false, loading: state?.history.loading ?? false, error: state?.history.error ?? null },
      threadLoading: state?.loading ?? false, sending: view.sending,
    };
  }
  webUiUrl(viewId = SIDEBAR_VIEW_ID): string {
    if (!this.server || this.phase !== "ready") throw new Error("Connect to a local T3 Code server first.");
    const origin = this.server.runtime?.devUrl || this.server.origin;
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid T3 web UI address.");
    // Browser pairing cookies belong to localhost, independently of the RPC origin.
    if (["127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = "localhost";
    const threadId = this.snapshot(viewId).activeThreadId;
    url.pathname = threadId ? `/${encodeURIComponent(this.server.descriptor.environmentId)}/${encodeURIComponent(threadId)}` : "/";
    url.search = ""; url.hash = "";
    return url.href;
  }
  private setPhase(phase: HostPhase, notice?: string, problem?: ConnectionProblem): void {
    this.phase = phase; this.notice = notice; this.connectionProblem = problem; this.emit();
  }
  private scheduleEmit(): void {
    if (this.disposed || this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.emit(); }, 32);
  }
  private emit(): void {
    if (this.disposed) return;
    this.revision += 1;
    for (const [listener, viewId] of this.listeners) listener(this.snapshot(viewId));
  }
  async dispose(): Promise<void> {
    this.composerDrafts.dispose();
    this.disposed = true; this.client.onClose = null; this.client.onConfig = null;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    await this.stopSubscriptions(); await this.client.disconnect(); this.listeners.clear();
  }
}
