/**
 * Remote environment catalog: other machines' T3 servers the user paired via
 * a pairing link. The whole catalog (tokens included) lives in ONE
 * SecretStorage key — SecretStorage is shared across VS Code profiles and
 * windows, so every mutation re-reads, applies, writes (last write wins).
 */

import * as RemoteAuth from "@t3tools/client-runtime/authorization";
import * as RemoteEnvironment from "@t3tools/client-runtime/environment";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { parseDeviceKey, type StoredDeviceKey } from "./deviceKey.js";

export interface RemoteEnvironmentRecord {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly accessToken: string;
  /** When `accessToken` expires. For a key-bound session that is the token's short life, not the pairing's. */
  readonly expiresAt: number | null;
  /** "dpop": the session is bound to this device's key and renews itself (T3 Code 0.1.11+). Absent: a fixed-term bearer pairing. */
  readonly auth?: "dpop";
  /** The key-bound session's own signing key (private JWK), stored with the pairing it belongs to. */
  readonly dpopKey?: StoredDeviceKey;
  readonly scopes: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly addedAt: string;
  readonly serverVersion?: string;
  /** A problem the user chose to ignore; it stays quiet until the machine reconnects or is paired again. */
  readonly ignoredStatus?: IgnorableEnvironmentStatus;
}
export type IgnorableEnvironmentStatus = "reconnecting" | "expiring" | "expired";
const IGNORABLE = new Set<unknown>(["reconnecting", "expiring", "expired"]);

/** Subset of vscode.SecretStorage (keeps this module free of the vscode import). */
export interface SecretBackend {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
  onDidChange(listener: (event: { key: string }) => unknown): { dispose(): unknown };
}

export const ENVIRONMENT_CATALOG_KEY = "t3-vscode.environments.v1";
/**
 * Key-bound pairings live under their own key. An older extension (another profile, or a window not
 * yet reloaded) rewrites the v1 catalog with a parser that drops fields it does not know, which would
 * strip a key-bound pairing's key; it never touches this key.
 */
export const KEY_BOUND_CATALOG_KEY = "t3-vscode.environments.keyBound.v1";
/**
 * A key-bound pairing's renewed token lives in its own key, never in the catalog: a renewal then
 * cannot rewrite the shared catalog, so it can never bring back a machine another window removed.
 */
export const ENVIRONMENT_TOKEN_KEY_PREFIX = "t3-vscode.environmentToken.v1.";
/** A pairing's identity: when it was made and the key it signs with, which is unique to it. */
export const pairingId = (record: Pick<RemoteEnvironmentRecord, "addedAt" | "dpopKey">) => `${record.addedAt}.${record.dpopKey?.x ?? ""}`;
/** One key per pairing, so a late write for an earlier pairing of the machine never replaces a newer pairing's token. */
const tokenKey = (record: Pick<RemoteEnvironmentRecord, "environmentId" | "addedAt" | "dpopKey">) => `${ENVIRONMENT_TOKEN_KEY_PREFIX}${record.environmentId}.${pairingId(record)}`;
interface StoredToken { readonly addedAt: string; readonly httpBaseUrl: string; readonly accessToken: string; readonly expiresAt: number; readonly pairing?: string }
const parseToken = (raw: string | undefined): StoredToken | null => {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Record<string, unknown> | null;
    if (!t || !isString(t.addedAt) || !isString(t.httpBaseUrl) || !isString(t.accessToken) || !t.accessToken || typeof t.expiresAt !== "number" || !Number.isFinite(t.expiresAt)) return null;
    return { addedAt: t.addedAt, httpBaseUrl: t.httpBaseUrl, accessToken: t.accessToken, expiresAt: t.expiresAt, ...(isString(t.pairing) ? { pairing: t.pairing } : {}) };
  } catch { return null; }
};
/** The same pairing: a token stored for an earlier pairing of that machine does not apply. */
const samePairing = (token: StoredToken, record: RemoteEnvironmentRecord) =>
  token.pairing === pairingId(record) && token.httpBaseUrl === record.httpBaseUrl;
const sameRecordPairing = (a: Pick<RemoteEnvironmentRecord, "addedAt" | "dpopKey" | "httpBaseUrl">, b: Pick<RemoteEnvironmentRecord, "addedAt" | "dpopKey" | "httpBaseUrl">) =>
  pairingId(a) === pairingId(b) && a.httpBaseUrl === b.httpBaseUrl;

const isString = (value: unknown): value is string => typeof value === "string";

/** Returns a clean record or null; unknown fields are dropped. */
const parseRecord = (raw: unknown): RemoteEnvironmentRecord | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isString(r.environmentId) || r.environmentId.length === 0) return null;
  if (!isString(r.label) || !isString(r.httpBaseUrl) || !isString(r.wsBaseUrl)) return null;
  if (!isString(r.accessToken) || r.accessToken.length === 0 || !isString(r.addedAt)) return null;
  if (typeof r.enabled !== "boolean" || !Array.isArray(r.scopes) || !r.scopes.every(isString)) return null;
  if (r.expiresAt !== null && !(typeof r.expiresAt === "number" && Number.isFinite(r.expiresAt))) return null;
  return {
    environmentId: r.environmentId, label: r.label, httpBaseUrl: r.httpBaseUrl, wsBaseUrl: r.wsBaseUrl,
    accessToken: r.accessToken, expiresAt: r.expiresAt as number | null, scopes: [...r.scopes as string[]],
    enabled: r.enabled, addedAt: r.addedAt,
    // A key-bound record stays key-bound even if its key is unreadable: its token must never travel as a
    // bearer token, so such a pairing asks to be paired again instead.
    ...(r.auth === "dpop" ? { auth: "dpop" as const, ...(parseDeviceKey(r.dpopKey) ? { dpopKey: parseDeviceKey(r.dpopKey)! } : {}) } : {}),
    ...(isString(r.serverVersion) ? { serverVersion: r.serverVersion } : {}),
    ...(IGNORABLE.has(r.ignoredStatus) ? { ignoredStatus: r.ignoredStatus as IgnorableEnvironmentStatus } : {}),
  };
};

/** One list from the two stored parts; a machine re-paired with a key-bound session supersedes its older bearer entry. */
function merged([bearer, keyBound]: readonly [ReadonlyArray<RemoteEnvironmentRecord>, ReadonlyArray<RemoteEnvironmentRecord>]): RemoteEnvironmentRecord[] {
  const bound = keyBound.filter((record) => record.auth === "dpop");
  const ids = new Set(bound.map((record) => record.environmentId));
  return [...bearer.filter((record) => !ids.has(record.environmentId)), ...bound];
}

export class EnvironmentCatalog {
  private readonly secrets: SecretBackend;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(secrets: SecretBackend) {
    this.secrets = secrets;
  }

  /** Re-reads storage on every call; corrupt JSON or malformed entries are dropped. Key-bound records carry their latest renewed token. */
  async list(): Promise<ReadonlyArray<RemoteEnvironmentRecord>> {
    return Promise.all((await this.stored()).map(async (record) => {
      if (record.auth !== "dpop") return record;
      const token = parseToken(await this.secrets.get(tokenKey(record)));
      return token && samePairing(token, record) && token.expiresAt > (record.expiresAt ?? 0) ? { ...record, accessToken: token.accessToken, expiresAt: token.expiresAt } : record;
    }));
  }

  /** The catalog as stored (bearer and key-bound parts), without renewed tokens, which never go back into it. */
  private async stored(): Promise<ReadonlyArray<RemoteEnvironmentRecord>> { return merged(await this.parts()); }
  private parts(): Promise<[RemoteEnvironmentRecord[], RemoteEnvironmentRecord[]]> {
    return Promise.all([this.readPart(ENVIRONMENT_CATALOG_KEY), this.readPart(KEY_BOUND_CATALOG_KEY)]);
  }
  private async readPart(key: string): Promise<RemoteEnvironmentRecord[]> {
    const raw = await this.secrets.get(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { environments?: unknown } | null;
      if (!parsed || !Array.isArray(parsed.environments)) return [];
      const seen = new Set<string>();
      const out: RemoteEnvironmentRecord[] = [];
      for (const entry of parsed.environments) {
        const record = parseRecord(entry);
        if (record && !seen.has(record.environmentId)) { seen.add(record.environmentId); out.push(record); }
      }
      return out;
    } catch {
      return [];
    }
  }

  async upsert(record: RemoteEnvironmentRecord): Promise<void> {
    let replaced: RemoteEnvironmentRecord | undefined;
    await this.mutate((all) => {
      replaced = all.find((e) => e.environmentId === record.environmentId);
      return replaced ? all.map((e) => (e.environmentId === record.environmentId ? record : e)) : [...all, record];
    });
    // A new pairing of the machine leaves the previous pairing's renewed token behind.
    const previous = replaced as RemoteEnvironmentRecord | undefined;
    if (previous && pairingId(previous) !== pairingId(record)) await this.secrets.delete(tokenKey(previous));
  }

  async remove(environmentId: string): Promise<void> {
    let removed: RemoteEnvironmentRecord | undefined;
    await this.mutate((all) => { removed = all.find((e) => e.environmentId === environmentId); return all.filter((e) => e.environmentId !== environmentId); });
    const record = removed as RemoteEnvironmentRecord | undefined;
    if (record) await this.secrets.delete(tokenKey(record));
  }

  /** Removes a pairing only while it still holds `accessToken`, so a fresh re-pair from another window survives. */
  async removeIfToken(environmentId: string, accessToken: string): Promise<boolean> {
    let removed = false;
    await this.mutate((all) => {
      const next = all.filter((e) => e.environmentId !== environmentId || e.accessToken !== accessToken);
      removed = next.length !== all.length;
      return next;
    });
    return removed;
  }

  /**
   * Stores a renewed key-bound token. Another window may have renewed first; the later expiry wins,
   * and a record that was re-paired or removed meanwhile is left alone.
   */
  async updateToken(previous: Pick<RemoteEnvironmentRecord, "environmentId" | "accessToken" | "addedAt" | "httpBaseUrl" | "dpopKey">, next: { readonly accessToken: string; readonly expiresAt: number }): Promise<RemoteEnvironmentRecord | null> {
    const run = this.queue.then(async () => {
      // Only the same pairing: a renewal of the old session must not replace a fresh re-pairing,
      // and a machine that was removed is not stored again.
      const record = (await this.list()).find((e) => e.environmentId === previous.environmentId && e.auth === "dpop" && sameRecordPairing(e, previous));
      if (!record) return null;
      // Another window already stored a later token for this session.
      if (record.accessToken !== previous.accessToken && (record.expiresAt ?? 0) >= next.expiresAt) return record;
      await this.secrets.store(tokenKey(record), JSON.stringify({ addedAt: record.addedAt, pairing: pairingId(record), httpBaseUrl: record.httpBaseUrl, accessToken: next.accessToken, expiresAt: next.expiresAt }));
      return { ...record, accessToken: next.accessToken, expiresAt: next.expiresAt };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  setEnabled(environmentId: string, enabled: boolean): Promise<void> {
    return this.mutate((all) => all.map((e) => (e.environmentId === environmentId ? { ...e, enabled } : e)));
  }

  setIgnored(environmentId: string, status: IgnorableEnvironmentStatus | null): Promise<void> {
    return this.mutate((all) => all.map((e) => {
      if (e.environmentId !== environmentId) return e;
      const { ignoredStatus: _previous, ...rest } = e;
      return status ? { ...rest, ignoredStatus: status } : rest;
    }));
  }

  /** Fires for the catalog and stored renewed tokens only; VS Code also fires it for other windows/profiles. */
  onDidChange(listener: () => void): { dispose(): void } {
    const sub = this.secrets.onDidChange((event) => { if (event.key === ENVIRONMENT_CATALOG_KEY || event.key === KEY_BOUND_CATALOG_KEY || event.key.startsWith(ENVIRONMENT_TOKEN_KEY_PREFIX)) listener(); });
    return { dispose: () => { sub.dispose(); } };
  }

  /** Serialized within the process; each run starts from a fresh read. */
  private mutate(change: (all: ReadonlyArray<RemoteEnvironmentRecord>) => ReadonlyArray<RemoteEnvironmentRecord>): Promise<void> {
    const run = this.queue.then(async () => {
      const [bearer, keyBound] = await this.parts();
      const next = change(merged([bearer, keyBound]));
      // Each part is written only when it differs from what is stored (a renewal another window already
      // stored, say), so idle writes never race other windows; key-bound pairings never go into v1, and a
      // bearer entry a key-bound pairing replaced leaves v1 with the next write.
      const parts: ReadonlyArray<readonly [string, RemoteEnvironmentRecord[], RemoteEnvironmentRecord[]]> = [
        [ENVIRONMENT_CATALOG_KEY, bearer, next.filter((record) => record.auth !== "dpop")],
        [KEY_BOUND_CATALOG_KEY, keyBound, next.filter((record) => record.auth === "dpop")],
      ];
      for (const [key, stored, wanted] of parts) {
        if (JSON.stringify(stored) === JSON.stringify(wanted)) continue;
        await this.secrets.store(key, JSON.stringify({ version: 1, environments: wanted }));
      }
    });
    this.queue = run.catch(() => undefined); // a failed write must not wedge later mutations
    return run;
  }
}

/** Short user-facing failure; never carries the token or link. */
export class EnvironmentPairingError extends Error {
  constructor(message: string) { super(message); this.name = "EnvironmentPairingError"; }
}

export interface RemoteDescriptor {
  readonly environmentId: string;
  readonly label: string;
  readonly serverVersion?: string;
  readonly orchestrationProtocolVersion?: number;
  /** The machine renews key-bound sessions (`accessTokenRenewal`, T3 Code 0.1.11+). */
  readonly accessTokenRenewal?: boolean;
}

export interface RemoteBearerSession {
  readonly access_token: string;
  readonly expires_in: number;
  readonly scope?: string;
  /** A key-bound session's signing key, to store with the pairing. */
  readonly dpopKey?: StoredDeviceKey;
}

export interface EnvironmentPairingDeps {
  readonly fetchDescriptor: (httpBaseUrl: string) => Promise<RemoteDescriptor>;
  readonly bootstrap: (input: { httpBaseUrl: string; credential: string }) => Promise<RemoteBearerSession>;
  /** Exchanges the link for a session bound to this device's key; absent where no key is available. */
  readonly bootstrapDpop?: (input: { httpBaseUrl: string; credential: string }) => Promise<RemoteBearerSession>;
  readonly now: () => number;
}

const runWithFetch = <A, E>(effect: Effect.Effect<A, E, never> | Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect as Effect.Effect<A, E, any>, FetchHttpClient.layer) as Effect.Effect<A, E>);

const defaultDeps: EnvironmentPairingDeps = {
  fetchDescriptor: (httpBaseUrl) =>
    runWithFetch(RemoteEnvironment.fetchRemoteEnvironmentDescriptor({ httpBaseUrl, timeoutMs: 10_000 })).then((descriptor) => ({
      environmentId: descriptor.environmentId, label: descriptor.label,
      ...(descriptor.serverVersion ? { serverVersion: descriptor.serverVersion } : {}),
      ...(descriptor.orchestrationProtocolVersion !== undefined ? { orchestrationProtocolVersion: descriptor.orchestrationProtocolVersion } : {}),
      ...(descriptor.capabilities.accessTokenRenewal === true ? { accessTokenRenewal: true } : {}),
    })),
  bootstrap: ({ httpBaseUrl, credential }) =>
    runWithFetch(RemoteAuth.bootstrapRemoteBearerSession({
      httpBaseUrl, credential, clientMetadata: { label: "VS Code", deviceType: "desktop" },
    })),
  now: Date.now,
};

/** Finds an HTTP status / error tag anywhere in an error's cause chain. */
const classify = (error: unknown): { status?: number; tag?: string; dpopFailureReason?: string } => {
  const found: { status?: number; tag?: string; dpopFailureReason?: string } = {};
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== "object" || value === null || seen.has(value) || depth > 6) return;
    seen.add(value);
    const v = value as { status?: unknown; _tag?: unknown; error?: unknown; cause?: unknown; dpopFailureReason?: unknown };
    if (found.status === undefined && typeof v.status === "number") found.status = v.status;
    if (found.dpopFailureReason === undefined && typeof v.dpopFailureReason === "string") found.dpopFailureReason = v.dpopFailureReason;
    if (found.tag === undefined && typeof v._tag === "string") found.tag = v._tag;
    visit(v.error, depth + 1);
    visit(v.cause, depth + 1);
  };
  visit(error, 0);
  return found;
};

const AUTH_TAGS = new Set(["EnvironmentAuthInvalidError", "EnvironmentScopeRequiredError", "EnvironmentOperationForbiddenError"]);

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

/**
 * Pair with a remote T3 server from a pairing link and return a ready-to-store
 * record. Throws EnvironmentPairingError with token-free messages.
 */
export async function pairRemoteEnvironment(
  link: string,
  options: { localEnvironmentId?: string; expectedEnvironmentId?: string; deps?: Partial<EnvironmentPairingDeps> } = {},
): Promise<RemoteEnvironmentRecord> {
  const deps: EnvironmentPairingDeps = { ...defaultDeps, ...options.deps };

  let target: ReturnType<typeof resolveRemotePairingTarget>;
  try {
    target = resolveRemotePairingTarget({ pairingUrl: link });
  } catch {
    throw new EnvironmentPairingError("That pairing link is not valid. Create a new link in T3 and paste it again.");
  }
  const base = new URL(target.httpBaseUrl);
  if (base.protocol !== "https:" && !isLoopbackHost(base.hostname)) {
    throw new EnvironmentPairingError("Use an https pairing link; plain http would send the token unencrypted.");
  }

  let descriptor: RemoteDescriptor;
  try {
    descriptor = await deps.fetchDescriptor(target.httpBaseUrl);
  } catch {
    throw new EnvironmentPairingError(`Could not reach a T3 server at ${base.host}. Check the link and that the server is running.`);
  }
  if (descriptor.orchestrationProtocolVersion !== undefined && descriptor.orchestrationProtocolVersion !== 2) {
    throw new EnvironmentPairingError(`That server speaks orchestration protocol ${descriptor.orchestrationProtocolVersion}; this extension requires protocol 2.`);
  }
  if (options.localEnvironmentId && descriptor.environmentId === options.localEnvironmentId) {
    throw new EnvironmentPairingError("This link is for the local T3 server, which is already connected.");
  }
  // Checked before signing in, so no session is left on a machine other than the one being completed.
  if (options.expectedEnvironmentId && descriptor.environmentId !== options.expectedEnvironmentId) {
    throw new EnvironmentPairingError("That address is a different T3 machine.");
  }

  let session: RemoteBearerSession;
  // A machine that renews sessions binds this one to the device key, so it never needs pairing
  // again while it is used; an older machine keeps the fixed 30-day bearer session.
  const keyBound = descriptor.accessTokenRenewal === true && deps.bootstrapDpop !== undefined;
  try {
    session = await (keyBound ? deps.bootstrapDpop! : deps.bootstrap)({ httpBaseUrl: target.httpBaseUrl, credential: target.credential });
  } catch (cause) {
    const { status, tag, dpopFailureReason } = classify(cause);
    // A refused proof is not a bad link: a new link would fail the same way.
    if (keyBound && dpopFailureReason === "time_window") throw new EnvironmentPairingError("This computer's clock is too far from that machine's. Correct the clock and pair again.");
    if (keyBound && dpopFailureReason === "request_mismatch") throw new EnvironmentPairingError(`Something in front of ${base.host} changes the address of each request, so its sign-in check fails. Pair with its direct address or fix the proxy.`);
    if (status === 401 || status === 403 || (tag !== undefined && AUTH_TAGS.has(tag))) {
      throw new EnvironmentPairingError("The pairing link was rejected; it may be expired or already used. Create a new link in T3.");
    }
    throw new EnvironmentPairingError(`Could not complete pairing with ${base.host}. Check the link and try again.`);
  }
  if (keyBound && !session.dpopKey) throw new EnvironmentPairingError(`Could not complete pairing with ${base.host}. Check the link and try again.`);

  return {
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    httpBaseUrl: target.httpBaseUrl,
    wsBaseUrl: target.wsBaseUrl,
    accessToken: session.access_token,
    expiresAt: deps.now() + session.expires_in * 1000,
    ...(keyBound ? { auth: "dpop" as const, dpopKey: session.dpopKey! } : {}),
    scopes: session.scope?.split(" ").filter((s) => s.length > 0) ?? [],
    enabled: true,
    addedAt: new Date(deps.now()).toISOString(),
    ...(descriptor.serverVersion ? { serverVersion: descriptor.serverVersion } : {}),
  };
}
