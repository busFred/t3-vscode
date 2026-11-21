/**
 * One transport over the local T3 server plus paired remote environments.
 * The local connection keeps its existing lifecycle; remotes connect independently,
 * contribute their shells to one merged list, and receive every command addressed to their threads.
 */
import type {
  AssetResource, AttachmentCreateUploadUrlInput, OrchestrationV2ShellSnapshot, OrchestrationV2ShellStreamItem, ServerConfig,
} from "@t3tools/contracts";
import * as ShellState from "@t3tools/client-runtime/state/shell";
import { T3Client, type Subscription } from "./t3Client.js";
import type { DiscoveredServer } from "./serverDiscovery.js";
import type { IgnorableEnvironmentStatus, RemoteEnvironmentRecord } from "./environmentCatalog.js";
import type { RemoteConnectionState } from "../shared/environmentStatus.js";
import * as RemoteAuth from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { recordAuth, recordKey } from "./environmentAuth.js";

export type { RemoteConnectionState };
export interface RemoteEnvironmentStatus {
  readonly environmentId: string; readonly label: string; readonly httpBaseUrl: string;
  readonly enabled: boolean; readonly state: RemoteConnectionState; readonly error?: string; readonly serverVersion?: string;
  readonly expiresAt: number | null; readonly ignoredStatus?: IgnorableEnvironmentStatus;
}
export interface ThreadEnvironment { readonly environmentId: string; readonly label: string }
type RemoteClient = Partial<Pick<T3Client, "mintPeerPairingCode" | "forceStopThread" | "listPeerLinks" | "updateSettings">> & Pick<T3Client, "pullRequestRequest" | "createGuestShare" | "connect" | "disconnect" | "connected" | "onClose" | "onConfig" | "config" | "snapshotShell" | "subscribeShell" | "subscribeThread"
  | "mcpAppCallTool" | "mcpAppToolInfo" | "mcpAppReadResource" | "mcpAppUpdateModelContext" | "getThreadProjection" | "dispatch" | "answerSecretRequest" | "answerLinkRequest" | "getHistory" | "getTurnItem" | "searchThreads" | "searchThreadStream" | "createAssetUrl" | "uploadAttachment"
  | "deleteAttachment" | "getTurnDiff" | "subscribeWorktreeSetup" | "cancelWorktreeSetup" | "launchThread" | "listRefs" | "searchPaths" | "refreshProviders"
  | "startProjectClone" | "cancelProjectClone" | "retryProjectClone" | "subscribeProjectClones" | "writeProjectFile" | "deleteProject">;
/** What starting and composing a conversation on a paired machine, or cloning this repository there, needs from that machine's own server. */
export type EnvironmentCalls = Partial<Pick<T3Client, "updateSettings" | "dispatch">> & Pick<T3Client, "launchThread" | "listRefs" | "searchPaths" | "refreshProviders"
  | "startProjectClone" | "cancelProjectClone" | "retryProjectClone" | "subscribeProjectClones" | "writeProjectFile" | "deleteProject">;
/** Whether this client may clone a repository onto a paired machine, and why not. */
export type CloneAccess = "ok" | "disconnected" | "unsupported" | "permission";
interface Remote {
  record: RemoteEnvironmentRecord; client: RemoteClient | null; shell: OrchestrationV2ShellSnapshot | null;
  subscription: Subscription | null; state: RemoteConnectionState; error?: string; retry: ReturnType<typeof setTimeout> | null; attempts: number; generation: number;
  /** Key-bound sessions only: the next renewal, and the one in flight so concurrent callers share it. */
  renewal?: ReturnType<typeof setTimeout> | null; renewing?: Promise<void> | null; renewedAt?: number | undefined;
}
/** Renew a key-bound token this long before it expires, and retry a failed renewal this often. */
const RENEW_BEFORE_MS = 5 * 60_000, RENEW_RETRY_MS = 60_000, TOKEN_SKEW_MS = 60_000, RENEW_JITTER_MS = 20_000;
/**
 * How the T3 server refused a key-bound request, from its own typed error (a proxy's bare 401 has
 * none), found anywhere in the cause chain. As upstream (`mapRemoteDpopEnvironmentError`), only
 * `invalid_credential` ends the session; a proof outside its time window means this computer's
 * clock is off, which pairing again would not fix.
 */
const refusal = (cause: unknown): "ended" | "clock" | "proxy" | "proof" | null => {
  for (let value = cause, depth = 0; typeof value === "object" && value !== null && depth < 6; value = (value as { cause?: unknown }).cause, depth++) {
    const error = value as { _tag?: unknown; reason?: unknown; dpopFailureReason?: unknown };
    if (error._tag !== "EnvironmentAuthInvalidError" || error.reason !== "invalid_credential") continue;
    // The proof itself was refused, not the session: pairing again would fail the same way, so keep retrying.
    switch (error.dpopFailureReason) {
      case "time_window": return "clock";
      case "request_mismatch": return "proxy";
      case "replay": case "invalid_proof": return "proof";
      default: return "ended"; // key_mismatch, token_mismatch or no reason: the session is gone.
    }
  }
  return null;
};
const PROOF_REFUSED = {
  clock: "This computer's clock is too far from that machine's. Correct the clock; it reconnects on its own.",
  proxy: "Something in front of that machine changes the address of each request, so its sign-in check fails. Connect to it directly or fix the proxy.",
  proof: "That machine refused this computer's sign-in proof. Retrying.",
} as const;
const KEY_BOUND_ENDED = "This machine signed this computer out, or it went unused for 30 days. Pair it again with a new link.";
// Connection errors can quote the socket URL; never surface its ticket or token.
const describeError = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause)).replace(/([?&#](?:wsTicket|token|access_token|dpop)=)[^&#\s]+/gi, "$1…");
const REMOTE_REFRESH_TIMEOUT_MS = 5000;
const withTimeout = <A>(promise: Promise<A>, ms: number): Promise<A> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timed out.")), ms); timer.unref?.();
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (cause: unknown) => { clearTimeout(timer); reject(cause); });
});
const authFailure = (cause: unknown): boolean => typeof cause === "object" && cause !== null && (
  ("reason" in cause && cause.reason === "authentication") || ("_tag" in cause && cause._tag === "EnvironmentAuthInvalidError") || ("status" in cause && cause.status === 401));
/** Asks the T3 server itself whether a credential still works: true, false, or null when no T3 server answered (e.g. a proxy). */
export type CredentialCheck = (record: RemoteEnvironmentRecord) => Promise<boolean | null>;
const checkCredential: CredentialCheck = (record) => Effect.runPromise(Effect.provide(
  RemoteAuth.fetchRemoteSessionState({ httpBaseUrl: record.httpBaseUrl, bearerToken: record.accessToken, timeoutMs: 10_000 }), FetchHttpClient.layer))
  .then((state) => state.authenticated, () => null);
/** T3Client reads only the origin and the environment identity from a discovered server. */
const remoteServer = (record: RemoteEnvironmentRecord): DiscoveredServer => ({
  origin: record.httpBaseUrl,
  runtime: { version: 1, pid: 0, port: Number(new URL(record.httpBaseUrl).port) || 0, origin: record.httpBaseUrl, startedAt: record.addedAt },
  descriptor: { environmentId: record.environmentId, label: record.label, serverVersion: record.serverVersion ?? "unknown",
    platform: { os: "unknown", arch: "other" }, capabilities: { repositoryIdentity: true } },
} as unknown as DiscoveredServer);

export class MultiEnvironmentClient {
  private readonly remotes = new Map<string, Remote>();
  private primaryShell: OrchestrationV2ShellSnapshot | null = null;
  private shellHandler: ((item: OrchestrationV2ShellStreamItem) => void) | null = null;
  private readonly makeClient: () => RemoteClient;
  private readonly reconnectDelayMs: number;
  private readonly checkCredential: CredentialCheck;
  private readonly renewToken: ((record: RemoteEnvironmentRecord) => Promise<RemoteEnvironmentRecord | null>) | undefined;
  private disposed = false;
  readonly primary: T3Client;
  /** Fired when remote connection states change, for status UI. */
  onRemoteStatus: (() => void) | null = null;
  /** Fired when a remote rejects an unexpired credential: that machine revoked this client, so its entry should go. */
  onRemoteRevoked: ((record: RemoteEnvironmentRecord) => void) | null = null;
  /**
   * `renewToken` serves key-bound pairings (T3 Code 0.1.11), whose own key signs every request: it renews
   * the token and stores it, returning the stored record (null when the pairing was removed or replaced).
   */
  constructor(primary: T3Client, options: { makeClient?: () => RemoteClient; reconnectDelayMs?: number; checkCredential?: CredentialCheck;
    renewToken?: (record: RemoteEnvironmentRecord) => Promise<RemoteEnvironmentRecord | null> } = {}) {
    this.primary = primary; this.makeClient = options.makeClient ?? (() => new T3Client()); this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    this.renewToken = options.renewToken;
    // The bearer session check must never see a key-bound token; such a record has no bearer answer.
    this.checkCredential = options.checkCredential ?? (async (record) => record.auth === "dpop" ? null : checkCredential(record));
  }
  get connected(): boolean { return this.primary.connected; }
  get onClose(): (() => void) | null { return this.primary.onClose; }
  set onClose(listener: (() => void) | null) { this.primary.onClose = listener; }
  get onConfig(): ((config: ServerConfig) => void) | null { return this.primary.onConfig; }
  set onConfig(listener: ((config: ServerConfig) => void) | null) { this.primary.onConfig = listener; }
  get config(): ServerConfig | null { return this.primary.config; }
  get worktreeSettingsCapabilities() { return this.primary.worktreeSettingsCapabilities; }

  // ---- Remote environments ----
  remoteStatuses(): ReadonlyArray<RemoteEnvironmentStatus> {
    return [...this.remotes.values()].map(({ record, state, error }) => ({ environmentId: record.environmentId, label: record.label, httpBaseUrl: record.httpBaseUrl,
      // A key-bound session renews itself, so its short token life is no pairing deadline.
      enabled: record.enabled, state, expiresAt: record.auth === "dpop" ? null : record.expiresAt, ...(error ? { error } : {}), ...(record.serverVersion ? { serverVersion: record.serverVersion } : {}),
      ...(record.ignoredStatus ? { ignoredStatus: record.ignoredStatus } : {}) }));
  }
  /** Reconciles live connections with the catalog: removed or disabled entries disconnect, new or re-paired ones connect. */
  async setRemoteEnvironments(records: ReadonlyArray<RemoteEnvironmentRecord>): Promise<void> {
    if (this.disposed) return;
    const next = new Map(records.map(record => [record.environmentId, record] as const));
    for (const [id, remote] of [...this.remotes]) {
      const record = next.get(id);
      if (!record) { this.remotes.delete(id); await this.stopRemote(remote); continue; }
      // A renewed key-bound token (from this or another window) is the same session, so live sockets stay;
      // a new token after that session ended is a fresh pairing and reconnects.
      const renewed = record.auth === "dpop" && remote.record.auth === "dpop" && remote.state !== "expired" && record.addedAt === remote.record.addedAt;
      const changed = (record.accessToken !== remote.record.accessToken && !renewed) || record.httpBaseUrl !== remote.record.httpBaseUrl || record.auth !== remote.record.auth;
      remote.record = record;
      if (!record.enabled) { await this.stopRemote(remote); remote.state = "disabled"; delete remote.error; }
      else if (changed || remote.state === "disabled") { await this.stopRemote(remote); this.startRemote(remote); }
    }
    for (const record of records) {
      if (this.remotes.has(record.environmentId)) continue;
      const remote: Remote = { record, client: null, shell: null, subscription: null, state: record.enabled ? "connecting" : "disabled", retry: null, attempts: 0, generation: 0 };
      this.remotes.set(record.environmentId, remote);
      if (record.enabled) this.startRemote(remote);
    }
    this.emitMerged(); this.onRemoteStatus?.();
  }
  private startRemote(remote: Remote): void {
    const generation = ++remote.generation;
    remote.state = "connecting"; delete remote.error;
    const current = () => !this.disposed && remote.generation === generation && this.remotes.get(remote.record.environmentId) === remote;
    void (async () => {
      const client = this.makeClient();
      remote.client = client;
      try {
        if (remote.record.auth === "dpop") {
          const key = await recordKey(remote.record);
          // Without its key the session cannot sign anything, so it asks to be paired again instead of retrying.
          if (!key) { await client.disconnect().catch(() => undefined); if (current()) this.keyBoundEnded(remote); return; }
          await client.connect(remoteServer(remote.record), recordAuth(remote.record, key, () => this.currentToken(remote)));
        } else await client.connect(remoteServer(remote.record), remote.record.accessToken);
        if (!current()) { await client.disconnect(); return; }
        const shell = await client.snapshotShell();
        if (!current()) { await client.disconnect(); return; }
        remote.shell = shell;
        const subscription = await client.subscribeShell((item) => {
          // `snapshot-required` only answers an `httpSnapshotFallback` resume, which this client
          // never requests; it carries no rows, so it is not a delta.
          if (!current() || item.kind === "synchronized" || item.kind === "snapshot-required") return;
          remote.shell = item.kind === "snapshot"
            ? ShellState.mergeShellSnapshotProjects(remote.shell, item.snapshot, item.resolvedRepositoryIdentityRoots === undefined ? undefined : { resolvedRepositoryIdentityRoots: item.resolvedRepositoryIdentityRoots })
            : remote.shell ? ShellState.applyShellStreamEvent(remote.shell, item) : remote.shell;
          this.emitMerged();
        });
        if (!current()) { await subscription(); await client.disconnect(); return; }
        remote.subscription = subscription; remote.state = "connected"; remote.attempts = 0;
        if (remote.record.auth === "dpop") this.scheduleRenewal(remote, generation);
        client.onClose = () => { if (current()) void this.remoteClosed(remote, generation, "Connection lost."); };
        // A paired machine's settings (such as auto-settle) change what its sessions offer, so redraw like the local server does.
        client.onConfig = (config) => { if (current()) this.primary.onConfig?.(config); };
        this.emitMerged(); this.onRemoteStatus?.();
      } catch (cause) {
        if (!current()) return;
        await client.disconnect().catch(() => undefined);
        // A key-bound session answers for itself: renewing either works (retry the connection) or the server refuses it.
        // A key-bound session answers for itself and never reaches the bearer check below, which would
        // send its token as a bearer token. A refused proof retries with its reason; otherwise renewing
        // tells whether the session is gone, unless the token was renewed moments ago (a proxy guarding
        // only the socket, say), which is a plain retry.
        if (remote.record.auth === "dpop") {
          const proof = authFailure(cause) ? refusal(cause) : null;
          if (proof && proof !== "ended") { await this.remoteClosed(remote, generation, PROOF_REFUSED[proof]); return; }
          // The server's own refusal always gets a renewal to decide; only an untyped 401 right after one is a plain retry.
          if (authFailure(cause) && (proof === "ended" || Date.now() - (remote.renewedAt ?? 0) > RENEW_BEFORE_MS)) {
            const refused = await this.renew(remote).then(() => null, refusal);
            if (!current()) return;
            if (refused === "ended") { this.keyBoundEnded(remote); return; }
            if (refused) { await this.remoteClosed(remote, generation, PROOF_REFUSED[refused]); return; }
          }
        }
        // Only the T3 server's own "not signed in" ends a pairing; a bare 401 from a proxy keeps retrying.
        else if (authFailure(cause) && await this.checkCredential(remote.record).catch(() => null) === false) {
          if (!current()) return;
          // T3 pairings last a fixed term, so a rejection before it ends means that machine revoked this client.
          const expired = remote.record.expiresAt !== null && Date.now() >= remote.record.expiresAt - 60_000;
          remote.client = null; remote.shell = null; remote.state = "expired";
          remote.error = expired ? "This pairing expired. Pair the machine again with a new link." : "This machine revoked access.";
          this.emitMerged(); this.onRemoteStatus?.();
          if (!expired) this.onRemoteRevoked?.(remote.record);
          return;
        }
        await this.remoteClosed(remote, generation, describeError(cause));
      }
    })();
  }
  /**
   * A key-bound session that will not renew was revoked or went unused past its window; the two look
   * the same from here, so the machine stays listed with "Pair again" instead of being removed.
   */
  private keyBoundEnded(remote: Remote): void {
    if (remote.renewal) clearTimeout(remote.renewal);
    remote.renewal = null;
    remote.client = null; remote.shell = null; remote.state = "expired"; remote.error = KEY_BOUND_ENDED;
    this.emitMerged(); this.onRemoteStatus?.();
  }
  /** The token to present now, renewed first when it is about to expire. */
  private async currentToken(remote: Remote): Promise<{ token: string; expiresAt: number | null }> {
    if (remote.record.expiresAt === null || remote.record.expiresAt - TOKEN_SKEW_MS <= Date.now()) await this.renew(remote);
    return { token: remote.record.accessToken, expiresAt: remote.record.expiresAt };
  }
  /** One renewal at a time per machine; every caller waits for the same one. */
  private renew(remote: Remote): Promise<void> {
    const renewToken = this.renewToken;
    if (!renewToken) return Promise.reject(new Error("This computer cannot renew its sign-in to paired machines."));
    // A renewal belongs to one pairing: one still running when the machine is paired again must not
    // put the old session's token on the new pairing.
    if (remote.renewing) return remote.renewing;
    const pairing = remote.record.addedAt;
    const run: { promise: Promise<void> | null } = { promise: null };
    run.promise = (async () => {
      const stored = await renewToken(remote.record);
      // Stopped meanwhile (disabled, removed or restarted): nothing to apply.
      if (remote.renewing !== run.promise) throw new Error("This machine stopped while signing in again.");
      if (remote.record.addedAt !== pairing) throw new Error("This machine was paired again.");
      if (!stored) throw new Error("This machine is no longer paired.");
      // Only the token changes: settings another window changed meanwhile (such as disabling) stay.
      remote.record = { ...remote.record, accessToken: stored.accessToken, expiresAt: stored.expiresAt }; remote.renewedAt = Date.now();
    })().finally(() => { if (remote.renewing === run.promise) remote.renewing = null; });
    remote.renewing = run.promise;
    const renewing = run.promise;
    return renewing;
  }
  /** Keeps a connected key-bound session alive: the server only moves its 30-day window when the token renews. */
  private scheduleRenewal(remote: Remote, generation: number, delayMs?: number): void {
    if (remote.renewal) clearTimeout(remote.renewal);
    // Windows renewing the same pairing share an expiry; jitter spreads them so the first one's
    // stored token lets the others skip.
    const due = (remote.record.expiresAt ?? 0) - RENEW_BEFORE_MS - Date.now() + Math.random() * RENEW_JITTER_MS;
    remote.renewal = setTimeout(() => {
      remote.renewal = null;
      if (this.disposed || remote.generation !== generation) return;
      // Another window already renewed (its token reached this one through the catalog).
      if ((remote.record.expiresAt ?? 0) - RENEW_BEFORE_MS > Date.now()) { this.scheduleRenewal(remote, generation); return; }
      void this.renew(remote).then(() => {
        if (remote.generation === generation && !this.disposed) this.scheduleRenewal(remote, generation);
      }, async (cause: unknown) => {
        if (remote.generation !== generation || this.disposed) return;
        // Only the T3 server refusing the renewal ends the session; a network error, a proxy's 401 or a clock off retries.
        if (refusal(cause) === "ended") {
          if (remote.generation !== generation) return;
          // stopRemote moves the generation at once; a catalog change that restarts the machine while it stops moves it again.
          const stopping = this.stopRemote(remote), stopped = remote.generation;
          await stopping;
          if (remote.generation === stopped && !this.disposed) this.keyBoundEnded(remote);
          return;
        }
        if (remote.generation === generation && !this.disposed) this.scheduleRenewal(remote, generation, RENEW_RETRY_MS);
      });
    }, Math.max(30_000, delayMs ?? due));
    remote.renewal.unref?.();
  }
  private async remoteClosed(remote: Remote, generation: number, reason: string): Promise<void> {
    if (remote.generation !== generation) return;
    const subscription = remote.subscription; remote.subscription = null;
    await subscription?.().catch(() => undefined);
    // Sessions stay listed while reconnecting; commands report the machine as disconnected.
    remote.client = null; remote.state = "error"; remote.error = reason;
    // Schedule the retry before telling listeners: a listener that throws must not stop reconnects for good (T3 0.1.11).
    if (!this.disposed && remote.record.enabled) {
      const delay = Math.min(this.reconnectDelayMs * 2 ** remote.attempts, 60_000); remote.attempts += 1;
      remote.retry = setTimeout(() => { remote.retry = null; if (remote.generation === generation && !this.disposed) this.startRemote(remote); }, delay);
      remote.retry.unref?.();
    }
    try { this.emitMerged(); this.onRemoteStatus?.(); } catch { /* a failing listener is not a connection failure; callers run this unawaited */ }
  }
  private async stopRemote(remote: Remote): Promise<void> {
    remote.generation += 1;
    if (remote.retry) clearTimeout(remote.retry);
    if (remote.renewal) clearTimeout(remote.renewal);
    remote.retry = null; remote.renewal = null; remote.renewedAt = undefined; remote.renewing = null;
    const { subscription, client } = remote;
    remote.subscription = null; remote.client = null; remote.shell = null;
    if (client) { client.onClose = null; client.onConfig = null; }
    await subscription?.().catch(() => undefined);
    await client?.disconnect().catch(() => undefined);
  }
  /** Reconnects one enabled remote now. */
  reconnectRemote(environmentId: string): void {
    const remote = this.remotes.get(environmentId);
    if (!remote?.record.enabled || remote.state === "connecting") return;
    // Its sessions stay listed while the new connection starts, as after a dropped connection.
    const shell = remote.shell, generation = remote.generation + 1;
    void this.stopRemote(remote).then(() => {
      if (this.disposed || remote.generation !== generation || !remote.record.enabled || this.remotes.get(environmentId) !== remote) return;
      remote.shell = shell; this.startRemote(remote); this.onRemoteStatus?.();
    });
  }
  /** Reconnects every enabled remote now, e.g. after the user asks to reconnect. */
  reconnectRemotes(): void {
    for (const remote of this.remotes.values()) if (remote.record.enabled && remote.state !== "connected" && remote.state !== "connecting") {
      void this.stopRemote(remote).then(() => { if (!this.disposed) this.startRemote(remote); this.onRemoteStatus?.(); });
    }
  }

  // ---- Merged shell ----
  private merged(primary: OrchestrationV2ShellSnapshot): OrchestrationV2ShellSnapshot {
    const shells = [...this.remotes.values()].flatMap(remote => remote.shell ? [remote.shell] : []);
    if (!shells.length) return primary;
    // Ids are random UUIDs; on an unexpected collision the local record wins and the remote one is not routed.
    const projectIds = new Set(primary.projects.map(project => project.id));
    const threadIds = new Set([...primary.threads, ...primary.archivedThreads].map(thread => thread.id));
    const projects = [...primary.projects], threads = [...primary.threads], archivedThreads = [...primary.archivedThreads];
    for (const shell of shells) {
      for (const project of shell.projects) if (!projectIds.has(project.id)) { projectIds.add(project.id); projects.push(project); }
      for (const thread of shell.threads) if (!threadIds.has(thread.id)) { threadIds.add(thread.id); threads.push(thread); }
      for (const thread of shell.archivedThreads) if (!threadIds.has(thread.id)) { threadIds.add(thread.id); archivedThreads.push(thread); }
    }
    return { ...primary, projects, threads, archivedThreads };
  }
  private emitMerged(): void {
    if (this.primaryShell && this.shellHandler) this.shellHandler({ kind: "snapshot", snapshot: this.merged(this.primaryShell) });
  }
  async snapshotShell(): Promise<OrchestrationV2ShellSnapshot> {
    // Callers re-read after their own commands, which may have targeted a remote thread.
    const [snapshot] = await Promise.all([this.primary.snapshotShell(), ...[...this.remotes.values()].map(async (remote) => {
      const { client, generation } = remote;
      if (remote.state !== "connected" || !client) return;
      // A stalled remote must not hold up local commands, which re-read the shell after each change.
      const shell = await withTimeout(client.snapshotShell(), REMOTE_REFRESH_TIMEOUT_MS).catch(() => null);
      if (shell && remote.generation === generation && (!remote.shell || shell.snapshotSequence >= remote.shell.snapshotSequence))
        remote.shell = ShellState.mergeShellSnapshotProjects(remote.shell, shell);
    })]);
    this.primaryShell = ShellState.mergeShellSnapshotProjects(this.primaryShell, snapshot);
    return this.merged(this.primaryShell);
  }
  async subscribeShell(handler: (item: OrchestrationV2ShellStreamItem) => void): Promise<Subscription> {
    const unsubscribe = await this.primary.subscribeShell((item) => {
      if (item.kind === "snapshot") {
        const enrichment = item.resolvedRepositoryIdentityRoots !== undefined;
        this.primaryShell = ShellState.mergeShellSnapshotProjects(this.primaryShell, item.snapshot, enrichment ? { resolvedRepositoryIdentityRoots: item.resolvedRepositoryIdentityRoots! } : undefined);
        // Local-only states pass the server's item through unchanged.
        handler(enrichment || !this.hasRemoteShells() ? item : { kind: "snapshot", snapshot: this.merged(this.primaryShell) });
      } else {
        // `snapshot-required` carries no rows and is never requested here; pass it through
        // without applying it as a delta.
        if (item.kind !== "synchronized" && item.kind !== "snapshot-required" && this.primaryShell) this.primaryShell = ShellState.applyShellStreamEvent(this.primaryShell, item);
        handler(item);
      }
    });
    this.shellHandler = handler;
    return async () => { if (this.shellHandler === handler) this.shellHandler = null; await unsubscribe(); };
  }
  private hasRemoteShells(): boolean { return [...this.remotes.values()].some(remote => remote.shell !== null); }

  // ---- Routing ----
  private ownership: { shells: ReadonlyArray<OrchestrationV2ShellSnapshot | null>; threads: Map<string, Remote>; projects: Map<string, Remote>; primaryThreads: Set<string> } | null = null;
  /** Ownership index, rebuilt only when a shell object changes; callers query it once per thread per snapshot. */
  private owners() {
    const remotes = [...this.remotes.values()], shells = [this.primaryShell, ...remotes.map(remote => remote.shell)];
    if (this.ownership && this.ownership.shells.length === shells.length && this.ownership.shells.every((shell, index) => shell === shells[index])) return this.ownership;
    const primary = this.primaryShell, primaryThreads = new Set([...primary?.threads ?? [], ...primary?.archivedThreads ?? []].map(thread => thread.id));
    const primaryProjects = new Set(primary?.projects.map(project => project.id));
    const threads = new Map<string, Remote>(), projects = new Map<string, Remote>();
    for (const remote of remotes) if (remote.shell) {
      for (const thread of [...remote.shell.threads, ...remote.shell.archivedThreads]) if (!primaryThreads.has(thread.id) && !threads.has(thread.id)) threads.set(thread.id, remote);
      for (const project of remote.shell.projects) if (!primaryProjects.has(project.id) && !projects.has(project.id)) projects.set(project.id, remote);
    }
    return this.ownership = { shells, threads, projects, primaryThreads };
  }
  private remoteForThread(id: string | undefined): Remote | undefined {
    return id && this.hasRemoteShells() ? this.owners().threads.get(id) : undefined;
  }
  private primaryOwnsThread(id: string): boolean { return this.owners().primaryThreads.has(id); }
  private remoteForProject(id: string | undefined): Remote | undefined {
    return id && this.hasRemoteShells() ? this.owners().projects.get(id) : undefined;
  }
  /** The remote environment that owns a thread; undefined for local threads. */
  threadEnvironment(id: string | undefined): ThreadEnvironment | undefined {
    const remote = this.remoteForThread(id);
    return remote ? { environmentId: remote.record.environmentId, label: remote.record.label } : undefined;
  }
  projectEnvironment(id: string | undefined): ThreadEnvironment | undefined {
    const remote = this.remoteForProject(id);
    return remote ? { environmentId: remote.record.environmentId, label: remote.record.label } : undefined;
  }
  /** Provider configuration of a paired machine (null while it has never connected); the local server's for undefined. */
  configForEnvironment(environmentId: string | undefined): ServerConfig | null {
    if (!environmentId) return this.primary.config;
    return this.remotes.get(environmentId)?.client?.config ?? null;
  }
  /**
   * Cloning needs the machine's server to track clones and this pairing to hold `source-control:write`, which T3's
   * pairing links grant by default. A pairing recorded without scopes is left for the server to decide.
   */
  cloneAccess(environmentId: string): CloneAccess {
    const remote = this.remotes.get(environmentId);
    if (!remote?.client?.connected || remote.state !== "connected") return "disconnected";
    if (remote.client.config?.environment?.capabilities?.projectCloneTracking !== true) return "unsupported";
    return remote.record.scopes.length && !remote.record.scopes.includes("source-control:write") ? "permission" : "ok";
  }
  /** A paired machine's server, for starting a conversation there; throws while it is disconnected. */
  environmentCalls(environmentId: string): EnvironmentCalls { return this.forEnvironment(environmentId); }
  /** Provider configuration of the environment that runs a thread. */
  configForThread(id: string | undefined): ServerConfig | null {
    const remote = this.remoteForThread(id);
    return remote ? remote.client?.config ?? null : this.primary.config;
  }
  private connectedRemote(remote: Remote): RemoteClient {
    if (!remote.client?.connected || remote.state !== "connected") throw new Error(`${remote.record.label} is disconnected. Wait for it to reconnect, then retry.`);
    return remote.client;
  }
  private forThread(id: string | undefined): RemoteClient {
    const remote = this.remoteForThread(id);
    return remote ? this.connectedRemote(remote) : this.primary;
  }
  /** `environmentId` names a remote; omit it for the local server. */
  private forEnvironment(environmentId: string | undefined): RemoteClient {
    if (!environmentId) return this.primary;
    const remote = this.remotes.get(environmentId);
    if (!remote) throw new Error("That environment is no longer paired.");
    return this.connectedRemote(remote);
  }

  // ---- Local connection lifecycle (unchanged semantics) ----
  connect(server: DiscoveredServer, accessToken: string): Promise<void> { return this.primary.connect(server, accessToken); }
  async disconnect(): Promise<void> { this.primaryShell = null; await this.primary.disconnect(); }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const remote of this.remotes.values()) await this.stopRemote(remote);
    this.remotes.clear();
  }

  // ---- Thread-scoped calls follow the thread's environment ----
  async subscribeThread(...args: Parameters<T3Client["subscribeThread"]>) { return this.forThread(args[0]).subscribeThread(...args); }
  async getThreadProjection(id: string) { return this.forThread(id).getThreadProjection(id); }
  async dispatch(input: unknown): Promise<void> {
    const command = (input ?? {}) as { threadId?: string; sourceThreadId?: string; projectId?: string };
    const thread = command.threadId ?? command.sourceThreadId;
    // A creation command names a thread no environment has yet, so its project decides.
    const remote = this.remoteForThread(thread) ?? (thread && this.primaryOwnsThread(thread) ? undefined : this.remoteForProject(command.projectId));
    return (remote ? this.connectedRemote(remote) : this.primary).dispatch(input);
  }
  forceStopThread(input: unknown) {
    const client = this.forThread((input as { threadId: string }).threadId);
    if (!client.forceStopThread) throw new Error("This connection cannot force stop threads.");
    return client.forceStopThread(input);
  }
  async answerLinkRequest(input: unknown): Promise<void> {
    return this.forThread((input as { threadId?: string } | null)?.threadId).answerLinkRequest(input);
  }
  async answerSecretRequest(input: unknown): Promise<void> {
    return this.forThread((input as { threadId?: string } | null)?.threadId).answerSecretRequest(input);
  }
  async createGuestShare(id: string) { return this.forThread(id).createGuestShare(id); }
  async getHistory(id: string, cursor: string) { return this.forThread(id).getHistory(id, cursor); }
  async getTurnItem(id: string, itemId: string) { return this.forThread(id).getTurnItem(id, itemId); }
  async getTurnDiff(id: string, fromTurnCount: number, toTurnCount: number) { return this.forThread(id).getTurnDiff(id, fromTurnCount, toTurnCount); }
  async subscribeWorktreeSetup(...args: Parameters<T3Client["subscribeWorktreeSetup"]>) { return this.forThread(args[0]).subscribeWorktreeSetup(...args); }
  async cancelWorktreeSetup(id: string) { return this.forThread(id).cancelWorktreeSetup(id); }
  /** Attachment resources name no thread, so callers pass the conversation that displays them. */
  mcpAppCallTool(input: { threadId: string }) { return this.forThread(input.threadId).mcpAppCallTool(input); }
  mcpAppToolInfo(input: { threadId: string }) { return this.forThread(input.threadId).mcpAppToolInfo(input); }
  mcpAppReadResource(input: { threadId: string }) { return this.forThread(input.threadId).mcpAppReadResource(input); }
  mcpAppUpdateModelContext(input: { threadId: string }) { return this.forThread(input.threadId).mcpAppUpdateModelContext(input); }
  async createAssetUrl(resource: AssetResource, threadId?: string) {
    return this.forThread(threadId ?? ("threadId" in resource ? resource.threadId : undefined)).createAssetUrl(resource);
  }
  /** Attachments live on the server of the conversation that will receive them. */
  async uploadAttachment(input: AttachmentCreateUploadUrlInput, bytes: Uint8Array, environmentId?: string) { return this.forEnvironment(environmentId).uploadAttachment(input, bytes); }
  async deleteAttachment(attachmentId: string, environmentId?: string) { return this.forEnvironment(environmentId).deleteAttachment(attachmentId); }
  searchThreadStream(...args: Parameters<T3Client["searchThreadStream"]>) { return this.forThread(args[0]).searchThreadStream(...args); }
  async searchThreads(query: string): ReturnType<T3Client["searchThreads"]> {
    const local = await this.primary.searchThreads(query);
    const remotes = await Promise.allSettled([...this.remotes.values()].filter(remote => remote.state === "connected" && remote.client)
      .map(remote => withTimeout(remote.client!.searchThreads(query), REMOTE_REFRESH_TIMEOUT_MS)));
    const matches = remotes.flatMap(result => result.status === "fulfilled" ? result.value.matches : []);
    return matches.length ? { ...local, matches: [...local.matches, ...matches] } : local;
  }

  // ---- Local-only operations: project setup, checkouts, settings, schedules ----
  listPeerLinks(threadId?: string) {
    const client = threadId ? this.forThread(threadId) : this.primary;
    if (!client.listPeerLinks) throw new Error("Linked environments are unavailable.");
    return client.listPeerLinks();
  }
  async mintPeerPairingCodeOn(environmentId: string, access: import("@t3tools/contracts").AuthMcpClientAccess): Promise<string> {
    const target = this.forEnvironment(environmentId);
    if (!target.mintPeerPairingCode) throw new Error("Cannot create a code there. Paste a code instead.");
    return target.mintPeerPairingCode(access);
  }
  linkPeer(input: unknown) { return this.primary.linkPeer(input); }
  unlinkPeer(input: unknown) { return this.primary.unlinkPeer(input); }
  snapshotArchive() { return this.primary.snapshotArchive(); }
  launchThread(input: unknown) { return this.primary.launchThread(input); }
  listRefs(input: unknown) { return this.primary.listRefs(input); }
  createWorktree(input: unknown) { return this.primary.createWorktree(input); }
  removeWorktree(cwd: string, path: string, force = false) { return this.primary.removeWorktree(cwd, path, force); }
  pullRequestRequest<K extends import("../shared/pullRequests.js").PullRequestOperation>(id: string, operation: K, input: unknown) { return this.forThread(id).pullRequestRequest(id, operation, input); }
  preparePullRequest(input: unknown) { return this.primary.preparePullRequest(input); }
  getSettings() { return this.primary.getSettings(); }
  updateSettings(patch: unknown) { return this.primary.updateSettings(patch); }
  gitAction(...args: Parameters<T3Client["gitAction"]>) { return this.primary.gitAction(...args); }
  ensureScratchProject() { return this.primary.ensureScratchProject(); }
  createProject(workspaceRoot: string, title: string) { return this.primary.createProject(workspaceRoot, title); }
  listScheduledTasks() { return this.primary.listScheduledTasks(); }
  subscribeScheduledTasks(...args: Parameters<T3Client["subscribeScheduledTasks"]>) { return this.primary.subscribeScheduledTasks(...args); }
  upsertScheduledTask(input: unknown) { return this.primary.upsertScheduledTask(input); }
  setScheduledTaskEnabled(id: string, enabled: boolean) { return this.primary.setScheduledTaskEnabled(id, enabled); }
  rotateWebhookToken(id: string) { return this.primary.rotateWebhookToken(id); }
  listWebhookDeliveries(id: string) { return this.primary.listWebhookDeliveries(id); }
  getWebhookDelivery(id: string, deliveryId: string) { return this.primary.getWebhookDelivery(id, deliveryId); }
  runScheduledTask(id: string) { return this.primary.runScheduledTask(id); }
  searchPaths(cwd: string, query: string) { return this.primary.searchPaths(cwd, query); }
  refreshProviders(instanceId?: string, cwd?: string) { return this.primary.refreshProviders(instanceId, cwd); }
  // Saved-turn files and baselines read the local Git repository; HostState never calls these for remote threads.
  captureTurnBaseline(...args: Parameters<T3Client["captureTurnBaseline"]>) { return this.primary.captureTurnBaseline(...args); }
  findTurnBaseline(...args: Parameters<T3Client["findTurnBaseline"]>) { return this.primary.findTurnBaseline(...args); }
  getSavedTurnDiff(...args: Parameters<T3Client["getSavedTurnDiff"]>) { return this.primary.getSavedTurnDiff(...args); }
  getDiffFileContents(...args: Parameters<T3Client["getDiffFileContents"]>) { return this.primary.getDiffFileContents(...args); }
}
