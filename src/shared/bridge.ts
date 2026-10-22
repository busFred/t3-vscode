import type { DateFormat, TimeFormat } from "./timeFormat.js";
/** UI intents only. T3 credentials, RPCs, projections and subscriptions stay in the host. */
import type {
  OrchestrationV2TurnItemJson,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
  UsageLimitSourceSnapshots,
  OrchestrationThreadSearchMatch,
} from "@t3tools/contracts";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type { AppearanceSettings } from "./appearance.js";
import type { MessageNavigationPlacement } from "./messageNavigation.js";
import type { ConnectionSetup } from "./connectionSetup.js";

import type { SessionSearchState } from "./sessionSearch.js";
import type { SearchPreferences } from "./sessionSearchPresentation.js";
import type { ProviderModelPreferences } from "./modelPreferences.js";

import type { ScheduledTasksState } from "./scheduledTasks.js";

export const Methods = {
  refreshWorktrees: "refreshWorktrees", configureWorktree: "configureWorktree", newWorktreeChat: "newWorktreeChat", worktreeAction: "worktreeAction", saveWorktreeSettings: "saveWorktreeSettings", worktreeReview: "worktreeReview",
  refreshScheduledTasks: "refreshScheduledTasks", saveScheduledTask: "saveScheduledTask", setScheduledTaskEnabled: "setScheduledTaskEnabled", runScheduledTask: "runScheduledTask", editScheduledTask: "editScheduledTask",
  searchSession: "searchSession", cancelSessionSearch: "cancelSessionSearch", revealSessionMatch: "revealSessionMatch",
  sessionSearchPreviews: "sessionSearchPreviews", setSearchPreferences: "setSearchPreferences",
  restoreComposerDraft: "restoreComposerDraft", saveComposerDraft: "saveComposerDraft", chatAsset: "chatAsset", composerState: "composerState", pickAttachments: "pickAttachments", uploadAttachment: "uploadAttachment", releaseAttachment: "releaseAttachment",
  getState: "getState", loadArchive: "loadArchive", selectThread: "selectThread", sendMessage: "sendMessage",
  newThread: "newThread", newChatTab: "newChatTab", chooseProject: "chooseProject", startPairing: "startPairing", reconnect: "reconnect",
  setModel: "setModel", setModelOption: "setModelOption", toggleFavoriteModel: "toggleFavoriteModel", setModelVisibility: "setModelVisibility", moveModel: "moveModel", reorderModel: "reorderModel", setModes: "setModes", openSettings: "openSettings", focusView: "focusView", interrupt: "interrupt",
  respondToRequest: "respondToRequest", dismissRequest: "dismissRequest",
  loadHistory: "loadHistory", loadItemDetail: "loadItemDetail",
  threadAction: "threadAction", forkFromResponse: "forkFromResponse", openLink: "openLink", copyText: "copyText", openInTab: "openInTab", openSessionTab: "openSessionTab", keepTab: "keepTab", openTaskManager: "openTaskManager", closeTaskTab: "closeTaskTab",
  searchThreads: "searchThreads", composerSuggestions: "composerSuggestions", openTurnDiff: "openTurnDiff", turnDiffSummary: "turnDiffSummary", openMergeDiff: "openMergeDiff", refreshUsage: "refreshUsage",
  queueAction: "queueAction",
  revertConversation: "revertConversation", dismissRewindMarker: "dismissRewindMarker", restorePreview: "restorePreview", restoreFiles: "restoreFiles", openRestoreDiff: "openRestoreDiff", compareRestoredFile: "compareRestoredFile",
  openWebUi: "openWebUi", configureUsage: "configureUsage", showUsage: "showUsage",
} as const;
export type RpcMethod = (typeof Methods)[keyof typeof Methods];
export interface RpcMessage { readonly id: string; readonly method: RpcMethod; readonly params?: unknown }
export interface RpcResult { readonly id: string; readonly result?: unknown; readonly error?: string }
export const Events = { showTaskManager: "showTaskManager", editScheduledTask: "editScheduledTask", stateChanged: "stateChanged", showNavigation: "showNavigation", showUsage: "showUsage", insertReference: "insertReference", openInTab: "openInTab", initializeDraft: "initializeDraft" } as const;
export type BridgeEvent = (typeof Events)[keyof typeof Events];

export interface ModelSelection {
  readonly instanceId: string;
  readonly model: string;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
}
export interface FavoriteModel { readonly instanceId: string; readonly model: string }
export type HostPhase = "discovering" | "no-server" | "pairing" | "connecting" | "ready" | "error";
export interface ProjectSummary { readonly id: string; readonly title: string; readonly workspaceRoot: string }
export type ProjectSelection = { readonly projectId: string } | { readonly workspaceRoot: string } | { readonly noProject: true };
export interface ConversationDraft {
  readonly workspace?: import("./worktrees.js").WorktreeChoice;
  readonly projectId: string | null;
  readonly workspaceRoot: string | null;
  readonly supportsNoProject: boolean;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}
export interface ThreadSummary {
  readonly canChooseWorkspace?: boolean;
  readonly worktreePath?: string | null;
  readonly id: string; readonly projectId: string; readonly title: string; readonly status: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode; readonly interactionMode: ProviderInteractionMode;
  readonly updatedAt: string; readonly archived: boolean; readonly pinned: boolean;
  readonly lastActiveAt?: string | null;
  readonly activeRunId: string | null;
  readonly workingStartedAt?: string | null;
  readonly settled?: boolean;
  readonly searchTerms?: ReadonlyArray<string>;
  readonly pendingRuntimeRequest?: { readonly id: string; readonly kind: string; readonly createdAt: string } | null;
  readonly branch?: string | null;
  readonly parentThreadId?: string | null;
  readonly relationshipToParent?: "fork" | "subagent" | null;
  readonly providerNativeSubagent?: boolean;
  readonly activityRunStatus?: string | null;
  /** Set when the thread itself is idle but a visible descendant subagent is still working. */
  readonly waitingOnSubagents?: boolean;
  /** The server's post-settlement background roster (subagents/monitors/tasks that still hold completion), when the server reports one. */
  readonly backgroundWork?: {
    readonly subagents: number;
    readonly monitors: number;
    readonly tasks: number;
    readonly commands: number;
    readonly holdsCompletion: boolean;
    readonly startedAt: string | null;
  };
}
export type ThreadSearchMatch = OrchestrationThreadSearchMatch;
export interface ComposerSuggestion {
  readonly id: string; readonly label: string; readonly description: string;
  readonly kind: "file" | "directory" | "thread" | "model" | "usage" | "command" | "skill";
  readonly value: string;
  /** Absolute `file://` URL for path suggestions, so the renderer can bind one as a file reference. */
  readonly uri?: string;
}
export interface ConversationQueue {
  readonly activeRunId: string | null;
  readonly canSteer: boolean;
  readonly canReorder: boolean;
  readonly held: boolean;
  readonly entries: ReadonlyArray<{ readonly runId: string; readonly text: string; readonly attachmentNames: ReadonlyArray<string> }>;
}
export interface ConversationTasks {
  readonly runId: string;
  readonly steps: ReadonlyArray<{ readonly text: string; readonly status: "pending" | "running" | "completed"; readonly durationMs?: number }>;
}
export type WireTurnItem = typeof OrchestrationV2TurnItemJson.Encoded;
export interface TranscriptItem {
  readonly key: string;
  readonly sourceThreadId: string;
  readonly sourceItemId?: string;
  readonly item: WireTurnItem;
  readonly toolLabel: string | null;
  readonly output: string | null;
  readonly needsDetail: boolean;
  readonly canFork?: boolean;
  readonly checkpointRunStatus?: string;
  /** True on a user message when its thread supports rollback and the turn just before it has a ready checkpoint. */
  readonly canRevert?: boolean;
  readonly revertTurnCount?: number;
}
/** Kept per-thread after "Edit from here" so files can still be restored once the conversation has moved on. */
export interface RewindMarker {
  readonly checkpointId: string;
  readonly scopeId: string;
  readonly turnNumber?: number;
  readonly rewoundAt: string;
  readonly rewoundMessageCount: number;
}
export interface RestoreResultFile {
  readonly path: string;
  readonly outcome: "applied" | "conflict" | "kept-untracked";
  readonly yoursPath?: string;
}
export interface RestoreResult {
  readonly turnNumber?: number;
  readonly keptCount: number;
  readonly totalFiles: number;
  readonly files: ReadonlyArray<RestoreResultFile>;
  readonly restoredAt: string;
  readonly skippedStash: boolean;
}
export interface RestoreAttributionFile {
  readonly path: string;
  readonly agent?: { readonly additions: number; readonly deletions: number };
  readonly you?: { readonly additions: number; readonly deletions: number; readonly untracked?: boolean };
  readonly keepVerdict?: "clean" | "conflict";
}
export interface RestorePreview {
  readonly cwd: string;
  readonly branch: string;
  readonly turnNumber?: number;
  readonly checkpointAt: string;
  readonly files: ReadonlyArray<RestoreAttributionFile>;
}
export interface HostStateSnapshot {
  readonly worktrees?: import("./worktrees.js").WorktreesState;
  readonly scheduledTasks?: ScheduledTasksState;
  readonly acknowledgedWorking?: { readonly messageId: string; readonly startedAt: string };
  readonly sessionSearch?: SessionSearchState;
  readonly searchPreferences?: SearchPreferences;
  readonly queue?: ConversationQueue | null;
  readonly tasks?: ConversationTasks | null;
  /** Latest sized provider usage report for the active thread (#8144); absent or null hides the composer's context meter. */
  readonly contextUsage?: import("./contextUsage.js").ContextUsageSnapshot | null;
  /** Monotonic within a host instance; prevents slow RPC responses replacing a newer push. */
  readonly revision: number;
  readonly phase: HostPhase;
  readonly home: string;
  readonly workspaceRoots: ReadonlyArray<string>;
  readonly timeFormat?: TimeFormat;
  readonly dateFormat?: DateFormat;
  readonly appearance: AppearanceSettings;
  readonly messageNavigation?: MessageNavigationPlacement;
  readonly notice?: string;
  readonly connectionSetup?: ConnectionSetup;
  readonly environment?: { readonly environmentId: string; readonly label: string; readonly serverVersion?: string };
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly archiveLoaded?: boolean;
  readonly archiveLoading?: boolean;
  readonly archiveError?: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly usageLimitSources?: UsageLimitSourceSnapshots;
  readonly favoriteModels: ReadonlyArray<FavoriteModel>;
  readonly providerModelPreferences?: ProviderModelPreferences;
  readonly draft: ConversationDraft;
  readonly activeThreadId?: string;
  /** Rewind marker and most recent restore result for the active thread, if any. */
  readonly rewindMarker?: RewindMarker | null;
  readonly restoreResult?: RestoreResult | null;
  /** Server-reported failure of the active thread's latest rollback request (#checkpoint.rollback.fail). */
  readonly rollbackFailure?: string | null;
  readonly transcript: ReadonlyArray<TranscriptItem>;
  readonly pending: PendingThreadRequests;
  readonly history: { readonly hasMore: boolean; readonly loading: boolean; readonly error: string | null };
  readonly threadLoading: boolean;
  readonly sending: boolean;
}
export interface RequestResponse {
  readonly threadId: string; readonly requestId: string;
  readonly decision?: string;
  readonly answers?: Readonly<Record<string, unknown>>;
}
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function validateRpcMessage(raw: unknown): RpcMessage | null {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.method !== "string") return null;
  if (!Object.values(Methods).includes(raw.method as RpcMethod)) return null;
  return { id: raw.id, method: raw.method as RpcMethod, params: raw.params };
}
export function paramsObject(raw: unknown): Record<string, unknown> {
  if (!isObject(raw)) throw new Error("Invalid request parameters.");
  return raw;
}
export function stringParam(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}.`);
  return value;
}

export interface TurnDiffSummary {
  readonly cwd: string;
  readonly branch: string;
  readonly worktreeName?: string;
  readonly files: ReadonlyArray<{ path: string; additions: number; deletions: number }>;
  readonly merges?: ReadonlyArray<{ sourceThreadId: string; sourceTitle: string; sourceBranch: string; destinationBranch: string; appliedAt: string; files: ReadonlyArray<{ path: string; additions: number; deletions: number }> }>;
}
