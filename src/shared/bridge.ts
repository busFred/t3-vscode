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

import type { SessionSearchState } from "./sessionSearch.js";
import type { SearchPreferences } from "./sessionSearchPresentation.js";

export const Methods = {
  searchSession: "searchSession", cancelSessionSearch: "cancelSessionSearch", revealSessionMatch: "revealSessionMatch",
  sessionSearchPreviews: "sessionSearchPreviews", setSearchPreferences: "setSearchPreferences",
  restoreComposerDraft: "restoreComposerDraft", saveComposerDraft: "saveComposerDraft", chatAsset: "chatAsset", composerState: "composerState", pickAttachments: "pickAttachments", uploadAttachment: "uploadAttachment", releaseAttachment: "releaseAttachment",
  getState: "getState", loadArchive: "loadArchive", selectThread: "selectThread", sendMessage: "sendMessage",
  newThread: "newThread", newChatTab: "newChatTab", chooseProject: "chooseProject", startPairing: "startPairing", reconnect: "reconnect",
  setModel: "setModel", setModelOption: "setModelOption", toggleFavoriteModel: "toggleFavoriteModel", setModes: "setModes", openSettings: "openSettings", focusView: "focusView", interrupt: "interrupt",
  respondToRequest: "respondToRequest", dismissRequest: "dismissRequest",
  loadHistory: "loadHistory", loadItemDetail: "loadItemDetail",
  threadAction: "threadAction", forkFromResponse: "forkFromResponse", openLink: "openLink", copyText: "copyText", openInTab: "openInTab",
  searchThreads: "searchThreads", composerSuggestions: "composerSuggestions", openTurnDiff: "openTurnDiff", refreshUsage: "refreshUsage",
  queueAction: "queueAction",
  openWebUi: "openWebUi", configureUsage: "configureUsage", showUsage: "showUsage",
} as const;
export type RpcMethod = (typeof Methods)[keyof typeof Methods];
export interface RpcMessage { readonly id: string; readonly method: RpcMethod; readonly params?: unknown }
export interface RpcResult { readonly id: string; readonly result?: unknown; readonly error?: string }
export const Events = { stateChanged: "stateChanged", showNavigation: "showNavigation", showUsage: "showUsage", insertReference: "insertReference", openInTab: "openInTab", initializeDraft: "initializeDraft" } as const;
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
  readonly projectId: string | null;
  readonly workspaceRoot: string | null;
  readonly supportsNoProject: boolean;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}
export interface ThreadSummary {
  readonly id: string; readonly projectId: string; readonly title: string; readonly status: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode; readonly interactionMode: ProviderInteractionMode;
  readonly updatedAt: string; readonly archived: boolean; readonly pinned: boolean;
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
}
export type ThreadSearchMatch = OrchestrationThreadSearchMatch;
export interface ComposerSuggestion {
  readonly id: string; readonly label: string; readonly description: string;
  readonly kind: "file" | "directory" | "thread" | "model" | "usage" | "command" | "skill";
  readonly value: string;
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
}
export interface HostStateSnapshot {
  readonly sessionSearch?: SessionSearchState;
  readonly searchPreferences?: SearchPreferences;
  readonly queue?: ConversationQueue | null;
  readonly tasks?: ConversationTasks | null;
  /** Monotonic within a host instance; prevents slow RPC responses replacing a newer push. */
  readonly revision: number;
  readonly phase: HostPhase;
  readonly home: string;
  readonly workspaceRoots: ReadonlyArray<string>;
  readonly appearance: AppearanceSettings;
  readonly messageNavigation?: MessageNavigationPlacement;
  readonly notice?: string;
  readonly environment?: { readonly environmentId: string; readonly label: string; readonly serverVersion?: string };
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly archiveLoaded?: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly usageLimitSources?: UsageLimitSourceSnapshots;
  readonly favoriteModels: ReadonlyArray<FavoriteModel>;
  readonly draft: ConversationDraft;
  readonly activeThreadId?: string;
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
