/** Single host-owned T3 projection shared by the sidebar and every editor tab. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import {
  OrchestrationV2TurnItemJson, ModelSelection as ModelSelectionSchema,
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
import { mergeOlderHistoryIntoProjection, EMPTY_THREAD_HISTORY_META, applyHistoryPageMeta, type ThreadHistoryMeta } from "@t3tools/client-runtime/state/thread-history-merge";
import { resolveWorkEntryToolPresentation } from "@t3tools/client-runtime/work-log/presentation";
import { turnItemNeedsDetailFetch, turnItemOutputText } from "@t3tools/client-runtime/work-log/item-detail";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type { HostStateSnapshot, HostPhase, ModelSelection, TranscriptItem, RequestResponse, ConversationDraft, ProjectSelection, ProjectSummary } from "../shared/bridge.js";
import { pairWithServer } from "./pairing.js";
import { discoverServer, type DiscoveredServer } from "./serverDiscovery.js";
import type { CredentialStore } from "./sessionStore.js";
import type { T3Client, Subscription } from "./t3Client.js";

export type HostTransport = Pick<T3Client, "connected" | "onClose" | "onConfig" | "connect" | "disconnect" | "snapshotShell" | "subscribeShell" | "subscribeThread" | "dispatch" | "createProject" | "ensureScratchProject" | "getHistory" | "getTurnItem" | "snapshotArchive" | "subscribeArchive"> & { readonly config: Pick<ServerConfig, "providers" | "scratchWorkspaceRoot"> | null };
export interface HostStateOptions {
  readonly home: string;
  readonly credentials: CredentialStore;
  readonly serverStartupHint?: string | undefined;
  readonly workspaceRoot?: () => string | null;
  readonly workspaceRoots?: () => ReadonlyArray<string>;
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
}
const blankThread = (): ThreadState => ({ projection: null, sequence: -1, history: EMPTY_THREAD_HISTORY_META, loading: true });
const describeError = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
function authFailure(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && (
    ("reason" in cause && cause.reason === "authentication") ||
    ("_tag" in cause && cause._tag === "EnvironmentAuthInvalidError") ||
    ("status" in cause && cause.status === 401));
}

export class HostState {
  private phase: HostPhase = "discovering";
  private notice: string | undefined;
  private server: DiscoveredServer | null = null;
  private shell: OrchestrationV2ShellSnapshot | null = null;
  private activeThreadId: string | undefined;
  private draftProjectId: string | undefined;
  // null explicitly selects "No project", even when a VS Code folder is open.
  private draftWorkspaceRoot: string | null | undefined;
  private draftModelSelection: ModelSelection | undefined;
  private draftRuntimeMode: RuntimeMode = "auto";
  private draftInteractionMode: ProviderInteractionMode = "default";
  private archive: OrchestrationV2ArchivedShellSnapshot | null = null;
  private archiveSubscription: Subscription | null = null;
  private readonly threads = new Map<string, ThreadState>();
  private shellSubscription: Subscription | null = null;
  private threadSubscription: Subscription | null = null;
  private threadGeneration = 0;
  private sending = false;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private revision = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(state: HostStateSnapshot) => void>();
  private readonly encodedItems = new WeakMap<OrchestrationV2TurnItem, Omit<TranscriptItem, "key" | "sourceThreadId">>();
  private readonly projectQuestionHistory = createQuestionHistoryProjector();
  private readonly pathIdentities = new Map<string, string>();

  private readonly options: HostStateOptions;
  private readonly client: HostTransport;
  constructor(options: HostStateOptions, client: HostTransport) {
    this.options = options; this.client = client;
    client.onClose = () => {
      void this.enqueue(() => this.recoverConnection()).catch((cause) => {
        if (!this.disposed) this.setPhase("error", describeError(cause));
      });
    };
    client.onConfig = () => this.scheduleEmit();
  }
  onDidChangeState(listener: (state: HostStateSnapshot) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
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

  private async stopSubscriptions(): Promise<void> {
    this.threadGeneration += 1;
    const shell = this.shellSubscription; const thread = this.threadSubscription; const archive = this.archiveSubscription;
    this.archiveSubscription = null;
    this.shellSubscription = null; this.threadSubscription = null;
    await shell?.(); await thread?.(); await archive?.();
  }
  private async connect(forcePair: boolean): Promise<void> {
    await this.stopSubscriptions();
    await this.client.disconnect();
    this.setPhase("discovering");
    const discovered = await (this.options.discover ?? discoverServer)(this.options.home, this.options.serverStartupHint);
    if (!discovered.ok) { this.server = null; this.setPhase("no-server", discovered.reason); return; }
    if (this.server?.descriptor.environmentId !== discovered.server.descriptor.environmentId) {
      this.shell = null; this.archive = null; this.threads.clear(); this.activeThreadId = undefined;
      this.draftProjectId = undefined; this.draftWorkspaceRoot = undefined; this.draftModelSelection = undefined;
      this.draftRuntimeMode = "auto"; this.draftInteractionMode = "default";
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
      const selected = this.findThread(this.activeThreadId);
      const latest = [...this.visibleThreads()].filter((thread) => !thread.archivedAt).sort((a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt))[0];
      this.activeThreadId = selected?.id ?? latest?.id;
      if (this.activeThreadId) await this.subscribeActiveThread();
      this.setPhase("ready");
    } catch (cause) {
      this.setPhase("error", describeError(cause));
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
    if (this.activeThreadId && !this.findThread(this.activeThreadId)) {
      void this.workspaceChanged().catch((cause) => { if (!this.disposed) this.setPhase("error", describeError(cause)); });
    }
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
  workspaceChanged(): Promise<void> {
    return this.enqueue(async () => {
      this.pathIdentities.clear();
      this.draftProjectId = undefined; this.draftWorkspaceRoot = undefined;
      if (this.activeThreadId && !this.findThread(this.activeThreadId)) {
        this.activeThreadId = [...this.visibleThreads()].filter((thread) => !thread.archivedAt)
          .sort((a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt))[0]?.id;
        await this.subscribeActiveThread();
      }
      this.emit();
    });
  }
  private requireThread(id: string): OrchestrationV2ThreadShell {
    if (!this.client.connected) throw new Error("T3 is disconnected.");
    const thread = this.findThread(id);
    if (!thread) throw new Error("This thread is not available in the current workspace. Refresh the thread list.");
    return thread;
  }
  selectThread(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.requireThread(id);
      if (this.activeThreadId === id && this.threadSubscription) return;
      this.activeThreadId = id;
      await this.subscribeActiveThread(); this.emit();
    });
  }
  private async subscribeActiveThread(): Promise<void> {
    const id = this.activeThreadId;
    const generation = ++this.threadGeneration;
    await this.threadSubscription?.(); this.threadSubscription = null;
    if (!id) return;
    const state = blankThread();
    this.threads.set(id, state);
    // Only the selected thread stays subscribed; bound cached projections too.
    for (const key of this.threads.keys()) {
      if (this.threads.size <= 5) break;
      if (key !== id) this.threads.delete(key);
    }
    this.threadSubscription = await this.client.subscribeThread(id, (item) => {
      if (generation !== this.threadGeneration || this.disposed) return;
      this.handleThread(state, item);
    });
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
    this.scheduleEmit();
  }
  newThread(projectId?: string): Promise<string> { return this.enqueue(() => this.createThread(projectId)); }
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
  private conversationDraft(): ConversationDraft {
    const roots = this.workspaceRoots();
    const chosenRoot = this.draftWorkspaceRoot === undefined ? roots[0] ?? null : this.draftWorkspaceRoot;
    const root = roots.length && (!chosenRoot || !this.pathInWorkspace(chosenRoot)) ? roots[0]! : chosenRoot;
    const active = this.findThread(this.activeThreadId);
    const projects = this.visibleProjects();
    const project = projects.find((item) => item.id === this.draftProjectId)
      ?? (root ? projects.find((item) => this.pathIdentity(item.workspaceRoot) === this.pathIdentity(root))
        : this.draftWorkspaceRoot === null ? undefined : projects.find((item) => item.id === active?.projectId));
    const modelSelection = this.availableModel(this.draftModelSelection ?? project?.defaultModelSelection ?? active?.modelSelection);
    const supportsNoProject = !roots.length && availableScratchWorkspaceRoot(this.client.connected ? "connected" : null, this.client.config) !== null;
    return { projectId: project?.id ?? null, workspaceRoot: project?.workspaceRoot ?? root, supportsNoProject, modelSelection,
      runtimeMode: this.compatibleRuntimeMode(modelSelection, this.draftRuntimeMode), interactionMode: this.draftInteractionMode };
  }
  chooseProject(projectId?: string): Promise<void> {
    return this.enqueue(async () => {
      if (projectId) this.applyProjectSelection({ projectId });
      else await this.pickDraftProject();
      this.emit();
    });
  }
  private applyProjectSelection(selection: ProjectSelection): void {
    if ("noProject" in selection) {
      if (!this.conversationDraft().supportsNoProject) throw new Error("This server requires a project. Choose a project folder.");
      this.draftProjectId = undefined; this.draftWorkspaceRoot = null;
    } else if ("projectId" in selection) {
      const project = this.visibleProjects().find((item) => item.id === selection.projectId);
      if (!project) throw new Error("Project not found in the current workspace.");
      this.draftProjectId = project.id; this.draftWorkspaceRoot = project.workspaceRoot;
    } else {
      if (!isAbsolute(selection.workspaceRoot)) throw new Error("Choose an absolute project folder.");
      if (!this.pathInWorkspace(selection.workspaceRoot)) throw new Error("Choose a folder from the current VS Code workspace.");
      this.draftProjectId = undefined; this.draftWorkspaceRoot = resolve(selection.workspaceRoot);
    }
  }
  private async pickDraftProject(): Promise<boolean> {
    const projects = this.visibleProjects().map((project) => ({ id: project.id, title: project.title, workspaceRoot: project.workspaceRoot }));
    const selected = await this.options.pickProject?.(projects, this.conversationDraft().supportsNoProject, this.workspaceRoots());
    if (!selected) return false;
    this.applyProjectSelection(selected);
    return true;
  }
  private async createThread(requestedProjectId?: string): Promise<string> {
    if (!this.client.connected) throw new Error("T3 is disconnected.");
    this.chooseModel();
    let draft = this.conversationDraft();
    let projectId = requestedProjectId ?? draft.projectId ?? undefined;
    if (projectId && !this.visibleProjects().some((project) => project.id === projectId)) throw new Error("Project not found in the current workspace.");
    if (!projectId && !draft.workspaceRoot) {
      if (draft.supportsNoProject) projectId = await this.client.ensureScratchProject();
      else {
        if (!await this.pickDraftProject()) throw new Error("Choose a project or open a folder before starting a conversation.");
        draft = this.conversationDraft();
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
    const model = this.chooseModel(this.draftModelSelection ?? project?.defaultModelSelection ?? draft.modelSelection);
    const id = randomUUID();
    await this.client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId: id, projectId,
      createdBy: "user", creationSource: "web", title: "New thread", modelSelection: model,
      runtimeMode: this.compatibleRuntimeMode(model, draft.runtimeMode), interactionMode: draft.interactionMode, branch: null, worktreePath: null });
    this.shell = await this.client.snapshotShell();
    this.activeThreadId = id;
    await this.subscribeActiveThread(); this.emit();
    return id;
  }
  sendMessage(text: string, targetThreadId?: string): Promise<void> {
    return this.enqueue(async () => {
      if (!text.trim()) throw new Error("Enter a message.");
      const id = targetThreadId ?? await this.createThread();
      const thread = this.requireThread(id);
      if (thread.archivedAt) throw new Error("Restore this thread before sending a message.");
      this.sending = true; this.emit();
      try {
        await this.client.dispatch({ type: "message.dispatch", commandId: randomUUID(), threadId: id,
          createdBy: "user", creationSource: "web", messageId: randomUUID(), text, attachments: [],
          titleSeed: text.trim().slice(0, 160), deliveryIntent: "auto", dispatchMode: { type: "start_immediately" } });
      } finally { this.sending = false; this.emit(); }
    });
  }
  setModel(id: string | undefined, input: unknown): Promise<void> {
    return this.enqueue(async () => {
      const selection = Schema.decodeUnknownSync(ModelSelectionSchema)(input);
      const provider = this.client.config?.providers.find((item) => item.instanceId === selection.instanceId);
      if (!provider?.enabled || !provider.installed || provider.availability === "unavailable" || !provider.models.some((model) => model.slug === selection.model)) throw new Error("This model is unavailable.");
      if (id === undefined) {
        this.draftModelSelection = selection;
        this.draftRuntimeMode = this.compatibleRuntimeMode(selection, this.draftRuntimeMode);
        this.emit(); return;
      }
      const thread = this.requireThread(id);
      if (provider.requiresNewThreadForModelChange && thread.itemCount > 0 && (selection.model !== thread.modelSelection.model || selection.instanceId !== thread.modelSelection.instanceId)) throw new Error("This provider requires a new thread to change models.");
      await this.client.dispatch({ type: "thread.model-selection.set", commandId: randomUUID(), threadId: id, modelSelection: selection });
    });
  }
  setModes(id: string | undefined, input: { runtimeMode?: unknown; interactionMode?: unknown }): Promise<void> {
    return this.enqueue(async () => {
      if (id === undefined) {
        const draft = this.conversationDraft();
        const mode = input.runtimeMode === undefined ? draft.runtimeMode : Schema.decodeUnknownSync(RuntimeMode)(input.runtimeMode);
        const interaction = input.interactionMode === undefined ? draft.interactionMode : Schema.decodeUnknownSync(ProviderInteractionMode)(input.interactionMode);
        if (this.compatibleRuntimeMode(draft.modelSelection, mode) !== mode) throw new Error("This provider does not support that permission mode.");
        this.draftRuntimeMode = mode; this.draftInteractionMode = interaction; this.emit(); return;
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
      const runId = thread.activeRunId;
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
      if (action === "rename") {
        if (!title?.trim()) throw new Error("Enter a thread title.");
        await this.client.dispatch({ type: "thread.metadata.update", commandId: randomUUID(), threadId: id, title });
      } else if (["archive", "unarchive", "pin", "unpin"].includes(action)) {
        await this.client.dispatch({ type: `thread.${action}`, commandId: randomUUID(), threadId: id });
      } else throw new Error("Unknown thread action.");
      this.shell = await this.client.snapshotShell();
      if (action === "archive" || action === "unarchive") {
        this.archive = await this.client.snapshotArchive();
        await this.subscribeArchive();
      }
      this.emit();
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
  private presentItem(item: OrchestrationV2TurnItem): Omit<TranscriptItem, "key" | "sourceThreadId"> {
    const cached = this.encodedItems.get(item);
    if (cached) return cached;
    const tool = resolveWorkEntryToolPresentation({ label: item.title ?? item.type, structuredPayload: item });
    const result = { item: Schema.encodeSync(OrchestrationV2TurnItemJson)(item), toolLabel: tool?.displayName ?? null,
      output: turnItemOutputText(item), needsDetail: turnItemNeedsDetailFetch(item) };
    this.encodedItems.set(item, result); return result;
  }
  snapshot(): HostStateSnapshot {
    const activeThreadId = this.findThread(this.activeThreadId)?.id;
    const state = activeThreadId ? this.threads.get(activeThreadId) : undefined;
    const projection = state?.projection;
    const descriptor = this.server?.descriptor;
    return {
      revision: this.revision, phase: this.phase, home: this.options.home,
      workspaceRoots: this.workspaceRoots(),
      ...(this.notice ? { notice: this.notice } : {}),
      ...(descriptor ? { environment: { environmentId: descriptor.environmentId, label: descriptor.label, serverVersion: descriptor.serverVersion } } : {}),
      projects: this.visibleProjects().map((project) => ({ id: project.id, title: project.title, workspaceRoot: project.workspaceRoot })),
      threads: this.visibleThreads().map((thread) => ({
        id: thread.id, projectId: thread.projectId, title: thread.title, status: thread.status,
        modelSelection: thread.modelSelection, runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode,
        updatedAt: DateTime.formatIso(thread.updatedAt), archived: thread.archivedAt !== null, pinned: thread.pinnedAt != null,
        activeRunId: thread.activeRunId,
      })),
      providers: this.client.config?.providers ?? [],
      draft: this.conversationDraft(),
      ...(activeThreadId ? { activeThreadId } : {}),
      transcript: projection ? this.projectQuestionHistory(projection).filter((row) => !turnItemIsWorkspacePreparation(row.item)).map((row) => ({
        key: `${row.sourceThreadId}:${row.sourceItemId}`, sourceThreadId: row.sourceThreadId, ...this.presentItem(row.item),
      })) : [],
      pending: projection ? derivePendingThreadRequests(projection) : { approvals: [], userInputs: [] },
      history: { hasMore: state?.history.hasMoreHistory ?? false, loading: state?.history.loading ?? false, error: state?.history.error ?? null },
      threadLoading: state?.loading ?? false, sending: this.sending,
    };
  }
  private setPhase(phase: HostPhase, notice?: string): void { this.phase = phase; this.notice = notice; this.emit(); }
  private scheduleEmit(): void {
    if (this.disposed || this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.emit(); }, 32);
  }
  private emit(): void {
    if (this.disposed) return;
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.client.onClose = null; this.client.onConfig = null;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    await this.stopSubscriptions(); await this.client.disconnect(); this.listeners.clear();
  }
}
