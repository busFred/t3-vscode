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
  commands: OrchestrationV2Command[] = [];
  projectCreates = 0;
  scratchCalls = 0;
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
    this.threadStarts += 1; this.threadHandlers.set(id, handler);
    const thread = this.shell.threads.find((thread) => thread.id === id);
    handler({ kind: "snapshot", snapshotSequence: 0, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id),
      modelSelection: thread?.modelSelection ?? v2Projection.thread.modelSelection, runtimeMode: thread?.runtimeMode ?? v2Projection.thread.runtimeMode,
      interactionMode: thread?.interactionMode ?? v2Projection.thread.interactionMode } } });
    return async () => { this.threadStops += 1; if (this.threadHandlers.get(id) === handler) this.threadHandlers.delete(id); };
  }
  async dispatch(raw: unknown) {
    const command = Schema.decodeUnknownSync(OrchestrationV2Command)(raw); this.commands.push(command);
    if (command.type === "thread.create") this.shell = { ...this.shell, threads: [...this.shell.threads, { ...v2ThreadShell, id: command.threadId, projectId: command.projectId, title: command.title, modelSelection: command.modelSelection, runtimeMode: command.runtimeMode, interactionMode: command.interactionMode }] };
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
  getTurnItem: HostTransport["getTurnItem"] = async () => ({ item: null });
}
function structuredCloneShell() { return { ...v2ShellSnapshot, projects: [...v2ShellSnapshot.projects], threads: [...v2ShellSnapshot.threads], archivedThreads: [] }; }
export async function harness(options: Pick<HostStateOptions, "workspaceRoot" | "workspaceRoots" | "pickProject"> = {}, client = new FakeTransport()) {
  const host = new HostState({ home: "/tmp/fake-t3-test", credentials, discover: async () => ({ ok: true, server }), reconnectDelayMs: 0, ...options }, client);
  await host.start(); return { host, client };
}
export async function viewsHarness() {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [
    { ...v2Project, workspaceRoot: "/tmp/t3-vscode", title: "t3-vscode" },
    { ...v2Project, id: ProjectId.make("outside"), workspaceRoot: "/tmp/outside", title: "Outside workspace" },
  ], threads: [
    ...["first", "second", "third"].map((id) => ({ ...v2ThreadShell, id: ThreadId.make(id), title: `${id} conversation`,
      modelSelection: { instanceId: provider.instanceId, model: provider.models[0]!.slug } })),
    { ...v2ThreadShell, id: ThreadId.make("outside-thread"), projectId: ProjectId.make("outside"), title: "Outside conversation" },
  ] };
  return harness({ workspaceRoots: () => ["/tmp/t3-vscode"] }, client);
}
export function publishText(client: FakeTransport, id: string, text: string, sequence = 1) {
  const item: OrchestrationV2TurnItem = { id: TurnItemId.make(`text-${id}`), threadId: ThreadId.make(id), type: "assistant_message",
    messageId: "message" as Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>["messageId"], text, streaming: false,
    title: null, status: "completed", ordinal: 0, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null,
    nativeItemRef: null, parentItemId: null, startedAt: v2Now, completedAt: v2Now, updatedAt: v2Now };
  client.threadHandlers.get(id)!({ kind: "snapshot", snapshotSequence: sequence,
    projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id) }, turnItems: [item],
      visibleTurnItems: [{ item, position: 0, sourceItemId: item.id, sourceThreadId: item.threadId, visibility: "local" }] } });
}
