/** Deterministic typed transport for host, bridge and browser regression verification; no real server calls. */
import { OrchestrationV2Command, ProviderInstanceId, ThreadId, ProjectId, TurnItemId, type OrchestrationV2TurnItem, type OrchestrationV2ShellStreamItem, type OrchestrationV2ThreadStreamItem, type OrchestrationV2ArchivedShellSnapshot, type OrchestrationV2ArchivedShellStreamItem, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { v2Now, v2Project, v2ThreadShell, v2Projection, v2ShellSnapshot } from "../../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { HostState, type HostTransport, type HostStateOptions } from "../hostState.js";
import type { DiscoveredServer } from "../serverDiscovery.js";

export const provider: ServerProvider = { instanceId: ProviderInstanceId.make("kimi"), driver: "acp" as ServerProvider["driver"], displayName: "Kimi", enabled: true, installed: true, version: null, status: "ready", auth: { status: "authenticated" }, checkedAt: "2026-10-06T00:00:00Z", models: [{ slug: "kimi-for-coding", name: "Kimi", isCustom: false, capabilities: null }], slashCommands: [], skills: [] };
export const server = { origin: "http://audit.invalid", descriptor: { environmentId: "audit", label: "Audit" } } as DiscoveredServer;
export const credentials = { get: async () => ({ origin: server.origin, environmentId: server.descriptor.environmentId, accessToken: "fake", expiresAt: Date.now() + 100_000, scopes: [] }), save: async () => {}, clear: async () => {} };
export class FakeTransport implements HostTransport {
  connected = false;
  config: NonNullable<HostTransport["config"]> = { providers: [provider] };
  onClose: HostTransport["onClose"] = null;
  onConfig: HostTransport["onConfig"] = null;
  connections = 0; shellStarts = 0; threadStarts = 0; threadStops = 0;
  shell = structuredCloneShell();
  archive: OrchestrationV2ArchivedShellSnapshot = { ...v2ShellSnapshot, threads: [] };
  archiveHandler: ((item: OrchestrationV2ArchivedShellStreamItem) => void) | null = null;
  archiveStarts = 0;
  shellHandler: ((item: OrchestrationV2ShellStreamItem) => void) | null = null;
  threadHandlers = new Map<string, (item: OrchestrationV2ThreadStreamItem) => void>();
  private readonly snapshots = new Map<string, Extract<OrchestrationV2ThreadStreamItem, { kind: "snapshot" }>>();
  commands: OrchestrationV2Command[] = [];
  projectCreates = 0;
  scratchCalls = 0;
  searchMatches: Awaited<ReturnType<HostTransport["searchThreads"]>> = { matches: [] };
  pathEntries: Awaited<ReturnType<HostTransport["searchPaths"]>> = { entries: [], truncated: false };
  searches: string[] = [];
  pathSearches: Array<{ cwd: string; query: string }> = [];
  providerRefreshes: Array<{ instanceId: string | undefined; cwd: string | undefined }> = [];
  diffRequests: Array<{ id: string; from: number; to: number }> = [];
  diffFileRequests: Parameters<HostTransport["getDiffFileContents"]>[0][] = [];
  async searchThreads(query: string) { this.searches.push(query); return this.searchMatches; }
  async searchPaths(cwd: string, query: string) { this.pathSearches.push({ cwd, query }); return this.pathEntries; }
  async refreshProviders(instanceId?: string, cwd?: string) { this.providerRefreshes.push({ instanceId, cwd }); return { providers: this.config.providers }; }
  async getTurnDiff(id: string, from: number, to: number) { this.diffRequests.push({ id, from, to }); return { threadId: ThreadId.make(id), fromTurnCount: from, toTurnCount: to, diff: "" }; }
  getDiffFileContents: HostTransport["getDiffFileContents"] = async (input) => { this.diffFileRequests.push(input); return { oldContents: "before\n", newContents: "after\n" }; };
  async connect() { this.connected = true; this.connections += 1; }
  async disconnect() { this.connected = false; }
  async snapshotShell() { return this.shell; }
  async snapshotArchive() { return this.archive; }
  subscribeArchive: HostTransport["subscribeArchive"] = async (handler) => {
    this.archiveStarts += 1; this.archiveHandler = handler;
    return async () => { this.archiveHandler = null; };
  };
  async subscribeShell(handler: (item: OrchestrationV2ShellStreamItem) => void) { this.shellStarts += 1; this.shellHandler = handler; return async () => { this.shellHandler = null; }; }
  async subscribeThread(id: string, handler: (item: OrchestrationV2ThreadStreamItem) => void) {
    this.threadStarts += 1;
    // Like the server, retain published history when the last client leaves.
    const receive = (item: OrchestrationV2ThreadStreamItem) => {
      if (item.kind === "snapshot" && this.threadHandlers.get(id) === receive) this.snapshots.set(id, item);
      handler(item);
    };
    this.threadHandlers.set(id, receive);
    const thread = this.shell.threads.find((thread) => thread.id === id);
    receive(this.snapshots.get(id) ?? { kind: "snapshot", snapshotSequence: 0, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id),
      modelSelection: thread?.modelSelection ?? v2Projection.thread.modelSelection, runtimeMode: thread?.runtimeMode ?? v2Projection.thread.runtimeMode,
      interactionMode: thread?.interactionMode ?? v2Projection.thread.interactionMode } } });
    return async () => { this.threadStops += 1; if (this.threadHandlers.get(id) === receive) this.threadHandlers.delete(id); };
  }
  async dispatch(raw: unknown) {
    const command = Schema.decodeUnknownSync(OrchestrationV2Command)(raw); this.commands.push(command);
    const queueCommand = command.type === "queued-run.cancel" || command.type === "queued-run.edit" || command.type === "queued-run.reorder" || command.type === "queued-message.promote-to-steer" || command.type === "queue.resume";
    if (queueCommand) {
      const snapshot = this.snapshots.get(command.threadId);
      if (snapshot) {
        let projection = snapshot.projection;
        if (command.type === "queued-run.edit") { const run = projection.runs.find((run) => run.id === command.runId); projection = { ...projection, messages: projection.messages.map((message) => message.id === run?.userMessageId ? { ...message, text: command.text } : message) }; }
        if (command.type === "queued-run.cancel" || command.type === "queued-message.promote-to-steer") { const id = command.type === "queued-run.cancel" ? command.runId : command.queuedRunId; projection = { ...projection, runs: projection.runs.map((run) => run.id === id ? { ...run, status: "cancelled" } : run) }; }
        if (command.type === "queue.resume") projection = { ...projection, runs: projection.runs.map((run) => ({ ...run, queueHeld: false })) };
        if (command.type === "queued-run.reorder") {
          const queue = projection.runs.filter((run) => run.status === "queued").sort((a, b) => (a.queuePosition ?? a.ordinal) - (b.queuePosition ?? b.ordinal));
          const entry = queue.find((run) => run.id === command.runId)!; const order = queue.filter((run) => run.id !== command.runId);
          const at = command.beforeRunId === null ? order.length : order.findIndex((run) => run.id === command.beforeRunId); order.splice(at, 0, entry);
          projection = { ...projection, runs: projection.runs.map((run) => run.status === "queued" ? { ...run, queuePosition: order.findIndex((entry) => entry.id === run.id) + 1 } : run) };
        }
        this.threadHandlers.get(command.threadId)?.({ ...snapshot, snapshotSequence: snapshot.snapshotSequence + 1, projection });
      }
    }
    if (command.type === "thread.create") this.shell = { ...this.shell, threads: [...this.shell.threads, { ...v2ThreadShell, id: command.threadId, projectId: command.projectId, title: command.title, modelSelection: command.modelSelection, runtimeMode: command.runtimeMode, interactionMode: command.interactionMode }] };
    if (command.type === "thread.model-selection.set") {
      this.shell = { ...this.shell, snapshotSequence: this.shell.snapshotSequence + 1, threads: this.shell.threads.map((thread) => thread.id === command.threadId ? { ...thread, modelSelection: command.modelSelection } : thread) };
      this.shellHandler?.({ kind: "snapshot", snapshot: this.shell });
    }
    if (command.type === "thread.archive") {
      const thread = this.shell.threads.find((thread) => thread.id === command.threadId)!;
      this.shell = { ...this.shell, threads: this.shell.threads.filter((thread) => thread.id !== command.threadId) };
      this.archive = { ...this.archive, threads: [...this.archive.threads, { ...thread, archivedAt: v2Now }] };
    }
    if (command.type === "thread.unarchive") {
      const thread = this.archive.threads.find((thread) => thread.id === command.threadId)!;
      this.archive = { ...this.archive, threads: this.archive.threads.filter((thread) => thread.id !== command.threadId) };
      this.shell = { ...this.shell, threads: [...this.shell.threads, { ...thread, archivedAt: null }] };
    }
    if (command.type === "thread.delete") {
      this.shell = { ...this.shell, threads: this.shell.threads.filter((thread) => thread.id !== command.threadId) };
      this.archive = { ...this.archive, threads: this.archive.threads.filter((thread) => thread.id !== command.threadId) };
      this.snapshots.delete(command.threadId);
    }
    if (command.type === "thread.metadata.update" || command.type === "thread.pin" || command.type === "thread.unpin") {
      const update = (thread: typeof v2ThreadShell) => thread.id !== command.threadId ? thread : {
        ...thread, ...(command.type === "thread.metadata.update" ? { title: command.title ?? thread.title } : { pinnedAt: command.type === "thread.pin" ? v2Now : null }),
      };
      this.shell = { ...this.shell, threads: this.shell.threads.map(update) };
      this.archive = { ...this.archive, threads: this.archive.threads.map(update) };
    }
    if (command.type === "thread.settle" || command.type === "thread.unsettle") {
      this.shell = { ...this.shell, threads: this.shell.threads.map((thread) => thread.id !== command.threadId ? thread : { ...thread,
        settledOverride: command.type === "thread.settle" ? "settled" as const : "active" as const, settledAt: command.type === "thread.settle" ? v2Now : null }) };
    }
    if (command.type === "thread.fork") {
      const source = [...this.shell.threads, ...this.archive.threads].find((thread) => thread.id === command.sourceThreadId)!;
      const child = { ...source, id: command.targetThreadId, title: `Fork of ${source.title}`, archivedAt: null,
        forkedFrom: command.sourcePoint.type === "run" ? { type: "run" as const, threadId: source.id, runId: command.sourcePoint.runId } : null,
        lineage: { rootThreadId: source.lineage.rootThreadId, parentThreadId: source.id, relationshipToParent: "fork" as const } };
      this.shell = { ...this.shell, threads: [...this.shell.threads, child] };
      const projection = this.snapshots.get(source.id)?.projection;
      if (projection) this.snapshots.set(child.id, { kind: "snapshot", snapshotSequence: 0, projection: { ...projection,
        thread: { ...projection.thread, id: child.id, title: child.title, lineage: child.lineage, forkedFrom: child.forkedFrom },
        turnItems: [], visibleTurnItems: projection.visibleTurnItems.map((row) => ({ ...row, visibility: "inherited" as const })) } });
    }
  }
  async createProject(workspaceRoot: string, title: string) {
    this.projectCreates += 1;
    const id = ProjectId.make("workspace-project");
    this.shell = { ...this.shell, projects: [...this.shell.projects, { ...v2Project, id, workspaceRoot, title }] }; return id;
  }
  async ensureScratchProject() {
    this.scratchCalls += 1;
    const workspaceRoot = this.config.scratchWorkspaceRoot;
    if (!workspaceRoot) throw new Error("Threads without a project are not available on this environment.");
    const existing = this.shell.projects.find((project) => project.workspaceRoot === workspaceRoot);
    if (existing) return existing.id;
    const id = ProjectId.make("scratch-project");
    this.shell = { ...this.shell, projects: [...this.shell.projects, { ...v2Project, id, workspaceRoot, title: "No project" }] };
    return id;
  }
  getHistory: HostTransport["getHistory"] = async () => ({ snapshotSequence: 0, items: [], nextCursor: null, hasMoreHistory: false });
  getThreadProjection: HostTransport["getThreadProjection"] = async (id) => {
    const snapshot = this.snapshots.get(id); if (snapshot?.kind !== "snapshot") throw new Error("Projection not found."); return snapshot.projection;
  };
  getTurnItem: HostTransport["getTurnItem"] = async () => ({ item: null });
}
function structuredCloneShell() { return { ...v2ShellSnapshot, projects: [...v2ShellSnapshot.projects], threads: [...v2ShellSnapshot.threads], archivedThreads: [] }; }
export async function harness(options: Pick<HostStateOptions, "workspaceRoot" | "workspaceRoots" | "pickProject" | "appearance" | "favoriteModels" | "saveFavoriteModels"> = {}, client = new FakeTransport()) {
  const host = new HostState({ home: "/tmp/fake-t3-test", credentials, discover: async () => ({ ok: true, server }), reconnectDelayMs: 0, ...options }, client);
  await host.start(); return { host, client };
}
export async function viewsHarness(options: Pick<HostStateOptions, "appearance" | "favoriteModels" | "saveFavoriteModels"> = {}) {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [
    { ...v2Project, workspaceRoot: "/tmp/t3-vscode", title: "t3-vscode" },
    { ...v2Project, id: ProjectId.make("outside"), workspaceRoot: "/tmp/outside", title: "Outside workspace" },
  ], threads: [
    ...["first", "second", "third"].map((id) => ({ ...v2ThreadShell, id: ThreadId.make(id), title: `${id} conversation`,
      modelSelection: { instanceId: provider.instanceId, model: provider.models[0]!.slug } })),
    { ...v2ThreadShell, id: ThreadId.make("outside-thread"), projectId: ProjectId.make("outside"), title: "Outside conversation" },
  ] };
  return harness({ workspaceRoots: () => ["/tmp/t3-vscode"], ...options }, client);
}
export function publishText(client: FakeTransport, id: string, text: string, sequence = 1,
  overrides: Partial<Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>> = {},
  projectionFields: Partial<Extract<OrchestrationV2ThreadStreamItem, { kind: "snapshot" }>["projection"]> = {}) {
  const item: OrchestrationV2TurnItem = { id: TurnItemId.make(`text-${id}`), threadId: ThreadId.make(id), type: "assistant_message",
    messageId: "message" as Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>["messageId"], text, streaming: false,
    title: null, status: "completed", ordinal: 0, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null,
    nativeItemRef: null, parentItemId: null, startedAt: v2Now, completedAt: v2Now, updatedAt: v2Now, ...overrides };
  client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: sequence,
    projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id) }, turnItems: [item],
      visibleTurnItems: [{ item, position: 0, sourceItemId: item.id, sourceThreadId: item.threadId, visibility: "local" }], ...projectionFields } });
}
