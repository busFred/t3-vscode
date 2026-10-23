import { WorktreeCoordinator, parseWorktreeChoice, type WorktreeTransport, type WorktreeHandoff } from "./worktrees.js";
import { repositoryIdentity, worktreeChanges, applyWorktreeFiles, currentBranch } from "./worktreeGit.js";
import type { WorktreeChoice } from "../shared/worktrees.js";
import { DEFAULT_REFRESH_INTERVAL_MINUTES, refreshIntervalMs } from "../shared/refreshSettings.js";
import type { FileReference } from "../shared/composerContext.js";
import { resolveDateFormat, resolveTimeFormat, type DateFormat, type TimeFormat } from "../shared/timeFormat.js";
import { ComposerDraftStore, type StoredComposerDraft } from "./composerDraftStore.js";
import type { ViewDraft } from "../shared/viewDraft.js";
import type { TextSelection } from "../shared/composerAttachments.js";
/** Shared T3 connection and projections, with navigation and drafts owned by each webview. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  ScheduledTaskUpsertInput, type ScheduledTask, OrchestrationV2TurnItemJson, ModelSelection as ModelSelectionSchema, type ChatAttachment, getProviderAttachmentLimitError,
  ProviderApprovalDecision, ProviderInteractionMode, RuntimeMode,
  type OrchestrationV2ShellSnapshot, type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadProjection, type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2TurnItem, type OrchestrationV2ThreadShell, type OrchestrationV2Checkpoint, type ServerConfig, type OrchestrationV2ArchivedShellSnapshot, type OrchestrationV2ArchivedShellStreamItem,
} from "@t3tools/contracts";
import { restoreAttribution, restoreDryRun, restoreExecute, execGit, nodeIo } from "./checkpointRestore.js";
import * as ShellState from "@t3tools/client-runtime/state/shell";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import { derivePendingSecretRequests } from "./pendingSecrets.js";
import { derivePendingThreadRequests, createQuestionHistoryProjector } from "@t3tools/client-runtime/state/thread-requests";
import { turnItemIsWorkspacePreparation } from "@t3tools/client-runtime/state/turn-item-presentation";
import { canForkProjectedAssistantItem, deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import { mergeOlderHistoryIntoProjection, EMPTY_THREAD_HISTORY_META, applyHistoryPageMeta, type ThreadHistoryMeta } from "@t3tools/client-runtime/state/thread-history-merge";
import { resolveWorkEntryToolPresentation } from "@t3tools/client-runtime/work-log/presentation";
import { turnItemNeedsDetailFetch, turnItemOutputText } from "@t3tools/client-runtime/work-log/item-detail";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type { HostStateSnapshot, HostPhase, ModelSelection, TranscriptItem, RequestResponse, SecretRequestAnswerParams, ConversationDraft, ProjectSelection, ProjectSummary, FavoriteModel, ComposerSuggestion, ThreadSearchMatch, RewindMarker, RestoreResult, RestorePreview } from "../shared/bridge.js";
import { slashSuggestions } from "../shared/composerSuggestions.js";
import { hasCompleteProviderWorkspaceSnapshot } from "@t3tools/client-runtime/providerSkills";
import { threadPullRequestSearchTerms } from "@t3tools/shared/threadPullRequests";
import { withSubagentWorkingState, statusIsWorking } from "../shared/sessionTree.js";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { turnCheckpointRange, turnDiffFiles, turnDiffFileRequest, type TurnDiff, type TurnDiffFile } from "./turnDiff.js";
import { attachMergesToTurns, extractFilePatch, type MergeRecord } from "./mergeRecords.js";
import { conversationActivity } from "./conversationActivity.js";
import { latestContextUsage } from "../shared/contextUsage.js";
import { taskEditVersion, supportedSchedule, type TaskOrigin, type ScheduledTaskEditorRequest } from "../shared/scheduledTasks.js";
import { sessionActivityAt } from "./sessionActivity.js";
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
import { defaultProviderModelPreference, getProviderModelPreference, orderedProviderModels, type ModelPickerPreferences } from "../shared/modelPreferences.js";

export type HostTransport = Pick<T3Client, "listScheduledTasks" | "subscribeScheduledTasks" | "upsertScheduledTask" | "setScheduledTaskEnabled" | "runScheduledTask" | "connected" | "onClose" | "onConfig" | "connect" | "disconnect" | "snapshotShell" | "subscribeShell" | "subscribeThread" | "getThreadProjection" | "dispatch" | "answerSecretRequest" | "createProject" | "ensureScratchProject" | "getHistory" | "getTurnItem" | "snapshotArchive" | "subscribeArchive" | "searchThreads" | "searchPaths" | "refreshProviders" | "captureTurnBaseline" | "findTurnBaseline" | "getSavedTurnDiff" | "getDiffFileContents" | "createAssetUrl" | "uploadAttachment" | "deleteAttachment"> & Partial<WorktreeTransport> & { readonly config: Pick<ServerConfig, "providers" | "scratchWorkspaceRoot" | "usageLimitSources"> | null };
export interface HostStateOptions {
  readonly worktreeStorageRoot?: string;
  /** Where "Restore files to this point" saves kept files' pre-restore bytes, before re-applying them. */
  readonly restoreStorageRoot?: string;
  readonly assertTrustedWorkspace?: () => Promise<void>;
  readonly taskOrigins?: () => ReadonlyArray<TaskOrigin>;
  readonly saveTaskOrigin?: (origin: TaskOrigin) => PromiseLike<void>;
  readonly draftStore?: ComposerDraftStore;
  readonly home: string;
  readonly credentials: CredentialStore;
  readonly serverStartupHint?: string | undefined;
  readonly workspaceRoot?: () => string | null;
  readonly workspaceRoots?: () => ReadonlyArray<string>;
  readonly timeFormat?: () => TimeFormat;
  readonly dateFormat?: () => DateFormat;
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
  readonly worktreeRefreshMinutes?: () => number;
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
  workspaceChoice?: WorktreeChoice;
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
  readonly worktrees: WorktreeCoordinator | null;
  private readonly repositoryIdentities = new Map<string, string>();
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
  private archiveLoad: Promise<void> | null = null;
  private archiveGeneration = 0;
  private archiveError: string | undefined;
  private readonly threads = new Map<string, ThreadState>();
  private shellSubscription: Subscription | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private scheduledTasks: ReadonlyArray<ScheduledTask> = [];
  private scheduledTaskError: string | undefined;
  private scheduledTasksLoading = true;
  private scheduledSubscription: Subscription | null = null;
  private scheduledGeneration = 0;
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
  private worktreeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private worktreePoll: ReturnType<typeof setTimeout> | null = null;
  private readonly rewindMarkers = new Map<string, RewindMarker>();
  private readonly restoreResults = new Map<string, RestoreResult>();

  private readonly options: HostStateOptions;
  private readonly client: HostTransport;
  constructor(options: HostStateOptions, client: HostTransport) {
    this.options = options; this.client = client; this.composerDrafts = options.draftStore ?? new ComposerDraftStore();
    this.worktrees = options.worktreeStorageRoot ? new WorktreeCoordinator({ storageRoot: options.worktreeStorageRoot, client,
      scope: () => this.draftScope(), projects: () => this.visibleProjects().map(p => ({ id: p.id, title: p.title, workspaceRoot: p.workspaceRoot, scripts: p.scripts })),
      threads: () => this.visibleThreads().map(t => ({ id: t.id, projectId: t.projectId, title: t.title, status: t.status,
        modelSelection: t.modelSelection, runtimeMode: t.runtimeMode, interactionMode: t.interactionMode,
        branch: t.branch, worktreePath: t.worktreePath, activeRunId: t.activeRunId ?? (this.acceptedMessages.has(t.id) ? "pending" : null),
        updatedAt: DateTime.formatIso(t.updatedAt), archived: t.archivedAt !== null, pinned: t.pinnedAt != null, settled: t.settledOverride === "settled" })),
      windowRoots: () => this.workspaceRoots(), changed: () => this.scheduleEmit(), assertTrusted: options.assertTrustedWorkspace ?? (async () => {}) }) : null;
    this.setup = connectionSetup(options.home, options.serverStartupHint);
    this.searchPreferences = resolveSearchPreferences(options.searchPreferences);
    client.onClose = () => {
      void this.enqueue(() => this.recoverConnection()).catch((cause) => {
        if (!this.disposed) this.setPhase("error", describeError(cause));
      });
    };
    client.onConfig = () => { this.scheduleEmit(); };
    this.refreshIntervalsChanged();
  }
  refreshIntervalsChanged(): void {
    if (this.worktreePoll) clearTimeout(this.worktreePoll);
    this.worktreePoll = null;
    if (!this.worktrees || this.disposed) return;
    const configured = this.options.worktreeRefreshMinutes?.() ?? DEFAULT_REFRESH_INTERVAL_MINUTES;
    const interval = refreshIntervalMs(Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_REFRESH_INTERVAL_MINUTES);
    if (interval === null) return;
    this.worktreePoll = setTimeout(() => {
      this.worktreePoll = null;
      this.scheduleWorktreeRefresh();
      this.refreshIntervalsChanged();
    }, interval);
    this.worktreePoll.unref();
  }
  private scheduleWorktreeRefresh(): void {
    if (!this.worktrees || !this.client.connected || this.disposed || this.worktreeRefreshTimer) return;
    this.worktreeRefreshTimer = setTimeout(() => {
      this.worktreeRefreshTimer = null;
      if (this.client.connected && !this.disposed) void this.refreshRepositoryIdentities().then(() => this.worktrees?.refresh()).catch(() => {});
    }, 150);
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
  /** A new editor inherits defaults, never the source conversation's binding guard. */
  beginNewChat(viewId: string): void {
    const view = this.requireView(viewId);
    if (view.chatActive || view.sending) throw new Error("Create a new editor before choosing its checkout.");
    const draft = this.conversationDraft(view);
    view.draftProjectId = draft.projectId ?? undefined;
    view.draftWorkspaceRoot = draft.workspaceRoot;
    view.draftModelSelection = draft.modelSelection ?? undefined;
    if (draft.workspace) view.workspaceChoice = draft.workspace;
    view.activeThreadId = undefined; view.chatThreadId = undefined;
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
  private async cleanupEmptyThread(id: string, untouchedTitle = "New thread"): Promise<void> {
    if (!this.emptyThreads.has(id) || !this.client.connected || [...this.views.values()].some((view) => view.chatThreadId === id)) return;
    const thread = this.findThread(id);
    if (!thread || (thread.worktreePath && thread.branch) || thread.activeRunId || thread.archivedAt || thread.deletedAt || thread.title !== untouchedTitle || thread.pinnedAt || thread.settledOverride) return;
    // Check durable server data, rather than assuming an unloaded transcript is empty.
    const projection = await this.client.getThreadProjection(id).catch(() => null);
    if (!projection || projection.messages.length || projection.runs.length || projection.visibleTurnItems.some((row) => row.item.type === "user_message" || row.item.type === "assistant_message")
      || projection.thread.title !== untouchedTitle || (projection.thread.worktreePath && projection.thread.branch) || projection.thread.archivedAt || projection.thread.deletedAt || projection.thread.pinnedAt || projection.thread.settledOverride
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
    this.archiveGeneration += 1; this.archiveLoad = null; this.archiveError = undefined;
    for (const viewId of this.sessionSearches.keys()) this.cancelSessionSearch(viewId);
    this.scheduledGeneration += 1;
    await this.scheduledSubscription?.(); this.scheduledSubscription = null;
    this.scheduledTasks = []; this.scheduledTasksLoading = true; this.scheduledTaskError = undefined;
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
      this.repositoryIdentities.clear();
      for (const view of this.views.values()) { delete view.workspaceChoice; Object.assign(view, blankView()); }
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
      await this.refreshRepositoryIdentities();
      this.shellSubscription = await this.client.subscribeShell((item) => this.handleShell(item));
      await this.reconcileViews(true);
      this.setPhase("ready");
      void this.worktrees?.refresh().catch(() => {});
      void this.loadArchive().catch(() => {}); // Archive failures must not block chat startup.
      await this.loadScheduledTasks();
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
    const previousWorkspaces = this.worktreeScopeKey();
    if (item.kind === "snapshot") {
      this.shell = ShellState.mergeShellSnapshotProjects(this.shell, item.snapshot,
        item.resolvedRepositoryIdentityRoots === undefined ? undefined : { resolvedRepositoryIdentityRoots: item.resolvedRepositoryIdentityRoots });
    } else if (this.shell) {
      this.shell = ShellState.applyShellStreamEvent(this.shell, item);
    }
    this.reconcileRemovedThreads();
    this.scheduleEmit();
    if (previousWorkspaces !== this.worktreeScopeKey()) this.scheduleWorktreeRefresh();
  }
  private worktreeScopeKey(): string {
    const projects = this.visibleProjects();
    const ids = new Set(projects.map(project => project.id));
    return JSON.stringify([
      projects.map(project => [project.id, project.workspaceRoot, project.scripts]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [...new Set(this.allThreads().filter(thread => ids.has(thread.projectId) && thread.worktreePath).map(thread => thread.worktreePath!))].sort(),
    ]);
  }
  loadArchive(): Promise<void> { return this.subscribeArchive(); }
  private subscribeArchive(): Promise<void> {
    if (this.archiveSubscription || this.disposed) return Promise.resolve();
    if (this.archiveLoad) return this.archiveLoad;
    const generation = this.archiveGeneration;
    this.archiveError = undefined;
    const current = () => !this.disposed && generation === this.archiveGeneration;
    this.archiveLoad = (async () => {
      try {
        const snapshot = await this.client.snapshotArchive();
        if (!current()) return;
        this.archive = snapshot;
        const subscription = await this.client.subscribeArchive((item) => { if (current()) this.handleArchive(item); });
        if (!current()) { await subscription(); return; }
        this.archiveSubscription = subscription;
      } catch (cause) {
        if (current()) this.archiveError = describeError(cause);
        throw cause;
      } finally {
        if (current()) { this.archiveLoad = null; this.emit(); }
      }
    })();
    this.emit();
    return this.archiveLoad;
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
  private async refreshRepositoryIdentities(): Promise<void> {
    const paths = [...new Set([...this.workspaceRoots(), ...(this.shell?.projects.map(p => p.workspaceRoot) ?? [])])];
    await Promise.all(paths.map(async path => { const identity = await repositoryIdentity(path); if (identity) this.repositoryIdentities.set(this.pathIdentity(path), identity.commonDir); else this.repositoryIdentities.delete(this.pathIdentity(path)); }));
  }
  private projectContainsWorkspace(project: { id: string; workspaceRoot: string }): boolean {
    if (this.pathInWorkspace(project.workspaceRoot)) return true;
    const common = this.repositoryIdentities.get(this.pathIdentity(project.workspaceRoot));
    return this.workspaceRoots().some(root => common && this.repositoryIdentities.get(this.pathIdentity(root)) === common
      || this.allThreads().some(t => t.projectId === project.id && t.worktreePath && this.pathIdentity(t.worktreePath) === this.pathIdentity(root)));
  }
  private visibleProjects() { return this.shell?.projects.filter(project => this.projectContainsWorkspace(project)) ?? []; }
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
      this.repositoryIdentities.clear();
      await this.refreshRepositoryIdentities();
      for (const view of this.views.values()) {
        delete view.workspaceChoice; view.draftProjectId = undefined; view.draftWorkspaceRoot = undefined;
      }
      await this.reconcileViews(true);
      this.scheduleWorktreeRefresh();
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
      delete view.workspaceChoice;
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
      ?? (root ? projects.find((item) => this.pathIdentity(item.workspaceRoot) === this.pathIdentity(root) || this.repositoryIdentities.get(this.pathIdentity(root)) !== undefined && this.repositoryIdentities.get(this.pathIdentity(item.workspaceRoot)) === this.repositoryIdentities.get(this.pathIdentity(root)) || this.allThreads().some(t => t.projectId === item.id && t.worktreePath && this.pathIdentity(t.worktreePath) === this.pathIdentity(root)))
        : view.draftWorkspaceRoot === null ? undefined : projects.find((item) => item.id === active?.projectId));
    const modelSelection = this.availableModel(view.draftModelSelection ?? project?.defaultModelSelection ?? active?.modelSelection);
    const supportsNoProject = !roots.length && availableScratchWorkspaceRoot(this.client.connected ? "connected" : null, this.client.config) !== null;
    const windowWorktree = project && roots.find(path => this.pathIdentity(path) !== this.pathIdentity(project.workspaceRoot)
      && (this.repositoryIdentities.get(this.pathIdentity(path)) !== undefined && this.repositoryIdentities.get(this.pathIdentity(path)) === this.repositoryIdentities.get(this.pathIdentity(project.workspaceRoot))
        || this.allThreads().some(t => t.projectId === project.id && t.worktreePath && this.pathIdentity(t.worktreePath) === this.pathIdentity(path))));
    return { workspace: view.workspaceChoice ?? (active ? active.worktreePath ? { type: "existing", path: active.worktreePath, ...(active.branch ? { branch: active.branch } : {}) } : { type: "root" } : windowWorktree ? { type: "existing", path: windowWorktree } : { type: "root" }), projectId: project?.id ?? null, workspaceRoot: project?.workspaceRoot ?? root, supportsNoProject, modelSelection,
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
    delete view.workspaceChoice;
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
      runtimeMode: this.compatibleRuntimeMode(model, draft.runtimeMode), interactionMode: draft.interactionMode,
      // Bind the directory now, but publish the branch only when a send prepares it.
      // T3's worktree-on-delete policy requires a branch: closing an untouched tab
      // must delete only this new conversation, never its existing checkout.
      branch: null,
      worktreePath: draft.workspace?.type === "existing" ? draft.workspace.path ?? null : null });
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
      let thread = this.requireThread(id);
      if (thread.archivedAt) throw new Error("Restore this thread before sending a message.");
      if (thread.lineage.relationshipToParent === "subagent" && thread.creationSource === "provider") throw new Error("This subagent conversation is controlled by its provider. Return to the parent conversation to send instructions.");
      view.sending = true; this.emit();
      try {
        const choice = view.workspaceChoice ?? this.conversationDraft(view).workspace;
        if (this.worktrees && choice && (this.emptyThreads.has(id) || thread.itemCount === 0)) {
          const allocations = choice.runs?.flatMap(run => Array.from({ length: run.count }, () => run.modelSelection)) ?? [thread.modelSelection];
          for (const model of allocations) this.assertWorktreeModel(model);
          if (allocations.length > 1) {
            await this.sendParallelWorktrees(id, choice, allocations, text, attachments, context, viewId, targetThreadId ?? "new");
            delete view.workspaceChoice;
            await this.completeSentDraft(attachmentIds, targetThreadId ?? "new", viewId);
            return;
          }
          if (choice.runs?.length) await this.applyModelSelection(id, allocations[0], viewId);
          await this.prepareThreadWorkspace(id, choice);
          thread = this.requireThread(id);
          delete view.workspaceChoice;
        } else if (this.worktrees && thread.worktreePath && !thread.activeRunId && !this.acceptedMessages.has(id)) {
          const tree = this.worktrees.snapshot().items.find(w => w.projectId === thread.projectId && w.path === thread.worktreePath);
          if (tree?.missing) await this.worktrees.restore(thread.projectId, thread.worktreePath);
          // Check before preparation so a pinned mismatch does not leave a failed setup attempt behind.
          const checkout = await this.worktrees.requireCheckout(thread.projectId, thread.worktreePath).catch(() => undefined);
          if (checkout && !checkout.tree.root) await this.reconcileThreadBranch(id, checkout.tree.branch || null);
          await this.prepareThreadWorkspace(id, { type: "existing", path: thread.worktreePath });
        }
        const instructions = thread.worktreePath ? await this.worktrees?.environmentInstructions(thread.projectId, thread.worktreePath) : undefined;
        const dispatchText = instructions ? `${text}\n\n<worktree_environment>\n${instructions}\n</worktree_environment>` : text;
        const messageId = randomUUID(), alreadyWorking = !!thread.activeRunId || !!(this.threads.get(id)?.projection && deriveThreadQueueWorkflowState(this.threads.get(id)!.projection!).activeRun) || this.acceptedMessages.has(id);
        const cwd = this.workspaceForThread(id);
        // Queued/steered runs have no reliable pre-execution boundary on the client.
        // Failure to capture must never prevent sending a message.
        if (!alreadyWorking && mode === "auto" && cwd)
          await this.client.captureTurnBaseline(cwd, id, messageId).catch(() => undefined);
        await this.client.dispatch({ type: "message.dispatch", commandId: randomUUID(), threadId: id,
          createdBy: "user", creationSource: "web", messageId, text: dispatchText, attachments, ...(context ? { context } : {}),
          titleSeed: deriveThreadTitleSeed({ text, attachments }), ...(mode !== "queue" ? { deliveryIntent: mode } : {}), dispatchMode: { type: mode === "queue" ? "queue_after_active" : "start_immediately" } });
        this.emptyThreads.delete(id);
        if (!alreadyWorking) this.acceptedMessages.set(id, { messageId, startedAt: new Date().toISOString() });
        await this.completeSentDraft(attachmentIds, targetThreadId ?? "new", viewId);
        if (!targetThreadId && this.views.get(viewId) === view) { view.activeThreadId = id; if (view.chatActive) view.chatThreadId = id; await this.syncThreadSubscriptions(); }
      } catch (cause) {
        if (!targetThreadId && !this.findThread(id)?.worktreePath) await this.cleanupEmptyThread(id).catch(() => undefined);
        throw cause;
      } finally { view.sending = false; this.emit(); }
    });
  }
  private async completeSentDraft(attachmentIds: ReadonlyArray<string>, draftKey: string, owner: string): Promise<void> {
    for (const id of attachmentIds) { const upload = this.uploads.get(id); if (upload) upload.sent = true; }
    const record = this.composerDrafts.owned(this.draftScope(), draftKey, owner);
    if (record) {
      for (const file of record.draft.attachments ?? []) if (file.attachment) await this.releaseAttachment(file.attachment.id, `draft:${record.id}`);
      this.composerDrafts.save(record, { text: "", contexts: [] }); this.composerDrafts.flush();
    }
  }
  async refreshWorktrees(cleanupEnvironments = false): Promise<void> {
    this.shell = await this.client.snapshotShell(); await this.refreshRepositoryIdentities(); await this.worktrees?.refresh(); this.emit();
    if (cleanupEnvironments) { await this.worktrees?.cleanupMissingEnvironments(); this.emit(); }
  }
  async configureWorktree(input: unknown, projectId: string | undefined, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    if (!this.worktrees) throw new Error("Worktree support is unavailable.");
    const choice = parseWorktreeChoice(input), view = this.requireView(viewId), thread = this.findThread(view.activeThreadId);
    if (thread && !this.emptyThreads.has(thread.id) && thread.itemCount > 0) throw new Error("An existing conversation keeps its checkout. Start a new conversation or use Continue in worktree.");
    if (thread?.activeRunId || view.sending) throw new Error("Wait for the current operation before changing the workspace.");
    if (projectId && thread && thread.projectId !== projectId) throw new Error("Open a new chat for another project.");
    if (projectId) this.applyProjectSelection(view, { projectId });
    const project = projectId ?? thread?.projectId ?? this.conversationDraft(view).projectId;
    if (!project) throw new Error("Choose a project first.");
    if (choice.type === "existing") await this.worktrees.requireCheckout(project, choice.path!);
    for (const run of choice.runs ?? []) this.assertWorktreeModel(run.modelSelection);
    view.workspaceChoice = choice; this.emit();
  }
  private assertWorktreeModel(selection: ModelSelection) {
    const provider = this.client.config?.providers.find(p => p.instanceId === selection.instanceId);
    const model = provider?.models.find(m => m.slug === selection.model);
    if (!provider?.enabled || !provider.installed || provider.availability === "unavailable" || !model) throw new Error("Choose an available model for each run.");
    Schema.decodeUnknownSync(ModelSelectionSchema)(selection);
    for (const option of selection.options ?? []) {
      const descriptor = model.capabilities?.optionDescriptors?.find(d => d.id === option.id);
      if (!descriptor || (descriptor.type === "boolean" ? typeof option.value !== "boolean" : typeof option.value !== "string" || !descriptor.options.some(o => o.id === option.value) || descriptor.promptInjectedValues?.includes(option.value))) throw new Error("A run uses an unsupported model option.");
    }
  }
  private async bindEmptyThread(id: string, path: string | null, branch: string | null): Promise<void> {
    const current = this.requireThread(id);
    const existing = !!(current.activeRunId || this.acceptedMessages.has(id) || (!this.emptyThreads.has(id) && current.itemCount > 0));
    // The folder is the binding; a branch switched inside it follows the session's branch policy.
    if (existing && path && current.worktreePath === path) await this.reconcileThreadBranch(id, branch || null);
    else if (current.worktreePath !== path || current.branch !== branch) {
      if (existing) throw new Error("Cannot change an existing conversation’s checkout.");
      await this.client.dispatch({ type: "thread.metadata.update", commandId: randomUUID(), threadId: id, worktreePath: path, branch, expectedWorktreePath: current.worktreePath, expectedEmpty: true });
      this.shell = await this.client.snapshotShell(); await this.syncThreadSubscriptions();
    }
    // Once a checkout exists, a failed preparation retries it instead of creating another.
    for (const view of this.views.values()) if (view.activeThreadId === id) view.workspaceChoice = path ? { type: "existing", path, ...(branch ? { branch } : {}) } : { type: "root" };
    this.emit();
  }
  /** Applies the session branch policy when its checkout is on another branch than the session records. */
  private async reconcileThreadBranch(id: string, branch: string | null): Promise<void> {
    const current = this.requireThread(id);
    if (current.branch === branch || !current.worktreePath) return;
    if (await this.worktrees!.branchPolicy(current.projectId, id) === "pinned")
      throw new Error(`This session is pinned to ${current.branch ? `branch ${current.branch}` : "a detached checkout"}, but its checkout is on ${branch ? `branch ${branch}` : "a detached HEAD"}. Open Session checkout to use the current branch or switch the checkout back.`);
    // Same compare-and-set T3 uses when it renames a shared worktree branch.
    await this.client.dispatch({ type: "thread.metadata.update", commandId: randomUUID(), threadId: id, branch, expectedWorktreePath: current.worktreePath });
    this.shell = await this.client.snapshotShell(); this.emit();
  }
  /** Records the checkout's current branch as this session's branch. */
  adoptCheckoutBranch(threadId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.worktrees) throw new Error("Worktree support is unavailable.");
      const thread = this.requireThread(threadId);
      if (!thread.worktreePath) throw new Error("This session uses the main checkout.");
      const { tree } = await this.worktrees.requireCheckout(thread.projectId, thread.worktreePath);
      if (thread.branch === (tree.branch || null)) return;
      await this.client.dispatch({ type: "thread.metadata.update", commandId: randomUUID(), threadId, branch: tree.branch || null, expectedWorktreePath: thread.worktreePath });
      this.shell = await this.client.snapshotShell(); this.emit();
    });
  }
  /** Switches the session's checkout back to the branch the session records. */
  switchCheckoutToSessionBranch(threadId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.worktrees) throw new Error("Worktree support is unavailable.");
      const thread = this.requireThread(threadId);
      if (!thread.worktreePath) throw new Error("This session uses the main checkout.");
      if (!thread.branch) throw new Error("This session does not record a branch.");
      // Another session in the same folder may have a message accepted before its run appears.
      if ((this.shell?.threads ?? []).some(t => t.worktreePath === thread.worktreePath && (t.activeRunId || this.acceptedMessages.has(t.id)))) throw new Error("Wait for the current run before switching branches.");
      await this.worktrees.switchBranch(thread.projectId, thread.worktreePath, thread.branch);
      this.emit();
    });
  }
  async setSessionBranchPolicy(threadId: string, policy: unknown): Promise<void> {
    if (!this.worktrees) throw new Error("Worktree support is unavailable.");
    if (policy !== null && policy !== "follow" && policy !== "pinned") throw new Error("Invalid branch policy.");
    const thread = this.requireThread(threadId);
    await this.worktrees.setSessionBranchPolicy(thread.projectId, threadId, policy);
  }
  async prepareThreadWorkspace(id: string, choice: WorktreeChoice, group?: { groupId: string; title: string }): Promise<void> {
    if (!this.worktrees) throw new Error("Worktree support is unavailable.");
    const thread = this.requireThread(id);
    // A preparation attempt represents user work even when setup fails before a run starts.
    this.emptyThreads.delete(id);
    await this.worktrees.prepare(thread.projectId, id, choice, (path, branch) => this.bindEmptyThread(id, path, branch), group);
  }
  async retryWorktreePreparation(id: string): Promise<void> {
    if (!this.worktrees) throw new Error("Worktree support is unavailable.");
    const preparation = this.worktrees.snapshot().preparations.find(p => p.id === id);
    if (!preparation) throw new Error("Refresh worktrees before retrying setup.");
    const handoff = this.worktrees.handoffFor(id);
    await this.worktrees.retry(id, preparation.threadId && !preparation.threadId.startsWith("checkout:") ? (path, branch) => handoff
      ? this.bindContinuedThread(preparation.threadId!, path, branch, handoff)
      : this.bindEmptyThread(preparation.threadId!, path, branch) : undefined);
  }
  private async bindContinuedThread(id: string, path: string | null, branch: string | null, handoff: WorktreeHandoff): Promise<void> {
    if (!path) throw new Error("A worktree is required to continue.");
    this.shell = await this.client.snapshotShell();
    const current = this.requireThread(id);
    if (current.worktreePath === path) return; // The metadata response may have been lost after commit.
    if (current.worktreePath || current.activeRunId || current.archivedAt || this.acceptedMessages.has(id)) throw new Error("The conversation changed while preparing its worktree.");
    const root = this.visibleProjects().find(p => p.id === current.projectId)?.workspaceRoot;
    if (!root) throw new Error("The project is no longer available.");
    if (handoff.copyEdits && handoff.files.length) {
      if ((await worktreeChanges({ projectRoot: root, path: root, baseRef: "HEAD" })).baseRef !== handoff.baseRef) throw new Error("The source branch changed during handoff. Restore the original branch before retrying.");
      await applyWorktreeFiles({ projectRoot: root, path: root, destination: path, baseRef: handoff.baseRef, files: [...handoff.files], allowAlreadyApplied: true });
    }
    await this.client.dispatch({ type: "thread.metadata.update", commandId: randomUUID(), threadId: id, worktreePath: path, branch, expectedWorktreePath: null });
    this.shell = await this.client.snapshotShell(); await this.syncThreadSubscriptions();
    for (const view of this.views.values()) if (view.activeThreadId === id) view.workspaceChoice = { type: "existing", path, ...(branch ? { branch } : {}) };
    this.emit();
  }
  continueInWorktree(viewId = SIDEBAR_VIEW_ID, copyEdits = false): Promise<void> {
    return this.enqueue(async () => {
      if (!this.worktrees) throw new Error("Worktree support is unavailable.");
      const view = this.requireView(viewId), id = view.activeThreadId;
      if (!id) throw new Error("Open a conversation first.");
      const thread = this.requireThread(id);
      if (thread.lineage.relationshipToParent === "subagent" && thread.creationSource === "provider") throw new Error("This subagent conversation is controlled by its provider. Continue from its parent conversation.");
      if (thread.worktreePath || thread.activeRunId || thread.archivedAt || this.acceptedMessages.has(id) || view.sending) throw new Error("Only an idle conversation in the main checkout can continue in a new worktree.");
      const root = this.workspaceForThread(id)!;
      const changes = await worktreeChanges({ projectRoot: root, path: root, baseRef: "HEAD" });
      const handoff: WorktreeHandoff = { copyEdits, baseRef: changes.baseRef, files: changes.files.map(f => f.path) };
      view.sending = true; this.emit();
      try {
        await this.worktrees.prepare(thread.projectId, id, { type: "new", baseRef: changes.baseRef, startFromOrigin: false },
          (path, branch) => this.bindContinuedThread(id, path, branch, handoff), { handoff });
      } finally { view.sending = false; this.emit(); }
    });
  }
  private async sendParallelWorktrees(firstId: string, choice: WorktreeChoice, models: ReadonlyArray<ModelSelection>, text: string, attachments: ReadonlyArray<ChatAttachment>, context: unknown, viewId: string, draftKey: string) {
    const initial = this.requireThread(firstId), view = this.requireView(viewId), ids = [firstId], group = { groupId: randomUUID(), title: deriveThreadTitleSeed({ text, attachments }) };
    const sourceDraft = this.composerDrafts.owned(this.draftScope(), draftKey, viewId);
    const pendingDraft = sourceDraft?.draft ?? { text, contexts: [] };
    const titles = new Map<string, string>();
    try {
      for (let i = 1; i < models.length; i++) {
        const id = randomUUID(), title = `${group.title} · ${i + 1}`;
        ids.push(id); titles.set(id, title); this.emptyThreads.add(id);
        await this.client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId: id, projectId: initial.projectId,
          createdBy: "user", creationSource: "web", title, modelSelection: models[i],
          runtimeMode: this.compatibleRuntimeMode(models[i]!, initial.runtimeMode), interactionMode: initial.interactionMode, branch: null, worktreePath: null });
      }
      this.shell = await this.client.snapshotShell();
    } catch (cause) {
      // Nothing has been prepared or sent yet. Re-read even after a lost create response
      // and remove only our still-untouched siblings, before claiming any draft leases.
      this.shell = await this.client.snapshotShell().catch(() => this.shell);
      for (const id of ids.slice(1)) await this.cleanupEmptyThread(id, titles.get(id)!).catch(() => undefined);
      throw cause;
    }
    let results: PromiseSettledResult<void>[];
    try {
      for (const id of ids) {
        if (id === firstId && draftKey === firstId) continue;
        const owner = id === firstId ? viewId : `worktree-run:${id}`, draft = this.composerDrafts.claim(this.draftScope(), id, owner);
        this.composerDrafts.save(draft, structuredClone(pendingDraft), sourceDraft?.selection);
        for (const file of draft.draft.attachments ?? []) if (file.attachment) {
          this.composerDrafts.copyAttachmentFile(draft, file.key, file.attachment.id);
          this.uploads.get(file.attachment.id)?.owners.add(`draft:${draft.id}`);
        }
      }
      this.composerDrafts.flush();
      results = await Promise.allSettled(ids.map(async (id, i) => {
        await this.applyModelSelection(id, models[i], viewId);
        const { runs: _runs, ...single } = choice;
        await this.prepareThreadWorkspace(id, { ...single, ...(choice.branch ? { branch: `${choice.branch}-${i + 1}` } : {}) }, group);
        const t = this.requireThread(id), instructions = t.worktreePath ? await this.worktrees?.environmentInstructions(t.projectId, t.worktreePath) : undefined;
        const messageId = randomUUID();
        if (t.worktreePath) await this.client.captureTurnBaseline(t.worktreePath, id, messageId).catch(() => undefined);
        await this.client.dispatch({ type: "message.dispatch", commandId: randomUUID(), threadId: id, createdBy: "user", creationSource: "web", messageId,
          text: instructions ? `${text}\n\n<worktree_environment>\n${instructions}\n</worktree_environment>` : text, attachments, ...(context ? { context } : {}), titleSeed: deriveThreadTitleSeed({ text, attachments }), dispatchMode: { type: "start_immediately" } });
        this.emptyThreads.delete(id); this.acceptedMessages.set(id, { messageId, startedAt: new Date().toISOString() });
        for (const attachment of attachments) { const upload = this.uploads.get(attachment.id); if (upload) upload.sent = true; }
        if (id !== firstId || draftKey !== firstId) await this.completeSentDraft(attachments.map(a => a.id), id, id === firstId ? viewId : `worktree-run:${id}`);
      }));
    } finally {
      for (const id of ids.slice(1)) this.composerDrafts.release(`worktree-run:${id}`);
    }
    const failed = results.flatMap((r, i) => r.status === "rejected" ? [`Run ${i + 1}: ${describeError(r.reason)}`] : []);
    if (failed.length) this.notice = `${failed.join("; ")}. Successful runs were not repeated. Retry preparation in the failed checkout, then send its prompt.`;
    view.activeThreadId = firstId; if (view.chatActive) view.chatThreadId = firstId;
    await this.syncThreadSubscriptions(); this.emit();
    if (results[0]?.status === "rejected") throw new Error(this.notice);
  }
  referenceForView(reference: FileReference, viewId: string): FileReference {
    const root = this.referenceRoot(viewId);
    const label = root ? relative(root, reference.path).replaceAll("\\", "/") : reference.path;
    return { ...reference, label: !root || label === ".." || label.startsWith("../") || isAbsolute(label) ? reference.path : label };
  }
  private referenceRoot(viewId: string): string | null {
    const view = this.requireView(viewId), thread = this.findThread(view.activeThreadId), draft = this.conversationDraft(view);
    if (thread && thread.itemCount > 0) return this.workspaceForThread(thread.id);
    const choice = view.workspaceChoice ?? draft.workspace;
    if (choice?.type === "new" || choice?.type === "pr" || choice?.type === "branch") return null;
    if (choice?.type === "existing") return choice.path ?? null;
    return this.visibleProjects().find(p => p.id === (thread?.projectId ?? draft.projectId))?.workspaceRoot ?? draft.workspaceRoot;
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
  reorderModel(instanceId: string, model: string, before: unknown, expectedOrder: unknown): Promise<void> {
    return this.enqueue(async () => {
      const provider = this.client.config?.providers.find((entry) => entry.instanceId === instanceId);
      if (!provider?.models.some((entry) => entry.slug === model)) throw new Error("Model not found.");
      const current = this.modelPreferences();
      const previous = getProviderModelPreference(current.providerModelPreferences, instanceId) ?? defaultProviderModelPreference(provider);
      const order = orderedProviderModels(provider, previous).map((entry) => entry.slug);
      if (!Array.isArray(expectedOrder) || JSON.stringify(expectedOrder) !== JSON.stringify(order)) throw new Error("Model order changed. Try the move again.");
      if (before !== null && (typeof before !== "string" || !order.includes(before))) throw new Error("Invalid model destination.");
      if (before === model) return;
      const next = order.filter((slug) => slug !== model);
      next.splice(before === null ? next.length : next.indexOf(before as string), 0, model);
      if (next.every((slug, index) => slug === order[index])) return;
      await this.saveModelPreferences({ ...current, providerModelPreferences: { ...current.providerModelPreferences,
        [instanceId]: { ...previous, modelOrder: [...next, ...previous.modelOrder.filter((slug) => !order.includes(slug))] } } });
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
  /** The secret is passed straight to T3 and is never stored, logged or echoed in errors. */
  answerSecretRequest(input: SecretRequestAnswerParams): Promise<void> {
    return this.enqueue(async () => {
      this.requireThread(input.threadId);
      await this.client.answerSecretRequest(input);
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
  /** The checkpoint saved just before a user message's run — reused by both "Edit from here" and "Restore files". */
  private revertTarget(projection: OrchestrationV2ThreadProjection, row: OrchestrationV2ThreadProjection["visibleTurnItems"][number]): { checkpoint: OrchestrationV2Checkpoint; turnNumber?: number } | null {
    const item = row.item;
    if (item.type !== "user_message") return null;
    const run = projection.runs.find((run) => run.userMessageId === item.messageId);
    const after = run ? projection.visibleTurnItems.find((entry) => entry.item.type === "checkpoint" && entry.item.runId === run.id) : undefined;
    if (after?.item.type !== "checkpoint") return null;
    let range: ReturnType<typeof turnCheckpointRange>;
    try { range = turnCheckpointRange(projection, after.item.checkpointId); } catch { return null; }
    const checkpoint = projection.checkpoints.find((entry) => entry.ref === range.baseRef);
    if (!checkpoint || checkpoint.status !== "ready") return null;
    return { checkpoint, ...(range.turnNumber !== undefined ? { turnNumber: range.turnNumber } : {}) };
  }
  private latestReadyCheckpoint(projection: OrchestrationV2ThreadProjection, scopeId: string): OrchestrationV2Checkpoint | undefined {
    return projection.checkpoints.filter((entry) => entry.scopeId === scopeId && entry.status === "ready")
      .sort((a, b) => b.ordinalWithinScope - a.ordinalWithinScope)[0];
  }
  private providerSupportsRollback(projection: OrchestrationV2ThreadProjection): boolean {
    const providerThread = projection.providerThreads.find((thread) => thread.id === projection.thread.activeProviderThreadId);
    const session = projection.providerSessions.find((session) => session.id === providerThread?.providerSessionId);
    return !!session?.capabilities.checkpointing.providerCanRollbackConversation;
  }
  /** `revertTurnCount` gates "Restore files" (checkpoint-only); `canRevert` additionally gates "Edit from here" (needs rollback support and no active run). */
  private transcriptRevertFields(projection: OrchestrationV2ThreadProjection, row: OrchestrationV2ThreadProjection["visibleTurnItems"][number], threadId: string | undefined): { canRevert?: boolean; revertTurnCount?: number } {
    const target = this.revertTarget(projection, row);
    if (!target) return {};
    const canRevert = !!threadId && !this.findThread(threadId)?.activeRunId && this.providerSupportsRollback(projection);
    return { ...(canRevert ? { canRevert: true } : {}), ...(target.turnNumber !== undefined ? { revertTurnCount: target.turnNumber } : {}) };
  }
  /** Rewind marker and most recent restore result for the active thread, clearing a marker once a later turn completes. */
  private revertState(threadId: string, projection: OrchestrationV2ThreadProjection | null | undefined): { rewindMarker?: RewindMarker | null; restoreResult?: RestoreResult | null; rollbackFailure?: string | null } {
    const marker = this.rewindMarkers.get(threadId);
    if (marker && projection?.runs.some((run) => run.status === "completed" && run.completedAt && DateTime.toEpochMillis(run.completedAt) > Date.parse(marker.rewoundAt))) this.rewindMarkers.delete(threadId);
    const current = this.rewindMarkers.get(threadId);
    const restore = this.restoreResults.get(threadId);
    return { ...(current !== undefined ? { rewindMarker: current } : {}), ...(restore !== undefined ? { restoreResult: restore } : {}),
      ...(projection?.thread.rollbackFailure ? { rollbackFailure: projection.thread.rollbackFailure.message } : {}) };
  }
  /** Conversation-only rewind: `restoreFiles: false` means the server never touches the working tree; see restoreFiles() for the extension-owned file restore. */
  revertConversation(id: string, sourceThreadId: string, itemId: string, viewId = SIDEBAR_VIEW_ID): Promise<{ text: string }> {
    return this.enqueue(async () => {
      this.requireView(viewId);
      if (this.requireThread(id).activeRunId || this.requireThread(sourceThreadId).activeRunId) throw new Error("Wait for the current response to finish before rewinding.");
      const projection = await this.client.getThreadProjection(sourceThreadId);
      this.requireView(viewId); this.requireThread(id); this.requireThread(sourceThreadId);
      const row = projection.visibleTurnItems.find((entry) => entry.sourceThreadId === sourceThreadId && entry.sourceItemId === itemId);
      if (!row || row.item.type !== "user_message") throw new Error("This message cannot be rewound.");
      const target = this.revertTarget(projection, row);
      if (!target || !this.providerSupportsRollback(projection)) throw new Error("This conversation cannot be rewound.");
      const messages = projection.visibleTurnItems.filter((entry) => entry.item.type === "user_message" || entry.item.type === "assistant_message");
      const index = messages.findIndex((entry) => entry === row);
      const rewoundMessageCount = index >= 0 ? messages.length - index : 1;
      await this.client.dispatch({ type: "checkpoint.rollback", restoreFiles: false, commandId: randomUUID(), threadId: sourceThreadId, scopeId: target.checkpoint.scopeId, checkpointId: target.checkpoint.id });
      this.rewindMarkers.set(id, { checkpointId: target.checkpoint.id, scopeId: target.checkpoint.scopeId, ...(target.turnNumber !== undefined ? { turnNumber: target.turnNumber } : {}), rewoundAt: new Date().toISOString(), rewoundMessageCount });
      this.restoreResults.delete(id);
      this.emit();
      return { text: row.item.text };
    });
  }
  dismissRewindMarker(id: string, viewId = SIDEBAR_VIEW_ID): Promise<void> {
    return this.enqueue(async () => { this.requireView(viewId); this.requireThread(id); this.rewindMarkers.delete(id); this.emit(); });
  }
  /** Either the user message to restore before, or (from a rewind marker, once that message has scrolled out of the projection) a checkpoint directly. */
  private async resolveRestoreScope(sourceThreadId: string, locator: { itemId: string } | { checkpointId: string; scopeId: string }) {
    const projection = await this.client.getThreadProjection(sourceThreadId);
    let target: { checkpoint: OrchestrationV2Checkpoint; turnNumber?: number } | null;
    if ("itemId" in locator) {
      const row = projection.visibleTurnItems.find((entry) => entry.sourceThreadId === sourceThreadId && entry.sourceItemId === locator.itemId);
      if (!row) throw new Error("This message is no longer available.");
      target = this.revertTarget(projection, row);
    } else {
      const checkpoint = projection.checkpoints.find((entry) => entry.id === locator.checkpointId && entry.scopeId === locator.scopeId);
      target = checkpoint && checkpoint.status === "ready" ? { checkpoint } : null;
    }
    if (!target) throw new Error("This turn's checkpoint is not ready for a restore.");
    const latest = this.latestReadyCheckpoint(projection, target.checkpoint.scopeId);
    if (!latest) throw new Error("No agent checkpoint is available to restore from.");
    const scope = projection.checkpointScopes.find((entry) => entry.id === target.checkpoint.scopeId);
    if (!scope) throw new Error("This conversation's checkpoint scope is unavailable.");
    return { projection, target, latest, scope };
  }
  /** Attribution + dry-run preview for "Restore files to this point"; never touches the working tree. */
  async restorePreview(id: string, sourceThreadId: string, locator: { itemId: string } | { checkpointId: string; scopeId: string }, viewId = SIDEBAR_VIEW_ID): Promise<RestorePreview> {
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceThreadId);
    const { target, latest, scope } = await this.resolveRestoreScope(sourceThreadId, locator);
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceThreadId);
    const attribution = await restoreAttribution(execGit, { cwd: scope.cwd, checkpointRef: target.checkpoint.ref, latestRef: latest.ref });
    const trackedYouPaths = attribution.filter((file) => file.you && !file.you.untracked).map((file) => file.path);
    const verdicts = await restoreDryRun(execGit, { cwd: scope.cwd, checkpointRef: target.checkpoint.ref, latestRef: latest.ref, paths: trackedYouPaths });
    this.requireView(viewId); this.requireThread(id);
    const branch = await currentBranch(scope.cwd).catch(() => "");
    return { cwd: scope.cwd, branch, ...(target.turnNumber !== undefined ? { turnNumber: target.turnNumber } : {}), checkpointAt: DateTime.formatIso(target.checkpoint.capturedAt),
      files: attribution.map((file) => ({ ...file, ...(verdicts[file.path] ? { keepVerdict: verdicts[file.path] } : {}) })) };
  }
  /** Old/new contents for a single restore-preview row, opened through the same native-diff port as turn diffs. */
  async restoreDiffFile(id: string, sourceThreadId: string, locator: { itemId: string } | { checkpointId: string; scopeId: string }, path: string, viewId = SIDEBAR_VIEW_ID): Promise<{ cwd: string; path: string; oldContents: string; newContents: string }> {
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceThreadId);
    const { target, scope } = await this.resolveRestoreScope(sourceThreadId, locator);
    this.requireView(viewId); this.requireThread(id);
    const [oldContents, newContents] = await Promise.all([
      execGit(scope.cwd, ["cat-file", "blob", `${target.checkpoint.ref}:${path}`]).then((buffer) => buffer.toString("utf8")).catch(() => ""),
      readFile(join(scope.cwd, path), "utf8").catch(() => ""),
    ]);
    return { cwd: scope.cwd, path, oldContents, newContents };
  }
  /** Extension-owned restore: snapshots kept files, runs `git restore` + `git clean`, then re-applies kept edits. No stash is created — see docs/feature-history.md. */
  restoreFiles(id: string, sourceThreadId: string, locator: { itemId: string } | { checkpointId: string; scopeId: string }, keep: ReadonlyArray<string>, mode: "keep" | "everything", viewId = SIDEBAR_VIEW_ID): Promise<RestoreResult> {
    return this.enqueue(async () => {
      this.requireView(viewId);
      if (this.requireThread(id).activeRunId || this.requireThread(sourceThreadId).activeRunId) throw new Error("Wait for the current response to finish before restoring files.");
      const { target, latest, scope } = await this.resolveRestoreScope(sourceThreadId, locator);
      this.requireView(viewId); this.requireThread(id); this.requireThread(sourceThreadId);
      if (this.visibleThreads().some((other) => other.activeRunId && this.workspaceForThread(other.id) === scope.cwd)) throw new Error("Another conversation is actively using this checkout. Wait for it to finish before restoring files.");
      const attribution = await restoreAttribution(execGit, { cwd: scope.cwd, checkpointRef: target.checkpoint.ref, latestRef: latest.ref });
      const keepSet = mode === "everything" ? new Set<string>() : new Set(keep);
      const keepTracked = attribution.filter((file) => file.you && !file.you.untracked && keepSet.has(file.path)).map((file) => file.path);
      const keepUntracked = attribution.filter((file) => file.you?.untracked && keepSet.has(file.path)).map((file) => file.path);
      const storageDir = join(this.options.restoreStorageRoot ?? join(tmpdir(), "t3-restore"), id, Date.now().toString(36));
      const files = await restoreExecute(execGit, nodeIo, { cwd: scope.cwd, checkpointRef: target.checkpoint.ref, latestRef: latest.ref, keepTracked, keepUntracked, storageDir });
      const result: RestoreResult = { ...(target.turnNumber !== undefined ? { turnNumber: target.turnNumber } : {}),
        keptCount: keepTracked.length + keepUntracked.length, totalFiles: attribution.length, files, restoredAt: new Date().toISOString(), skippedStash: true };
      this.restoreResults.set(id, result);
      this.emit();
      return result;
    });
  }
  /** The restore result row's "Compare" link: both files are now plain working-tree files, not checkpoint blobs. */
  async compareRestoredFile(id: string, path: string, yoursPath: string, viewId = SIDEBAR_VIEW_ID): Promise<{ cwd: string; path: string; oldContents: string; newContents: string }> {
    this.requireView(viewId); this.requireThread(id);
    const cwd = this.workspaceForThread(id);
    if (!cwd) throw new Error("This conversation's checkout is unavailable.");
    const [restored, yours] = await Promise.all([
      readFile(join(cwd, path), "utf8").catch(() => ""),
      readFile(join(cwd, yoursPath), "utf8").catch(() => ""),
    ]);
    return { cwd, path, oldContents: restored, newContents: yours };
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
    const cwd = this.referenceRoot(viewId) ?? draft.workspaceRoot;
    const selection = thread?.modelSelection ?? draft.modelSelection;
    const instanceId = selection?.instanceId;
    if (kind === "path") {
      if (!cwd) return [];
      const projectId = thread?.projectId ?? draft.projectId;
      const projectRoot = this.visibleProjects().find(p => p.id === projectId)?.workspaceRoot;
      const common = projectRoot ? this.repositoryIdentities.get(this.pathIdentity(projectRoot)) : undefined;
      const sources = [cwd, ...this.workspaceRoots().filter(path => projectRoot && (this.pathIdentity(path) === this.pathIdentity(projectRoot) || common !== undefined && this.repositoryIdentities.get(this.pathIdentity(path)) === common)),
        ...(this.worktrees?.snapshot().items.filter(w => w.projectId === projectId && !w.missing).map(w => w.path) ?? [])];
      const roots = [...new Set(sources.map(path => this.pathIdentity(path)))].slice(0, 20);
      const results = await Promise.allSettled(roots.map(async root => ({ root, result: await this.client.searchPaths(root, query) })));
      this.requireView(viewId);
      const available = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (!available.length && results[0]?.status === "rejected") throw results[0].reason;
      // Each absolute URI identifies its source checkout even when two files share a name.
      return available.flatMap(({ root, result }) => result.entries.map(entry => {
        const path = resolve(root, entry.path), uri = pathToFileURL(path).toString();
        const value = this.referenceForView({ type: "file", path, uri, label: entry.path }, viewId).label;
        return { id: `path:${entry.kind}:${path}`, kind: entry.kind, value, uri, label: basename(entry.path), description: value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "" };
      })).slice(0, 100);
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
  async refreshUsage(instanceId?: string): Promise<void> { await this.client.refreshProviders(instanceId); this.emit(); }
  /** True while any view is sending or any live thread is running, so background work can stay out of the way. */
  get busy(): boolean {
    // Archived threads are visible but cannot run, and a stale activeRunId on one would pin this on forever.
    return [...this.views.values()].some((view) => view.sending)
      || this.visibleThreads().some((thread) => !thread.archivedAt && Boolean(thread.activeRunId));
  }
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
    const checkpointId = row.item.checkpointId;
    const checkpoint = projection.checkpoints.find((entry) => entry.id === checkpointId);
    const run = projection.runs.find((entry) => entry.id === checkpoint?.runId);
    const baseline = run?.userMessageId ? await this.client.findTurnBaseline(range.cwd, sourceId, run.userMessageId) : null;
    if (!baseline) throw new Error("Agent-only diff unavailable: no snapshot was saved before this response. Older, queued, steered, and externally started responses may include manual edits in their checkpoint totals.");
    const patch = await this.client.getSavedTurnDiff({ ...range, baseRef: baseline });
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceId);
    const files = turnDiffFiles(patch);
    const branch = await currentBranch(range.cwd).catch(() => "");
    return { ...range, ...(branch ? { branch } : {}), baseRef: baseline, files };
  }
  /** Merges recorded against `sourceId`'s checkout, attached to the specific checkpoint being diffed. */
  private async mergesForCheckpoint(sourceId: string, checkpointId: string): Promise<ReadonlyArray<MergeRecord>> {
    const store = this.worktrees?.merges;
    if (!store) return [];
    const merges = await store.forThread(sourceId);
    if (!merges.length) return [];
    const projection = await this.client.getThreadProjection(sourceId);
    const turns = projection.checkpoints.filter((checkpoint) => checkpoint.status === "ready" && checkpoint.appRunOrdinal !== null)
      .map((checkpoint) => ({ id: checkpoint.id, capturedAtMs: DateTime.toEpochMillis(checkpoint.capturedAt) }));
    return attachMergesToTurns(merges, turns, null).get(checkpointId) ?? [];
  }
  async turnDiffMerges(id: string, sourceId: string, itemId: string, viewId = SIDEBAR_VIEW_ID): Promise<ReadonlyArray<MergeRecord>> {
    this.requireView(viewId); this.requireThread(id); this.requireThread(sourceId);
    const row = this.threads.get(id)?.projection?.visibleTurnItems.find((row) => row.sourceThreadId === sourceId && row.sourceItemId === itemId);
    if (row?.item.type !== "checkpoint") return [];
    return this.mergesForCheckpoint(sourceId, row.item.checkpointId);
  }
  /** Fallback single-file view: no "before" snapshot is kept for a merge, only the patch that was applied. */
  async mergePatchFile(threadId: string, appliedAt: string, path: string): Promise<{ cwd: string; sourceTitle: string; patchText: string }> {
    this.requireThread(threadId);
    const store = this.worktrees?.merges;
    if (!store) throw new Error("Worktree merges are unavailable.");
    const record = (await store.forThread(threadId)).find((entry) => entry.appliedAt === appliedAt);
    if (!record) throw new Error("This merge record is no longer available.");
    const section = extractFilePatch(await store.readPatch(record), path);
    if (!section) throw new Error("This file is not part of the recorded merge patch.");
    return { cwd: record.cwd, sourceTitle: record.sourceTitle, patchText: section };
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
      ...(this.worktrees ? { worktrees: this.worktrees.snapshot() } : {}),
      revision: this.revision, phase: this.phase, home: this.options.home,
      connectionSetup: { ...this.setup, ...(this.connectionProblem ? { problem: this.connectionProblem } : {}) },
      searchPreferences: this.searchPreferences,
      ...(this.sessionSearches.get(viewId) ? { sessionSearch: this.sessionSearches.get(viewId)!.state } : {}),
      workspaceRoots: this.workspaceRoots(), messageNavigation: resolveMessageNavigation(this.options.messageNavigation?.()),
      dateFormat: resolveDateFormat(this.options.dateFormat?.()), timeFormat: resolveTimeFormat(this.options.timeFormat?.()), appearance: resolveAppearance(this.options.appearance?.() ?? DEFAULT_APPEARANCE),
      ...(this.notice ? { notice: this.notice } : {}),
      ...(descriptor ? { environment: { environmentId: descriptor.environmentId, label: descriptor.label, serverVersion: descriptor.serverVersion } } : {}),
      scheduledTasks: { loading: this.scheduledTasksLoading, ...(this.scheduledTaskError ? { error: this.scheduledTaskError } : {}), tasks: this.scheduledTasks.filter((task) => this.visibleProjects().some((project) => project.id === task.projectId)).map((task) => {
        const association = this.options.taskOrigins?.().find((origin) => origin.environmentId === descriptor?.environmentId && origin.projectId === task.projectId && origin.taskId === task.id);
        const serverOrigin = typeof task.originThreadId === "string" && this.findThread(task.originThreadId)?.projectId === task.projectId ? task.originThreadId : null;
        return { ...task, editVersion: taskEditVersion(task), originThreadId: association ? association.threadId : serverOrigin, originKnown: !!association || serverOrigin !== null };
      }) },
      projects: this.visibleProjects().map((project) => ({ id: project.id, title: project.title, workspaceRoot: project.workspaceRoot })),
      threads: withSubagentWorkingState(threads.map((thread) => {
        // visibleTurnItems lags each thread's own settled record (#the subagent's child thread
        // settles before the parent's turn item stops showing "Running"), so the roster above
        // (backgroundWork) is the primary signal and this transcript scan is only a fallback for
        // servers that predate it.
        const projection = this.threads.get(thread.id)?.projection;
        const hasRunningSubagentItem = !!projection?.visibleTurnItems.some((row) => row.item.type === "subagent" && statusIsWorking(row.item.status));
        const pendingBackgroundTasks = thread.pendingBackgroundTasks ?? [];
        return {
          id: thread.id, projectId: thread.projectId, title: thread.title, status: thread.status,
          modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode,
          updatedAt: DateTime.formatIso(thread.updatedAt), archived: thread.archivedAt !== null, pinned: thread.pinnedAt != null,
          lastActiveAt: sessionActivityAt(thread),
          activeRunId: thread.activeRunId,
          workingStartedAt: thread.activityRunStartedAt !== undefined
            ? (thread.activityRunStartedAt ? DateTime.formatIso(thread.activityRunStartedAt) : null)
            : thread.activeRunId && thread.activeRunId === thread.latestRunId && !thread.latestRunCompletedAt
              ? (thread.latestRunStartedAt || thread.latestRunRequestedAt ? DateTime.formatIso((thread.latestRunStartedAt ?? thread.latestRunRequestedAt)!) : null) : null,
          settled: thread.settledOverride === "settled", searchTerms: threadPullRequestSearchTerms(thread),
          branch: thread.branch, worktreePath: thread.worktreePath,
          canChooseWorkspace: !thread.activeRunId && (this.emptyThreads.has(thread.id) || thread.itemCount === 0) && !thread.archivedAt,
          parentThreadId: thread.lineage.parentThreadId && visibleThreadIds.has(thread.lineage.parentThreadId) ? thread.lineage.parentThreadId : null,
          relationshipToParent: thread.lineage.relationshipToParent,
          providerNativeSubagent: thread.lineage.relationshipToParent === "subagent" && thread.creationSource === "provider",
          activityRunStatus: thread.activityRunStatus ?? null,
          ...(hasRunningSubagentItem ? { waitingOnSubagents: true } : {}),
          ...(pendingBackgroundTasks.length ? { backgroundWork: {
            subagents: pendingBackgroundTasks.filter((task) => task.kind === "subagent").length,
            monitors: pendingBackgroundTasks.filter((task) => task.kind === "monitor").length,
            commands: pendingBackgroundTasks.filter((task) => task.kind === "command").length,
            tasks: pendingBackgroundTasks.filter((task) => task.kind === "background_task").length,
            holdsCompletion: backgroundWorkHoldsCompletion(pendingBackgroundTasks),
            // The roster carries no timestamp per task, so Waiting counts from when the thread's own run ended.
            startedAt: thread.latestRunCompletedAt ? DateTime.formatIso(thread.latestRunCompletedAt) : null,
          } } : {}),
          pendingRuntimeRequest: (() => {
            const request = thread.pendingRuntimeRequest ?? projection?.runtimeRequests.find((request) => request.status === "pending");
            return request ? { id: request.id, kind: request.kind, createdAt: DateTime.formatIso(request.createdAt) } : null;
          })(),
        };
      })),
      providers: this.client.config?.providers ?? [],
      archiveLoaded: this.archive !== null, archiveLoading: this.archiveLoad !== null, ...(this.archiveError ? { archiveError: this.archiveError } : {}),
      usageLimitSources: this.client.config?.usageLimitSources ?? [],
      favoriteModels: this.modelPreferences().favoriteModels,
      providerModelPreferences: this.modelPreferences().providerModelPreferences,
      draft: this.conversationDraft(view),
      ...(activeThreadId ? { activeThreadId } : {}),
      ...(activeThreadId ? this.revertState(activeThreadId, projection) : {}),
      ...conversationActivity(projection),
      contextUsage: latestContextUsage(projection),
      transcript: projection ? this.projectQuestionHistory(projection).filter((row) => !turnItemIsWorkspacePreparation(row.item)).map((row) => {
        const source = this.threads.get(row.sourceThreadId)?.projection ?? projection;
        const status = row.item.type === "checkpoint" ? source.runs.find(run => run.id === row.item.runId)?.status : undefined;
        return { key: `${row.sourceThreadId}:${row.sourceItemId}`, sourceThreadId: row.sourceThreadId, sourceItemId: row.sourceItemId,
          ...this.presentItem(row.item), canFork: visibleThreadIds.has(row.sourceThreadId) && this.canForkRow(projection, row),
          ...(status ? { checkpointRunStatus: status } : {}),
          ...this.transcriptRevertFields(projection, row, activeThreadId),
        };
      }) : [],
      pending: projection ? { ...derivePendingThreadRequests(projection), secrets: derivePendingSecretRequests(projection.visibleTurnItems) } : { approvals: [], userInputs: [], secrets: [] },
      history: { hasMore: state?.history.hasMoreHistory ?? false, loading: state?.history.loading ?? false, error: state?.history.error ?? null },
      threadLoading: state?.loading ?? false, sending: view.sending,
    };
  }
  private async loadScheduledTasks(): Promise<void> {
    const generation = ++this.scheduledGeneration;
    await this.scheduledSubscription?.(); this.scheduledSubscription = null;
    this.scheduledTasksLoading = true; this.scheduledTaskError = undefined; this.scheduleEmit();
    try {
      const result = await this.client.listScheduledTasks();
      if (generation !== this.scheduledGeneration || this.disposed) return;
      this.scheduledTasks = result.tasks; this.scheduledTasksLoading = false;
      this.scheduledSubscription = await this.client.subscribeScheduledTasks((tasks) => {
        if (generation !== this.scheduledGeneration || this.disposed) return;
        this.scheduledTasks = tasks; this.scheduledTaskError = undefined; this.scheduleEmit();
      }, () => { if (generation === this.scheduledGeneration) { this.scheduledTaskError = "Task updates disconnected. Refresh to reconnect."; this.scheduleEmit(); } });
    } catch (cause) { if (generation === this.scheduledGeneration) { this.scheduledTasksLoading = false; this.scheduledTaskError = `Scheduled tasks unavailable: ${describeError(cause)}`; } }
    this.scheduleEmit();
  }
  refreshScheduledTasks(): Promise<void> { return this.enqueue(() => this.loadScheduledTasks()); }
  scheduledTaskEditorRequest(input: Record<string, unknown>): ScheduledTaskEditorRequest {
    const projectId = input.projectId;
    if (typeof projectId !== "string" || !this.visibleProjects().some((project) => project.id === projectId)) throw new Error("Project is not available in this workspace.");
    if (input.taskId !== undefined) {
      if (typeof input.taskId !== "string" || !this.scheduledTasks.some((task) => task.id === input.taskId && task.projectId === projectId)) throw new Error("Task no longer exists in this project.");
      return { taskId: input.taskId, projectId };
    }
    if (input.originThreadId !== undefined && (typeof input.originThreadId !== "string" || this.findThread(input.originThreadId)?.projectId !== projectId)) throw new Error("Origin session is not available in this project.");
    return { projectId, ...(typeof input.originThreadId === "string" ? { originThreadId: input.originThreadId } : {}) };
  }
  private async freshTask(id: string, projectId: string): Promise<ScheduledTask> {
    if (this.phase !== "ready" || !this.visibleProjects().some((project) => project.id === projectId)) throw new Error("Project is not available in this workspace.");
    const result = await this.client.listScheduledTasks(); this.scheduledTasks = result.tasks; this.scheduleEmit();
    const task = result.tasks.find((task) => task.id === id && task.projectId === projectId);
    if (!task) throw new Error("Task no longer exists in this project.");
    return task;
  }
  saveScheduledTask(input: Record<string, unknown>): Promise<void> {
    return this.enqueue(async () => {
      const projectId = input.projectId;
      if (this.phase !== "ready" || typeof projectId !== "string" || !this.visibleProjects().some((project) => project.id === projectId)) throw new Error("Project is not available in this workspace.");
      if (typeof input.id !== "string" || !input.id || typeof input.existing !== "boolean") throw new Error("Invalid task identity.");
      const previous = input.existing ? await this.freshTask(input.id, projectId) : undefined;
      if (previous && input.editVersion !== taskEditVersion(previous)) throw new Error("Task changed elsewhere. Reopen it to load the latest settings; your draft has been kept.");
      if (previous && !supportedSchedule(previous.schedule)) throw new Error("This task uses a newer schedule. Edit it in T3 Web.");
      if (!previous) {
        const tasks = await this.client.listScheduledTasks();
        if (tasks.tasks.some((task) => task.id === input.id)) throw new Error("Task already exists. Reopen it before editing.");
      }
      const selection = Schema.decodeUnknownSync(ModelSelectionSchema)(input.modelSelection);
      const provider = this.client.config?.providers.find((provider) => provider.instanceId === selection.instanceId);
      const model = provider?.models.find((model) => model.slug === selection.model);
      if (!provider?.enabled || !provider.installed || provider.availability === "unavailable" || !model) throw new Error("Choose an available model for this task.");
      const changedModel = !previous || previous.modelSelection.instanceId !== selection.instanceId || previous.modelSelection.model !== selection.model;
      for (const option of selection.options ?? []) {
        if (!changedModel && previous.modelSelection.options?.some((saved) => saved.id === option.id && saved.value === option.value)) continue;
        const descriptor = model.capabilities?.optionDescriptors?.find((entry) => entry.id === option.id);
        if (descriptor?.type === "select" && typeof option.value === "string" && descriptor.promptInjectedValues?.includes(option.value)) throw new Error("This effort is controlled by prompt text. Choose a supported task effort instead.");
        if (!(descriptor?.type === "boolean" ? typeof option.value === "boolean" : descriptor?.type === "select" && descriptor.options.some((entry) => entry.id === option.value))) throw new Error("Choose an advertised model option.");
      }
      const target = input.threadId;
      if (target !== null && (typeof target !== "string" || target !== previous?.threadId && this.findThread(target)?.projectId !== projectId)) throw new Error("Result session is not available in this project.");
      const origin = previous ? undefined : this.scheduledTaskEditorRequest({ projectId, ...(input.originThreadId ? { originThreadId: input.originThreadId } : {}) });
      // Only allow form-owned fields to override the fresh record; retain modes, attribution and newer server fields.
      const payload = Schema.decodeUnknownSync(ScheduledTaskUpsertInput)({ ...previous, id: input.id,
        requireExisting: input.existing, commandId: `vscode-task-${input.id}-${randomUUID()}`,
        title: input.title, prompt: input.prompt, enabled: input.enabled, schedule: input.schedule, projectId,
        threadId: target, workspaceStrategy: input.workspaceStrategy ?? previous?.workspaceStrategy ?? { type: "root" },
        modelSelection: selection, runtimeMode: previous?.runtimeMode ?? this.compatibleRuntimeMode(selection, "full-access"),
        interactionMode: previous?.interactionMode ?? "default", createdBy: previous?.createdBy ?? "user", creationSource: previous?.creationSource ?? "web" });
      if (previous && this.compatibleRuntimeMode(selection, previous.runtimeMode) !== previous.runtimeMode) throw new Error("This model cannot keep the task's permission mode. Choose a compatible provider.");
      if (origin) {
        if (!this.options.saveTaskOrigin) throw new Error("Task origin storage is unavailable.");
        await this.options.saveTaskOrigin({ environmentId: this.server!.descriptor.environmentId, projectId, taskId: input.id, threadId: origin.originThreadId ?? null });
      }
      const result = await this.client.upsertScheduledTask(payload);
      this.scheduledTasks = [...this.scheduledTasks.filter((task) => task.id !== result.task.id), result.task]; this.emit();
    });
  }
  setScheduledTaskEnabled(id: string, projectId: string, enabled: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (typeof enabled !== "boolean") throw new Error("Invalid enabled setting.");
      await this.freshTask(id, projectId);
      const result = await this.client.setScheduledTaskEnabled(id, enabled);
      this.scheduledTasks = this.scheduledTasks.map((task) => task.id === id ? result.task : task); this.emit();
    });
  }
  runScheduledTask(id: string, projectId: string): Promise<void> {
    return this.enqueue(async () => {
      const task = await this.freshTask(id, projectId);
      if (task.lastRunStatus === "running") throw new Error("This task is already running.");
      const result = await this.client.runScheduledTask(id);
      this.scheduledTasks = this.scheduledTasks.map((task) => task.id === id ? result.task : task); this.emit();
    });
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
    if (this.worktreeRefreshTimer) clearTimeout(this.worktreeRefreshTimer);
    if (this.worktreePoll) clearTimeout(this.worktreePoll);
    this.composerDrafts.dispose();
    this.disposed = true; this.worktrees?.dispose(); this.client.onClose = null; this.client.onConfig = null;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    await this.stopSubscriptions(); await this.client.disconnect(); this.listeners.clear();
  }
}
