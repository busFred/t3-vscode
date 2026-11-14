import type { HostStateSnapshot, TranscriptItem } from "./bridge.js";

/**
 * Rows a webview already holds travel as keys only. Long threads otherwise repost every row on each
 * state change, which blocked the extension host long enough to drop the T3 connection.
 */
export interface TranscriptPatch {
  /** Row order; omitted when it is the order sent last, which is every push of a streaming reply. */
  readonly keys?: ReadonlyArray<string>;
  /** Row count, sent with an omitted order so a webview that is not in step can tell. */
  readonly length?: number;
  readonly rows: ReadonlyArray<TranscriptItem>;
}
type ThreadSummary = HostStateSnapshot["threads"][number];
/**
 * The session list travels the same way: summaries the webview already holds go as ids only. The
 * whole list was the largest field of every push (hundreds of KB with a few hundred conversations)
 * and nearly always unchanged while a reply streams.
 */
export interface ThreadsPatch { readonly ids: ReadonlyArray<string>; readonly rows: ReadonlyArray<ThreadSummary> }
export type WireState = Omit<HostStateSnapshot, "transcript" | "threads">
  & ({ readonly transcript: ReadonlyArray<TranscriptItem> } | { readonly transcriptPatch: TranscriptPatch })
  & ({ readonly threads: HostStateSnapshot["threads"] } | { readonly threadsPatch: ThreadsPatch });

/**
 * The host derives fresh summary objects every push. Each is compared once with the last equal one
 * for its id, and every view's encoder then compares identities only: all views of one push receive
 * the same objects, so the deep comparison is not repeated per view.
 */
const canonicalById = new Map<string, ThreadSummary>();
const canonicalOf = new WeakMap<ThreadSummary, ThreadSummary>();
function canonicalThread(thread: ThreadSummary): ThreadSummary {
  const cached = canonicalOf.get(thread);
  if (cached) return cached;
  const shared = shareStructure(canonicalById.get(thread.id), thread);
  canonicalById.set(thread.id, shared); canonicalOf.set(thread, shared);
  return shared;
}

export function isWireState(value: unknown): value is WireState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.revision === "number" && typeof state.phase === "string" && (Array.isArray(state.transcript) || !!state.transcriptPatch && typeof state.transcriptPatch === "object")
    && (Array.isArray(state.threads) || !!state.threadsPatch && typeof state.threadsPatch === "object");
}

/** Host side, one per webview. States must be encoded in the order they are posted. */
export class TranscriptEncoder {
  private sent: ReadonlyArray<TranscriptItem> | null = null;
  private sentThreads: ReadonlyMap<string, ThreadSummary> | null = null;
  /** The next state is sent whole, e.g. for a webview that has just (re)loaded. */
  reset(): void { this.sent = null; this.sentThreads = null; }
  encode(state: HostStateSnapshot): WireState {
    const sent = this.sent, sentThreads = this.sentThreads, transcript = state.transcript;
    this.sent = transcript;
    const threads = state.threads.map(canonicalThread);
    this.sentThreads = new Map(threads.map((thread) => [thread.id, thread]));
    if (!sent || !sentThreads) return state;
    // While a reply streams the order is unchanged, so rows compare by position with no index built.
    const sameOrder = transcript.length === sent.length && transcript.every((row, index) => row.key === sent[index]!.key);
    let rows: ReadonlyArray<TranscriptItem>;
    if (sameOrder) rows = transcript.filter((row, index) => row !== sent[index]);
    else { const byKey = new Map(sent.map((row) => [row.key, row])); rows = transcript.filter((row) => byKey.get(row.key) !== row); }
    const { transcript: _transcript, threads: _threads, ...rest } = state;
    return { ...rest,
      transcriptPatch: { ...(sameOrder ? { length: transcript.length } : { keys: transcript.map((row) => row.key) }), rows },
      threadsPatch: { ids: threads.map((thread) => thread.id), rows: threads.filter((thread) => sentThreads.get(thread.id) !== thread) } };
  }
}

/**
 * Returns `previous` when it is structurally equal to `next`; otherwise `next` with every equal
 * nested value replaced by its previous counterpart, so memoized consumers keep identity.
 */
export function shareStructure<T>(previous: unknown, next: T): T {
  if (previous === next) return next;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let same = previous.length === next.length;
    const result = next.map((item, index) => { const shared = shareStructure(previous[index], item); if (shared !== previous[index]) same = false; return shared; });
    return (same ? previous : result) as T;
  }
  if (Array.isArray(previous)) return next;
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let same = keys.length === Object.keys(before).length;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const shared = shareStructure(before[key], after[key]);
    if (shared !== before[key] || !(key in before)) same = false;
    result[key] = shared;
  }
  return (same ? previous : result) as T;
}

/** Webview side; mirrors the encoder by decoding every state in arrival order. */
export class TranscriptDecoder {
  private rows = new Map<string, TranscriptItem>();
  private threads: ReadonlyMap<string, HostStateSnapshot["threads"][number]> = new Map();
  private previousThreads: HostStateSnapshot["threads"] = [];
  private previousTranscript: HostStateSnapshot["transcript"] = [];
  private previousProviders: HostStateSnapshot["providers"] | undefined;
  /** `complete` is false when a patch names a row this webview never received; request a whole state then. */
  decode(state: WireState): { state: HostStateSnapshot; complete: boolean } {
    const threads = this.decodeThreads(state);
    const transcript = this.decodeTranscript(state);
    const decoded = { state: { ...transcript.state, threads: threads.threads }, complete: transcript.complete && threads.complete };
    // `providers` is rebuilt by the host every push, and its identity feeds the contexts that carry
    // subagent status and model names, so a fresh object re-renders every subagent card for nothing.
    if (!Array.isArray(decoded.state.providers)) return decoded;
    const providers = shareStructure(this.previousProviders, decoded.state.providers);
    this.previousProviders = providers;
    return { ...decoded, state: { ...decoded.state, providers } };
  }
  private decodeThreads(state: WireState): { threads: HostStateSnapshot["threads"]; complete: boolean } {
    if (!("threadsPatch" in state)) return { threads: this.shareThreads(state.threads), complete: true };
    // Unchanged summaries are the very objects decoded before; only changed ones are compared.
    const changed = new Map(state.threadsPatch.rows.map((thread) => [thread.id, thread]));
    let complete = true;
    const threads = state.threadsPatch.ids.flatMap((id) => {
      const update = changed.get(id);
      if (update) return [shareStructure(this.threads.get(id), update)];
      const held = this.threads.get(id);
      if (!held) { complete = false; return []; }
      return [held];
    });
    return { threads: this.keepList(threads), complete };
  }
  /** Unchanged thread summaries keep their identity across pushes so memoized session rows skip re-rendering. */
  private shareThreads(threads: HostStateSnapshot["threads"]): HostStateSnapshot["threads"] {
    return this.keepList(threads.map((thread) => shareStructure(this.threads.get(thread.id), thread)));
  }
  private keepList(shared: HostStateSnapshot["threads"]): HostStateSnapshot["threads"] {
    const result = shared.length === this.previousThreads.length && shared.every((thread, index) => thread === this.previousThreads[index]) ? this.previousThreads : shared;
    this.threads = new Map(result.map((thread) => [thread.id, thread]));
    this.previousThreads = result;
    return result;
  }
  private decodeTranscript(wire: WireState): { state: Omit<HostStateSnapshot, "threads">; complete: boolean } {
    const { threads: _threads, threadsPatch: _patch, ...state } = wire as WireState & { threads?: unknown; threadsPatch?: unknown };
    if (!("transcriptPatch" in state)) {
      this.rows = new Map(state.transcript.map((row) => [row.key, row]));
      this.previousTranscript = state.transcript;
      return { state, complete: true };
    }
    const { transcriptPatch, ...rest } = state;
    const previous = this.previousTranscript;
    if (!transcriptPatch.keys) {
      // Same order as last time: swap in the changed rows and leave the rest alone. A webview that
      // does not hold that order (it reloaded, or missed a push) cannot rebuild it and says so.
      const inStep = previous.length === transcriptPatch.length && transcriptPatch.rows.every((row) => this.rows.has(row.key));
      if (!inStep) return { state: { ...rest, transcript: previous }, complete: false };
      if (!transcriptPatch.rows.length) return { state: { ...rest, transcript: previous }, complete: true };
      const changed = new Map(transcriptPatch.rows.map((row) => [row.key, row]));
      const transcript = previous.map((row) => changed.get(row.key) ?? row);
      for (const row of transcriptPatch.rows) this.rows.set(row.key, row);
      this.previousTranscript = transcript;
      return { state: { ...rest, transcript }, complete: true };
    }
    const changed = new Map(transcriptPatch.rows.map((row) => [row.key, row]));
    const built = transcriptPatch.keys.flatMap((key) => { const row = changed.get(key) ?? this.rows.get(key); return row ? [row] : []; });
    // A push that changes no row must hand back the same array: the view runs several passes over
    // the transcript and keys its memos on that identity, so a fresh copy redoes all of them.
    const transcript = built.length === previous.length && built.every((row, index) => row === previous[index]) ? previous : built;
    this.rows = new Map(transcript.map((row) => [row.key, row]));
    this.previousTranscript = transcript;
    return { state: { ...rest, transcript }, complete: transcript.length === transcriptPatch.keys.length };
  }
}
