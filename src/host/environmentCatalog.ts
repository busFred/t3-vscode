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
import { FetchHttpClient } from "effect/unstable/http";

export interface RemoteEnvironmentRecord {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly accessToken: string;
  readonly expiresAt: number | null;
  readonly scopes: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly addedAt: string;
  readonly serverVersion?: string;
}

/** Subset of vscode.SecretStorage (keeps this module free of the vscode import). */
export interface SecretBackend {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
  onDidChange(listener: (event: { key: string }) => unknown): { dispose(): unknown };
}

export const ENVIRONMENT_CATALOG_KEY = "t3-vscode.environments.v1";

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
    ...(isString(r.serverVersion) ? { serverVersion: r.serverVersion } : {}),
  };
};

export class EnvironmentCatalog {
  private readonly secrets: SecretBackend;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(secrets: SecretBackend) {
    this.secrets = secrets;
  }

  /** Re-reads storage on every call; corrupt JSON or malformed entries are dropped. */
  async list(): Promise<ReadonlyArray<RemoteEnvironmentRecord>> {
    const raw = await this.secrets.get(ENVIRONMENT_CATALOG_KEY);
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

  upsert(record: RemoteEnvironmentRecord): Promise<void> {
    return this.mutate((all) => {
      const next = all.some((e) => e.environmentId === record.environmentId)
        ? all.map((e) => (e.environmentId === record.environmentId ? record : e))
        : [...all, record];
      return next;
    });
  }

  remove(environmentId: string): Promise<void> {
    return this.mutate((all) => all.filter((e) => e.environmentId !== environmentId));
  }

  setEnabled(environmentId: string, enabled: boolean): Promise<void> {
    return this.mutate((all) => all.map((e) => (e.environmentId === environmentId ? { ...e, enabled } : e)));
  }

  /** Fires for this key only; VS Code also fires it for other windows/profiles. */
  onDidChange(listener: () => void): { dispose(): void } {
    const sub = this.secrets.onDidChange((event) => { if (event.key === ENVIRONMENT_CATALOG_KEY) listener(); });
    return { dispose: () => { sub.dispose(); } };
  }

  /** Serialized within the process; each run starts from a fresh read. */
  private mutate(change: (all: ReadonlyArray<RemoteEnvironmentRecord>) => ReadonlyArray<RemoteEnvironmentRecord>): Promise<void> {
    const run = this.queue.then(async () => {
      const next = change(await this.list());
      await this.secrets.store(ENVIRONMENT_CATALOG_KEY, JSON.stringify({ version: 1, environments: next }));
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
}

export interface RemoteBearerSession {
  readonly access_token: string;
  readonly expires_in: number;
  readonly scope?: string;
}

export interface EnvironmentPairingDeps {
  readonly fetchDescriptor: (httpBaseUrl: string) => Promise<RemoteDescriptor>;
  readonly bootstrap: (input: { httpBaseUrl: string; credential: string }) => Promise<RemoteBearerSession>;
  readonly now: () => number;
}

const runWithFetch = <A, E>(effect: Effect.Effect<A, E, never> | Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect as Effect.Effect<A, E, any>, FetchHttpClient.layer) as Effect.Effect<A, E>);

const defaultDeps: EnvironmentPairingDeps = {
  fetchDescriptor: (httpBaseUrl) =>
    runWithFetch(RemoteEnvironment.fetchRemoteEnvironmentDescriptor({ httpBaseUrl, timeoutMs: 10_000 })),
  bootstrap: ({ httpBaseUrl, credential }) =>
    runWithFetch(RemoteAuth.bootstrapRemoteBearerSession({
      httpBaseUrl, credential, clientMetadata: { label: "VS Code", deviceType: "desktop" },
    })),
  now: Date.now,
};

/** Finds an HTTP status / error tag anywhere in an error's cause chain. */
const classify = (error: unknown): { status?: number; tag?: string } => {
  const found: { status?: number; tag?: string } = {};
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== "object" || value === null || seen.has(value) || depth > 6) return;
    seen.add(value);
    const v = value as { status?: unknown; _tag?: unknown; error?: unknown; cause?: unknown };
    if (found.status === undefined && typeof v.status === "number") found.status = v.status;
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
  options: { localEnvironmentId?: string; deps?: Partial<EnvironmentPairingDeps> } = {},
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

  let session: RemoteBearerSession;
  try {
    session = await deps.bootstrap({ httpBaseUrl: target.httpBaseUrl, credential: target.credential });
  } catch (cause) {
    const { status, tag } = classify(cause);
    if (status === 401 || status === 403 || (tag !== undefined && AUTH_TAGS.has(tag))) {
      throw new EnvironmentPairingError("The pairing link was rejected; it may be expired or already used. Create a new link in T3.");
    }
    throw new EnvironmentPairingError(`Could not complete pairing with ${base.host}. Check the link and try again.`);
  }

  return {
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    httpBaseUrl: target.httpBaseUrl,
    wsBaseUrl: target.wsBaseUrl,
    accessToken: session.access_token,
    expiresAt: deps.now() + session.expires_in * 1000,
    scopes: session.scope?.split(" ").filter((s) => s.length > 0) ?? [],
    enabled: true,
    addedAt: new Date(deps.now()).toISOString(),
    ...(descriptor.serverVersion ? { serverVersion: descriptor.serverVersion } : {}),
  };
}
