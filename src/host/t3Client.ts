import { captureTurnBaseline, findTurnBaseline } from "./turnBaseline.js";
/** Transport adapter over T3's vendored contracts and Effect RPC client. */
import { randomUUID } from "node:crypto";
import {
  CommandId, ProjectId, ThreadId, TurnItemId, OrchestrationV2Command, ScheduledTaskId, ScheduledTaskUpsertInput, type ScheduledTask,
  ORCHESTRATION_V2_WS_METHODS as V2, WS_METHODS,
  ORCHESTRATION_PROTOCOL_HEADER, ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  type OrchestrationV2ShellSnapshot, type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadStreamItem, type OrchestrationV2ArchivedShellStreamItem, type ServerConfig,
  type ReviewDiffFileContentsInput, ProviderInstanceId, type AssetResource, type AttachmentCreateUploadUrlInput, ChatAttachment,
} from "@t3tools/contracts";
import * as RemoteAuth from "@t3tools/client-runtime/authorization";
import * as Rpc from "@t3tools/client-runtime/rpc/session";
import { makeEnvironmentHttpApiGroupClient } from "@t3tools/client-runtime/rpc/http";
import { PrimaryConnectionTarget } from "@t3tools/client-runtime/connection/model";
import { applyServerConfigProjection, type ServerConfigProjection } from "@t3tools/client-runtime/state/server-config-projection";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";
import type { DiscoveredServer } from "./serverDiscovery.js";
import { readCheckpointFiles, readCheckpointDiff } from "./checkpointFiles.js";

export type Subscription = () => Promise<void>;
const services = Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal);
type Services = Scope.Scope | HttpClient.HttpClient | Socket.WebSocketConstructor;
const threadId = Schema.decodeUnknownSync(ThreadId);

export class T3Client {
  private scope: Scope.Closeable | null = null;
  private session: Rpc.RpcSession | null = null;
  private server: DiscoveredServer | null = null;
  private accessToken: string | null = null;
  private configState: Option.Option<ServerConfigProjection> = Option.none();
  onClose: (() => void) | null = null;
  onConfig: ((config: ServerConfig) => void) | null = null;
  get connected(): boolean { return this.session !== null; }
  get config(): ServerConfig | null { return Option.getOrNull(this.configState)?.config ?? null; }

  async connect(server: DiscoveredServer, accessToken: string): Promise<void> {
    await this.disconnect();
    const scope = await Effect.runPromise(Scope.make());
    this.scope = scope;
    try {
      const socketUrl = new URL(await this.run(RemoteAuth.resolveRemoteWebSocketConnectionUrl({
        httpBaseUrl: server.origin, wsBaseUrl: server.origin, bearerToken: accessToken,
        clientMetadata: { label: "VS Code", deviceType: "desktop" },
      })));
      socketUrl.searchParams.set("orchestrationProtocol", "2");
      const session = await this.run(Effect.gen(function* () {
        const factory = yield* Rpc.make({ usageLimitSources: true, usageLimitsCommand: true });
        return yield* factory.connect({
          environmentId: server.descriptor.environmentId, label: server.descriptor.label,
          httpBaseUrl: server.origin, socketUrl: socketUrl.toString(),
          httpAuthorization: { _tag: "Bearer", token: accessToken },
          target: new PrimaryConnectionTarget({ environmentId: server.descriptor.environmentId,
            label: server.descriptor.label, httpBaseUrl: server.origin, wsBaseUrl: server.origin }),
        });
      }));
      const config = await this.run(session.initialConfig);
      if (config.environment.environmentId !== server.descriptor.environmentId) throw new Error("T3 environment identity changed during connection.");
      this.session = session;
      this.server = server;
      this.accessToken = accessToken;
      this.configState = applyServerConfigProjection(Option.none(), { version: 1, type: "snapshot", config });
      await this.subscribe(session.subscribeServerConfig({ usageLimitSources: true }), (event) => {
        this.configState = applyServerConfigProjection(this.configState, event);
        if (this.config) this.onConfig?.(this.config);
      });
      void this.run(session.closed).catch(() => undefined).then(() => {
        if (this.session !== session) return;
        this.session = null;
        this.onClose?.();
      });
    } catch (cause) {
      await this.disconnect();
      throw cause;
    }
  }
  async disconnect(): Promise<void> {
    const scope = this.scope;
    this.scope = null; this.session = null; this.server = null; this.accessToken = null;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
  }
  private run<A, E>(effect: Effect.Effect<A, E, Services>): Promise<A> {
    if (!this.scope) return Promise.reject(new Error("Not connected to T3."));
    return Effect.runPromise(effect.pipe(Effect.provide(services), Effect.provideService(Scope.Scope, this.scope)));
  }
  private requireSession(): Rpc.RpcSession {
    if (!this.session) throw new Error("Not connected to T3.");
    return this.session;
  }
  private async subscribe<A, E>(stream: Stream.Stream<A, E, Services>, handler: (item: A) => void): Promise<Subscription> {
    const fiber = await this.run(Effect.forkScoped(Stream.runForEach(stream, (item) => Effect.sync(() => handler(item)))));
    return async () => { await Effect.runPromise(Fiber.interrupt(fiber)); };
  }
  async snapshotShell(): Promise<OrchestrationV2ShellSnapshot> {
    const snapshot = await this.run(Stream.runHead(this.requireSession().client[V2.subscribeShell]({})
      .pipe(Stream.filter((item) => item.kind === "snapshot"))));
    if (Option.isNone(snapshot)) throw new Error("T3 returned no thread list.");
    return snapshot.value.snapshot;
  }
  subscribeShell(handler: (item: OrchestrationV2ShellStreamItem) => void): Promise<Subscription> {
    return this.subscribe(this.requireSession().client[V2.subscribeShell]({ requestCompletionMarker: true }), handler);
  }
  snapshotArchive() {
    return this.run(this.requireSession().client[V2.getArchivedShellSnapshot]({}));
  }
  subscribeArchive(handler: (item: OrchestrationV2ArchivedShellStreamItem) => void): Promise<Subscription> {
    return this.subscribe(this.requireSession().client[V2.subscribeArchivedShell]({}), handler);
  }
  subscribeThread(id: string, handler: (item: OrchestrationV2ThreadStreamItem) => void): Promise<Subscription> {
    return this.subscribe(this.requireSession().client[V2.subscribeThread]({
      threadId: threadId(id), requestCompletionMarker: true, acceptBoundedSnapshot: true,
    }), handler);
  }
  getThreadProjection(id: string) { return this.run(this.requireSession().client[V2.getThreadProjection]({ threadId: threadId(id) })); }
  async dispatch(input: unknown): Promise<void> {
    const command = Schema.decodeUnknownSync(OrchestrationV2Command)(input);
    await this.run(this.requireSession().client[V2.dispatchCommand](command));
  }
  async ensureScratchProject(): Promise<string> {
    const result = await this.run(this.requireSession().client[WS_METHODS.projectsEnsureScratch]({}));
    return result.projectId;
  }
  async createProject(workspaceRoot: string, title: string): Promise<string> {
    const id = Schema.decodeUnknownSync(ProjectId)(randomUUID());
    await this.run(this.requireSession().client[WS_METHODS.projectsMutate]({
      type: "project.create", commandId: Schema.decodeUnknownSync(CommandId)(randomUUID()),
      projectId: id, workspaceRoot, title,
    }));
    return id;
  }
  async getHistory(id: string, cursor: string) {
    const server = this.server;
    const accessToken = this.accessToken;
    if (!server || !accessToken) throw new Error("Not connected to T3.");
    return this.run(Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiGroupClient(server.origin, "orchestration");
      return yield* client.threadHistoryPage({
        params: { threadId: threadId(id) }, query: { cursor },
        headers: { authorization: `Bearer ${accessToken}`, [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
      });
    }).pipe(Effect.timeout("15 seconds")));
  }
  async getTurnItem(id: string, itemId: string) {
    return this.run(this.requireSession().client[V2.getTurnItem]({
      threadId: threadId(id), itemId: Schema.decodeUnknownSync(TurnItemId)(itemId),
    }));
  }
  listScheduledTasks() {
    return this.run(this.requireSession().client[WS_METHODS.scheduledTasksList]({}).pipe(Effect.timeout("10 seconds")));
  }
  subscribeScheduledTasks(handler: (tasks: ReadonlyArray<ScheduledTask>) => void, onError: (message: string) => void): Promise<Subscription> {
    const stream = this.requireSession().client[WS_METHODS.scheduledTasksSubscribe]({}).pipe(
      Stream.catch((cause) => { onError(String(cause)); return Stream.empty; }));
    return this.subscribe(stream, (result) => handler(result.tasks));
  }
  upsertScheduledTask(input: unknown) {
    return this.run(this.requireSession().client[WS_METHODS.scheduledTasksUpsert](Schema.decodeUnknownSync(ScheduledTaskUpsertInput)(input)));
  }
  setScheduledTaskEnabled(id: string, enabled: boolean) {
    return this.run(this.requireSession().client[WS_METHODS.scheduledTasksSetEnabled]({ id: ScheduledTaskId.make(id), enabled }));
  }
  runScheduledTask(id: string) {
    return this.run(this.requireSession().client[WS_METHODS.scheduledTasksRunNow]({ id: ScheduledTaskId.make(id) }));
  }
  searchThreads(query: string) {
    return this.run(this.requireSession().client[V2.searchThreads]({ query, limit: 50 }));
  }
  searchPaths(cwd: string, query: string) {
    return this.run(this.requireSession().client[WS_METHODS.projectsSearchEntries]({ cwd, query, limit: 50 }));
  }
  async refreshProviders(instanceId?: string, cwd?: string) {
    const payload = await this.run(this.requireSession().client[WS_METHODS.serverRefreshProviders]({
      ...(instanceId ? { instanceId: ProviderInstanceId.make(instanceId) } : {}), ...(cwd ? { cwd } : {}),
    }));
    this.configState = applyServerConfigProjection(this.configState, { version: 1, type: "providerStatuses", payload });
    if (this.config) this.onConfig?.(this.config);
    return payload;
  }
  getTurnDiff(id: string, fromTurnCount: number, toTurnCount: number) {
    return this.run(this.requireSession().client[V2.getTurnDiff]({ threadId: threadId(id), fromTurnCount, toTurnCount, ignoreWhitespace: false }));
  }
  getDiffFileContents(input: ReviewDiffFileContentsInput) {
    return readCheckpointFiles(input);
  }
  captureTurnBaseline = captureTurnBaseline;
  findTurnBaseline = findTurnBaseline;
  getSavedTurnDiff(input: Parameters<typeof readCheckpointDiff>[0]) {
    return readCheckpointDiff(input);
  }
  async createAssetUrl(resource: AssetResource) {
    const server = this.server;
    if (!server) throw new Error("Not connected to T3.");
    const result = await this.run(this.requireSession().client[WS_METHODS.assetsCreateUrl]({ resource }));
    const url = new URL(result.relativeUrl, server.origin);
    if (url.origin !== new URL(server.origin).origin || url.username || url.password) throw new Error("T3 returned an invalid asset URL.");
    return { url: url.href, expiresAt: result.expiresAt };
  }
  async uploadAttachment(input: AttachmentCreateUploadUrlInput, bytes: Uint8Array): Promise<ChatAttachment> {
    const server = this.server; if (!server) throw new Error("Not connected to T3.");
    const capabilities = this.config?.environment.capabilities;
    if (!capabilities?.attachmentUploads) throw new Error("This T3 server does not support attachment uploads. Update T3 Code, then retry.");
    if (input.type === "file" && (!capabilities.fileAttachments || input.sizeBytes > capabilities.fileAttachments.maxUploadBytes)) throw new Error("This file exceeds the server's supported file upload limit.");
    const result = await this.run(this.requireSession().client[WS_METHODS.attachmentsCreateUploadUrl](input));
    const url = new URL(result.relativeUrl, server.origin);
    if (url.origin !== new URL(server.origin).origin || url.username || url.password) throw new Error("T3 returned an invalid upload URL.");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": input.mimeType }, body: Buffer.from(bytes), redirect: "error", signal: AbortSignal.timeout(5 * 60_000) });
      if (!response.ok) throw new Error(`Attachment upload failed (${response.status}).`);
      return Schema.decodeUnknownSync(ChatAttachment)({ ...input, type: input.type ?? "image", id: result.attachmentId });
    } catch (cause) { await this.deleteAttachment(result.attachmentId).catch(() => undefined); throw cause; }
  }
  async deleteAttachment(attachmentId: string): Promise<void> {
    await this.run(this.requireSession().client[WS_METHODS.attachmentsDelete]({ attachmentId }));
  }
  // Retained for the standalone M0 transport diagnostic.
  sendMessage(id: string, text: string): Promise<void> {
    return this.dispatch({ type: "message.dispatch", commandId: randomUUID(), threadId: id,
      messageId: randomUUID(), text, attachments: [], createdBy: "user", creationSource: "web",
      deliveryIntent: "auto", dispatchMode: { type: "start_immediately" } });
  }
}
