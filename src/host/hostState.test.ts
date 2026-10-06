import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestrationV2Command, ProviderInstanceId, ProviderDriverKind, ThreadId, ProjectId, TurnItemId, EventId, RuntimeRequestId, NodeId, ProviderSessionId, type OrchestrationV2ShellStreamItem, type OrchestrationV2ThreadStreamItem, type OrchestrationV2TurnItem, type OrchestrationV2ArchivedShellSnapshot, type OrchestrationV2ArchivedShellStreamItem, type OrchestrationV2ProjectedTurnItem, type OrchestrationV2RuntimeRequest, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { v2Now, v2Project, v2ThreadShell, v2Projection, v2ShellSnapshot } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { HostState, type HostTransport, type HostStateOptions } from "./hostState.js";
import type { DiscoveredServer } from "./serverDiscovery.js";
import type { HostStateSnapshot } from "../shared/bridge.js";

const provider: ServerProvider = { instanceId: ProviderInstanceId.make("kimi"), driver: "acp" as ServerProvider["driver"], displayName: "Kimi", enabled: true, installed: true, version: null, status: "ready", auth: { status: "authenticated" }, checkedAt: "2026-10-06T00:00:00Z", models: [{ slug: "kimi-for-coding", name: "Kimi", isCustom: false, capabilities: null }], slashCommands: [], skills: [] };
const server = { origin: "http://audit.invalid", descriptor: { environmentId: "audit", label: "Audit" } } as DiscoveredServer;
const credentials = { get: async () => ({ origin: server.origin, environmentId: server.descriptor.environmentId, accessToken: "fake", expiresAt: Date.now() + 100_000, scopes: [] }), save: async () => {}, clear: async () => {} };
class FakeTransport implements HostTransport {
  connected = false;
  config: NonNullable<HostTransport["config"]> = { providers: [provider] };
  onClose: HostTransport["onClose"] = null;
  onConfig: HostTransport["onConfig"] = null;
  connections = 0; shellStarts = 0; threadStops = 0;
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
    this.threadHandlers.set(id, handler);
    const thread = this.shell.threads.find((thread) => thread.id === id);
    handler({ kind: "snapshot", snapshotSequence: 0, projection: { ...v2Projection, thread: { ...v2Projection.thread, id: ThreadId.make(id),
      modelSelection: thread?.modelSelection ?? v2Projection.thread.modelSelection, runtimeMode: thread?.runtimeMode ?? v2Projection.thread.runtimeMode,
      interactionMode: thread?.interactionMode ?? v2Projection.thread.interactionMode } } });
    return async () => { this.threadStops += 1; };
  }
  async dispatch(raw: unknown) {
    const command = Schema.decodeUnknownSync(OrchestrationV2Command)(raw); this.commands.push(command);
    if (command.type === "thread.create") this.shell = { ...this.shell, threads: [...this.shell.threads, { ...v2ThreadShell, id: command.threadId, projectId: command.projectId, modelSelection: command.modelSelection, runtimeMode: command.runtimeMode, interactionMode: command.interactionMode }] };
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
async function harness(options: Pick<HostStateOptions, "workspaceRoot" | "workspaceRoots" | "pickProject"> = {}, client = new FakeTransport()) {
  const host = new HostState({ home: "/tmp/fake-t3-test", credentials, discover: async () => ({ ok: true, server }), reconnectDelayMs: 0, ...options }, client);
  await host.start(); return { host, client };
}
function waitFor(host: HostState, predicate: (state: HostStateSnapshot) => boolean) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error("State transition timed out")); }, 3000);
    let off = () => {};
    off = host.onDidChangeState((state) => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => off()); resolve(); } });
  });
}
function message(id: string, text: string, ordinal = 0): OrchestrationV2TurnItem {
  return { id: TurnItemId.make(id), threadId: v2ThreadShell.id, type: "assistant_message", messageId: "message" as Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>["messageId"], text, streaming: false, title: null, status: "completed", ordinal, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null, startedAt: v2Now, completedAt: v2Now, updatedAt: v2Now };
}

test("Missing server retries preserve credentials and recover after the server is started externally", async (t) => {
  const client = new FakeTransport();
  let running = false;
  let credentialReads = 0;
  let credentialWrites = 0;
  let pairingAttempts = 0;
  const host = new HostState({
    home: "/tmp/fake-t3-test",
    credentials: {
      get: async () => { credentialReads += 1; return credentials.get(); },
      save: async () => { credentialWrites += 1; },
      clear: async () => { credentialWrites += 1; },
    },
    discover: async () => running ? { ok: true, server } : { ok: false, reason: "Start the isolated server first." },
    pair: async () => { pairingAttempts += 1; throw new Error("Pairing requires a running server."); },
  }, client);
  t.after(() => host.dispose());
  await host.start();
  await host.reconnect();
  await host.pairNow();
  assert.equal(host.snapshot().phase, "no-server");
  assert.equal(host.snapshot().notice, "Start the isolated server first.");
  assert.equal(credentialReads, 0);
  assert.equal(pairingAttempts, 0);
  assert.equal(client.connections, 0);

  running = true;
  await host.reconnect();
  assert.equal(host.snapshot().phase, "ready");
  assert.equal(host.snapshot().notice, undefined);
  assert.equal(client.connections, 1);
  assert.equal(credentialReads, 1);
  assert.equal(credentialWrites, 0);
  assert.equal(pairingAttempts, 0);
  assert.ok(host.snapshot().threads.length > 0);
});

test("New Thread focuses the created thread and uses the server's ACP model catalog", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const id = await host.newThread();
  assert.equal(host.snapshot().activeThreadId, id);
  const created = client.commands.find((command) => command.type === "thread.create");
  assert.equal(created?.modelSelection.instanceId, "kimi");
  await host.sendMessage("hello", id);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, id);
});
test("A queued send keeps its explicit thread target when another view changes selection", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const old = host.snapshot().activeThreadId!;
  await host.newThread(); await host.sendMessage("for the original conversation", old);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, old);
});
test("New threads default to the open workspace and hide other projects", async (t) => {
  const { host, client } = await harness({ workspaceRoot: () => "/tmp/another-workspace" }); t.after(() => host.dispose());
  assert.equal(host.snapshot().activeThreadId, undefined);
  assert.deepEqual(host.snapshot().projects, []);
  await host.newThread();
  assert.equal(host.snapshot().projects.length, 1);
  assert.equal(client.shell.projects.length, 2);
  assert.equal(client.commands.find((command) => command.type === "thread.create")?.projectId, "workspace-project");
});
test("The first message without a project uses Scratch and preserves draft model and modes", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [], threads: [] };
  client.config = { scratchWorkspaceRoot: "/tmp/fake-t3-test/scratch", providers: [
    { ...provider, instanceId: ProviderInstanceId.make("codex"), driver: ProviderDriverKind.make("codex"), models: [{ slug: "default", name: "Default", isCustom: false, capabilities: null }] },
    { ...provider, supportedRuntimeModes: ["approval-required", "full-access"], models: [
      ...provider.models, { slug: "custom-kimi", name: "Custom Kimi", isCustom: true, capabilities: null },
    ] },
  ] };
  const { host } = await harness({ pickProject: async () => { throw new Error("Scratch must not prompt for a folder."); } }, client);
  t.after(() => host.dispose());
  assert.equal(host.snapshot().activeThreadId, undefined);
  assert.equal(host.snapshot().draft.supportsNoProject, true);
  assert.equal(host.snapshot().draft.modelSelection?.instanceId, "codex");
  const selection = { instanceId: "kimi", model: "custom-kimi" };
  await host.setModel(undefined, selection);
  assert.equal(host.snapshot().draft.runtimeMode, "approval-required");
  await host.setModes(undefined, { runtimeMode: "full-access", interactionMode: "plan" });
  assert.equal(client.commands.length, 0);
  assert.equal(client.shell.projects.length, 0);
  await host.sendMessage("hello without a project");
  const created = client.commands.find((command) => command.type === "thread.create");
  assert.equal(created?.projectId, "scratch-project");
  assert.deepEqual(created?.modelSelection, selection);
  assert.equal(created?.runtimeMode, "full-access");
  assert.equal(created?.interactionMode, "plan");
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, created?.threadId);
  assert.equal(host.snapshot().threads.find((thread) => thread.id === created?.threadId)?.interactionMode, "plan");
  assert.equal(client.scratchCalls, 1);
  assert.equal(client.projectCreates, 0);
});
test("An open workspace cannot create a conversation in Scratch", async (t) => {
  const client = new FakeTransport();
  client.config = { ...client.config, scratchWorkspaceRoot: "/tmp/fake-t3-test/scratch" };
  const { host } = await harness({ workspaceRoot: () => "/tmp/open-workspace", pickProject: async (_, supportsNoProject) => {
    assert.equal(supportsNoProject, false); return { noProject: true };
  } }, client);
  t.after(() => host.dispose());
  const draft = host.snapshot().draft;
  await assert.rejects(host.chooseProject(), /requires a project/);
  assert.deepEqual(host.snapshot().draft, draft);
  assert.equal(client.scratchCalls, 0);
  assert.equal(client.commands.length, 0);
});
test("An empty window can choose No project and reuse the server's Scratch project", async (t) => {
  const client = new FakeTransport();
  client.config = { ...client.config, scratchWorkspaceRoot: "/tmp/fake-t3-test/scratch" };
  const { host } = await harness({ pickProject: async () => ({ noProject: true }) }, client);
  t.after(() => host.dispose());
  await host.chooseProject();
  await host.newThread();
  await host.newThread();
  assert.equal(client.scratchCalls, 2);
  assert.equal(client.projectCreates, 0);
  assert.equal(host.snapshot().projects.filter((project) => project.title === "No project").length, 1);
  assert.ok(client.commands.every((command) => command.type !== "thread.create" || command.projectId === "scratch-project"));
});

function workspaceFixture() {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [
    { ...v2Project, workspaceRoot: "/tmp/t3-vscode" },
    { ...v2Project, id: ProjectId.make("other-project"), title: "t3-vscode", workspaceRoot: "/tmp/t3-vscode-other" },
    { ...v2Project, id: ProjectId.make("nested-project"), workspaceRoot: "/tmp/t3-vscode/nested" },
    { ...v2Project, id: ProjectId.make("scratch-project"), workspaceRoot: "/tmp/fake-t3-test/scratch", title: "No project" },
  ], threads: [
    { ...v2ThreadShell, worktreePath: "/tmp/t3-worktrees/feature" },
    { ...v2ThreadShell, id: ThreadId.make("other-thread"), projectId: ProjectId.make("other-project") },
    { ...v2ThreadShell, id: ThreadId.make("nested-thread"), projectId: ProjectId.make("nested-project") },
    { ...v2ThreadShell, id: ThreadId.make("scratch-thread"), projectId: ProjectId.make("scratch-project") },
  ] };
  return client;
}
test("Workspace lists match project paths, including their worktrees, without leaking unrelated or archived threads", async (t) => {
  const client = workspaceFixture();
  client.archive = { ...client.archive, threads: client.shell.threads.map((thread) => ({ ...thread, id: ThreadId.make(`archived-${thread.id}`), archivedAt: v2Now })) };
  const { host } = await harness({ workspaceRoots: () => ["/tmp/t3-vscode/"] }, client); t.after(() => host.dispose());
  assert.deepEqual(host.snapshot().projects.map((project) => project.id), [v2Project.id]);
  assert.deepEqual(host.snapshot().threads.map((thread) => thread.id), [v2ThreadShell.id]);
  assert.equal(host.snapshot().activeThreadId, v2ThreadShell.id);
  assert.equal(host.workspaceForThread(v2ThreadShell.id), "/tmp/t3-worktrees/feature");
  await host.loadArchive();
  assert.deepEqual(host.snapshot().threads.map((thread) => thread.id), [v2ThreadShell.id, `archived-${v2ThreadShell.id}`]);
  assert.equal(client.shell.projects.length, 4);
});
test("Unrelated thread and project actions are rejected before any server mutation", async (t) => {
  const { host, client } = await harness({ workspaceRoots: () => ["/tmp/t3-vscode"] }, workspaceFixture()); t.after(() => host.dispose());
  await assert.rejects(host.selectThread("other-thread"), /current workspace/);
  await assert.rejects(host.sendMessage("wrong project", "other-thread"), /current workspace/);
  await assert.rejects(host.threadAction("other-thread", "archive"), /current workspace/);
  await assert.rejects(host.setModel("other-thread", { instanceId: "kimi", model: "kimi-for-coding" }), /current workspace/);
  await assert.rejects(host.newThread("other-project"), /current workspace/);
  await assert.rejects(host.chooseProject("other-project"), /current workspace/);
  assert.throws(() => host.workspaceForThread("other-thread"), /current workspace/);
  assert.equal(client.commands.length, 0);
  assert.equal(client.projectCreates, 0);
  assert.equal(host.snapshot().activeThreadId, v2ThreadShell.id);
});
test("Workspace project pickers receive only opened folders and cannot select an outside folder", async (t) => {
  const { host, client } = await harness({ workspaceRoots: () => ["/tmp/t3-vscode"], pickProject: async (projects, supportsNoProject, roots) => {
    assert.deepEqual(projects.map((project) => project.id), [v2Project.id]);
    assert.equal(supportsNoProject, false);
    assert.deepEqual(roots, ["/tmp/t3-vscode"]);
    return { workspaceRoot: "/tmp/outside" };
  } }, workspaceFixture()); t.after(() => host.dispose());
  await assert.rejects(host.chooseProject(), /current VS Code workspace/);
  assert.equal(host.snapshot().draft.workspaceRoot, "/tmp/t3-vscode");
  assert.equal(client.commands.length, 0);
});
test("Workspace changes immediately hide the old transcript and reconcile selection and subscriptions", async (t) => {
  let roots = ["/tmp/t3-vscode"];
  const { host, client } = await harness({ workspaceRoots: () => roots }, workspaceFixture()); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const text = message("old-workspace", "private to the old workspace");
  handler({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, turnItems: [text], visibleTurnItems: [projected(text, 0)] } });
  assert.equal(host.snapshot().transcript.length, 1);
  roots = ["/tmp/t3-vscode-other"];
  assert.equal(host.snapshot().activeThreadId, undefined);
  assert.deepEqual(host.snapshot().transcript, []);
  await host.workspaceChanged();
  assert.equal(host.snapshot().activeThreadId, "other-thread");
  assert.equal(host.snapshot().draft.projectId, "other-project");
  assert.equal(client.threadStops, 1);
  roots = [];
  await host.workspaceChanged();
  assert.equal(host.snapshot().projects.length, 4);
  assert.equal(host.snapshot().activeThreadId, "other-thread");
});
test("Multi-root workspaces expose only projects belonging to their opened folders", async (t) => {
  const { host } = await harness({ workspaceRoots: () => ["/tmp/t3-vscode", "/tmp/t3-vscode-other"] }, workspaceFixture()); t.after(() => host.dispose());
  assert.deepEqual(host.snapshot().threads.map((thread) => thread.id), [v2ThreadShell.id, "other-thread"]);
  assert.deepEqual(host.snapshot().projects.map((project) => project.id), [v2Project.id, "other-project"]);
  await host.chooseProject("other-project");
  const id = await host.newThread();
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.projectId, "other-project");
});
test("Workspace matching resolves symlinks to avoid duplicate projects for the same folder", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "t3-vscode-scope-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const real = join(directory, "project"); const linked = join(directory, "linked");
  await mkdir(real); await symlink(real, linked);
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [{ ...v2Project, workspaceRoot: real }] };
  const { host } = await harness({ workspaceRoots: () => [linked] }, client); t.after(() => host.dispose());
  assert.equal(host.snapshot().projects[0]?.id, v2Project.id);
  await host.newThread();
  assert.equal(client.projectCreates, 0);
  assert.equal(client.commands.find((command) => command.type === "thread.create")?.projectId, v2Project.id);
});
test("Servers without Scratch prompt for a folder and create the project before the first send", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [], threads: [] };
  let picks = 0;
  const { host } = await harness({ pickProject: async (projects, supportsNoProject) => {
    picks += 1; assert.deepEqual(projects, []); assert.equal(supportsNoProject, false);
    return { workspaceRoot: "/tmp/chosen-folder" };
  } }, client);
  t.after(() => host.dispose());
  await host.sendMessage("hello from a folder");
  assert.equal(picks, 1);
  assert.equal(client.scratchCalls, 0);
  assert.equal(client.projectCreates, 1);
  assert.equal(host.snapshot().projects[0]?.workspaceRoot, "/tmp/chosen-folder");
  const created = client.commands.find((command) => command.type === "thread.create");
  assert.equal(created?.projectId, "workspace-project");
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, created?.threadId);
});
test("Cancelling project selection leaves an empty conversation ready without creating server state", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [], threads: [] };
  const { host } = await harness({ pickProject: async () => null }, client);
  t.after(() => host.dispose());
  await assert.rejects(host.sendMessage("retain this draft"), /Choose a project or open a folder/);
  assert.equal(host.snapshot().phase, "ready");
  assert.equal(host.snapshot().activeThreadId, undefined);
  assert.equal(client.commands.length, 0);
  assert.equal(client.projectCreates, 0);
  assert.equal(client.scratchCalls, 0);
});
test("Cancelling the optional project picker preserves a projectless draft", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [], threads: [] };
  client.config = { ...client.config, scratchWorkspaceRoot: "/tmp/fake-t3-test/scratch" };
  const { host } = await harness({ pickProject: async () => null }, client); t.after(() => host.dispose());
  const draft = host.snapshot().draft;
  await host.chooseProject();
  assert.deepEqual(host.snapshot().draft, draft);
  await host.sendMessage("continue without a project");
  assert.equal(client.scratchCalls, 1);
  assert.equal(client.projectCreates, 0);
});
test("A selected existing project is reused without filtering other projects or touching Scratch", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, threads: [], projects: [...client.shell.projects, { ...v2Project, id: ProjectId.make("other-project"), title: "Other", workspaceRoot: "/tmp/other" }] };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  await host.chooseProject("other-project");
  await host.sendMessage("use the selected project");
  assert.equal(client.commands.find((command) => command.type === "thread.create")?.projectId, "other-project");
  assert.equal(host.snapshot().projects.length, 2);
  assert.equal(client.projectCreates, 0);
  assert.equal(client.scratchCalls, 0);
});
test("Invalid draft modes and unavailable models do not mutate the draft or dispatch commands", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [], threads: [] };
  client.config = { providers: [{ ...provider, supportedRuntimeModes: ["approval-required", "full-access"] }] };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  const draft = host.snapshot().draft;
  await assert.rejects(host.setModes(undefined, { runtimeMode: "auto", interactionMode: "plan" }), /does not support/);
  await assert.rejects(host.setModes(undefined, { runtimeMode: "full-access", interactionMode: "invented" }));
  await assert.rejects(host.setModel(undefined, { instanceId: "missing", model: "missing" }), /unavailable/);
  assert.deepEqual(host.snapshot().draft, draft);
  assert.equal(client.commands.length, 0);
});
test("An empty model catalog fails before creating Scratch, a project, or a thread", async (t) => {
  const client = new FakeTransport();
  client.shell = { ...client.shell, projects: [], threads: [] };
  client.config = { providers: [], scratchWorkspaceRoot: "/tmp/fake-t3-test/scratch" };
  const { host } = await harness({ pickProject: async () => { throw new Error("No models must not prompt for a folder."); } }, client);
  t.after(() => host.dispose());
  assert.equal(host.snapshot().draft.modelSelection, null);
  await assert.rejects(host.sendMessage("no models yet"), /No available provider models/);
  assert.equal(client.commands.length, 0);
  assert.equal(client.projectCreates, 0);
  assert.equal(client.scratchCalls, 0);
});
test("Automatic reconnect recreates shell and thread subscriptions", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const ready = waitFor(host, (state) => state.phase === "ready" && client.connections === 2);
  client.connected = false; client.onClose?.(); await ready;
  assert.equal(client.shellStarts, 2); assert.ok(client.threadStops >= 1);
});
test("Direct thread.updated shell deltas update the shared list", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  client.shellHandler?.({ kind: "thread.updated", sequence: 1, location: "active", thread: { ...v2ThreadShell, title: "Updated elsewhere" } });
  assert.equal(host.snapshot().threads[0]?.title, "Updated elsewhere");
});
test("Stream projection retains rich items and rejects duplicate or stale sequences", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const event = (sequence: number, text: string): OrchestrationV2ThreadStreamItem => ({ kind: "event", sequence, event: { id: EventId.make(`event-${sequence}`), type: "turn-item.updated", threadId: v2ThreadShell.id, occurredAt: v2Now, payload: message("assistant", text) } as Extract<OrchestrationV2ThreadStreamItem, { kind: "event" }>["event"] });
  handler(event(2, "new content")); handler(event(1, "stale"));
  const item = host.snapshot().transcript[0]?.item;
  assert.ok(item?.type === "assistant_message"); assert.equal(item.text, "new content");
  assert.equal(typeof item.updatedAt, "string");
});
test("A switched-away thread cannot overwrite the current view through a late callback", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const oldHandler = client.threadHandlers.get(v2ThreadShell.id)!;
  const id = await host.newThread();
  oldHandler({ kind: "snapshot", snapshotSequence: 99, projection: { ...v2Projection, turnItems: [message("late", "old conversation")] } });
  assert.equal(host.snapshot().activeThreadId, id); assert.equal(host.snapshot().transcript.length, 0);
});
test("Model selection rejects unavailable providers before sending a command", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  await assert.rejects(host.setModel(v2ThreadShell.id, { instanceId: "missing", model: "invented" }), /unavailable/);
  assert.equal(client.commands.length, 0);
});

test("Archiving keeps a thread discoverable and restorable outside the active shell", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const id = host.snapshot().activeThreadId!;
  await host.threadAction(id, "archive");
  assert.equal(client.shell.threads.length, 0);
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.archived, true);
  await assert.rejects(host.sendMessage("should not send", id), /Restore this thread/);
  await host.reconnect();
  assert.equal(client.archiveStarts, 2);
  assert.equal(host.snapshot().activeThreadId, id);
  await host.threadAction(id, "unarchive");
  assert.equal(host.snapshot().threads.find((thread) => thread.id === id)?.archived, false);
  await host.sendMessage("restored", id);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.threadId, id);
});

test("Archive updates from other clients appear on demand and reject stale deltas", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const archived = { ...v2ThreadShell, id: ThreadId.make("archived"), archivedAt: v2Now };
  client.archive = { ...client.archive, threads: [archived] };
  assert.equal(host.snapshot().threads.length, 1);
  await host.loadArchive();
  assert.equal(host.snapshot().threads.length, 2);
  client.archiveHandler?.({ kind: "thread.updated", sequence: 5, thread: { ...archived, title: "Renamed in T3" } });
  client.archiveHandler?.({ kind: "thread.updated", sequence: 4, thread: { ...archived, title: "Stale" } });
  assert.equal(host.snapshot().threads.find((thread) => thread.id === archived.id)?.title, "Renamed in T3");
  client.archiveHandler?.({ kind: "thread.removed", sequence: 6, threadId: archived.id });
  assert.equal(host.snapshot().threads.length, 1);
});

const projected = (item: OrchestrationV2TurnItem, position: number): OrchestrationV2ProjectedTurnItem => ({
  item, position, sourceItemId: item.id, sourceThreadId: item.threadId, visibility: "local",
});
test("An older history response preserves newer live text while the page is in flight", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const recent = message("recent", "streaming text", 1);
  handler({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, turnItems: [recent], visibleTurnItems: [projected(recent, 0)] }, historyCursor: "older-page", hasMoreHistory: true });
  let finish!: (page: Awaited<ReturnType<HostTransport["getHistory"]>>) => void;
  client.getHistory = async () => new Promise((resolve) => { finish = resolve; });
  const loading = host.loadHistory(v2ThreadShell.id);
  assert.equal(host.snapshot().history.loading, true);
  handler({ kind: "event", sequence: 2, event: { id: EventId.make("newer"), type: "turn-item.updated", threadId: v2ThreadShell.id, occurredAt: v2Now, payload: message("recent", "final live text", 1) } });
  finish({ snapshotSequence: 1, items: [projected(message("old", "earlier message"), 0), projected(recent, 1)], nextCursor: null, hasMoreHistory: false });
  await loading;
  assert.deepEqual(host.snapshot().transcript.map(({ item }) => item.type === "assistant_message" ? item.text : null), ["earlier message", "final live text"]);
  assert.equal(host.snapshot().history.hasMore, false);
  assert.equal(host.snapshot().history.loading, false);
});

test("Approvals validate pending and resumable state before dispatching a response", async (t) => {
  const { host, client } = await harness(); t.after(() => host.dispose());
  const handler = client.threadHandlers.get(v2ThreadShell.id)!;
  const request: OrchestrationV2RuntimeRequest = { id: RuntimeRequestId.make("approval"), nodeId: NodeId.make("node"), providerTurnId: null, nativeRequestRef: null, kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session") }, createdAt: v2Now, resolvedAt: null };
  handler({ kind: "snapshot", snapshotSequence: 1, projection: { ...v2Projection, runtimeRequests: [request] } });
  assert.equal(host.snapshot().pending.approvals[0]?.responseCapability, "live");
  await host.respondToRequest({ threadId: v2ThreadShell.id, requestId: request.id, decision: "accept" });
  assert.equal(client.commands.findLast((command) => command.type === "runtime-request.respond")?.decision, "accept");
  handler({ kind: "snapshot", snapshotSequence: 2, projection: { ...v2Projection, runtimeRequests: [{ ...request, responseCapability: { type: "not_resumable", reason: "Provider ended" } }] } });
  await assert.rejects(host.respondToRequest({ threadId: v2ThreadShell.id, requestId: request.id, decision: "accept" }), /provider process has ended/i);
  handler({ kind: "snapshot", snapshotSequence: 3, projection: { ...v2Projection, runtimeRequests: [{ ...request, status: "resolved" }] } });
  assert.equal(host.snapshot().pending.approvals.length, 0);
  await assert.rejects(host.respondToRequest({ threadId: v2ThreadShell.id, requestId: request.id, decision: "accept" }), /no longer pending/);
});
