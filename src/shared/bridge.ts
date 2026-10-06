/** UI intents only. T3 credentials, RPCs, projections and subscriptions stay in the host. */
import type {
  OrchestrationV2TurnItemJson,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";

export const Methods = {
  getState: "getState", loadArchive: "loadArchive", selectThread: "selectThread", sendMessage: "sendMessage",
  newThread: "newThread", chooseProject: "chooseProject", startPairing: "startPairing", reconnect: "reconnect",
  setModel: "setModel", setModes: "setModes", interrupt: "interrupt",
  respondToRequest: "respondToRequest", dismissRequest: "dismissRequest",
  loadHistory: "loadHistory", loadItemDetail: "loadItemDetail",
  threadAction: "threadAction", openLink: "openLink", copyText: "copyText", openInTab: "openInTab",
} as const;
export type RpcMethod = (typeof Methods)[keyof typeof Methods];
export interface RpcMessage { readonly id: string; readonly method: RpcMethod; readonly params?: unknown }
export interface RpcResult { readonly id: string; readonly result?: unknown; readonly error?: string }
export const Events = { stateChanged: "stateChanged", showNavigation: "showNavigation" } as const;
export type BridgeEvent = (typeof Events)[keyof typeof Events];

export interface ModelSelection {
  readonly instanceId: string;
  readonly model: string;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
}
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
}
export type WireTurnItem = typeof OrchestrationV2TurnItemJson.Encoded;
export interface TranscriptItem {
  readonly key: string;
  readonly sourceThreadId: string;
  readonly item: WireTurnItem;
  readonly toolLabel: string | null;
  readonly output: string | null;
  readonly needsDetail: boolean;
}
export interface HostStateSnapshot {
  /** Monotonic within a host instance; prevents slow RPC responses replacing a newer push. */
  readonly revision: number;
  readonly phase: HostPhase;
  readonly home: string;
  readonly workspaceRoots: ReadonlyArray<string>;
  readonly notice?: string;
  readonly environment?: { readonly environmentId: string; readonly label: string; readonly serverVersion?: string };
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly providers: ReadonlyArray<ServerProvider>;
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
