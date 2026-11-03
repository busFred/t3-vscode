import type { HostStateSnapshot, TranscriptItem } from "./bridge.js";

/**
 * Rows a webview already holds travel as keys only. Long threads otherwise repost every row on each
 * state change, which blocked the extension host long enough to drop the T3 connection.
 */
export interface TranscriptPatch { readonly keys: ReadonlyArray<string>; readonly rows: ReadonlyArray<TranscriptItem> }
export type WireState = Omit<HostStateSnapshot, "transcript"> & ({ readonly transcript: ReadonlyArray<TranscriptItem> } | { readonly transcriptPatch: TranscriptPatch });

export function isWireState(value: unknown): value is WireState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.revision === "number" && typeof state.phase === "string" && (Array.isArray(state.transcript) || !!state.transcriptPatch && typeof state.transcriptPatch === "object");
}

/** Host side, one per webview. States must be encoded in the order they are posted. */
export class TranscriptEncoder {
  private sent: ReadonlyMap<string, TranscriptItem> | null = null;
  /** The next state is sent whole, e.g. for a webview that has just (re)loaded. */
  reset(): void { this.sent = null; }
  encode(state: HostStateSnapshot): WireState {
    const sent = this.sent;
    this.sent = new Map(state.transcript.map((row) => [row.key, row]));
    if (!sent) return state;
    const { transcript, ...rest } = state;
    return { ...rest, transcriptPatch: { keys: transcript.map((row) => row.key), rows: transcript.filter((row) => sent.get(row.key) !== row) } };
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
  private rows: ReadonlyMap<string, TranscriptItem> = new Map();
  private threads: ReadonlyMap<string, HostStateSnapshot["threads"][number]> = new Map();
  private previousThreads: HostStateSnapshot["threads"] = [];
  /** `complete` is false when a patch names a row this webview never received; request a whole state then. */
  decode(state: WireState): { state: HostStateSnapshot; complete: boolean } {
    const decoded = this.decodeTranscript(state);
    if (!Array.isArray(decoded.state.threads)) return decoded;
    return { ...decoded, state: { ...decoded.state, threads: this.shareThreads(decoded.state.threads) } };
  }
  /** Unchanged thread summaries keep their identity across pushes so memoized session rows skip re-rendering. */
  private shareThreads(threads: HostStateSnapshot["threads"]): HostStateSnapshot["threads"] {
    const shared = threads.map((thread) => shareStructure(this.threads.get(thread.id), thread));
    const result = shared.length === this.previousThreads.length && shared.every((thread, index) => thread === this.previousThreads[index]) ? this.previousThreads : shared;
    this.threads = new Map(result.map((thread) => [thread.id, thread]));
    this.previousThreads = result;
    return result;
  }
  private decodeTranscript(state: WireState): { state: HostStateSnapshot; complete: boolean } {
    if (!("transcriptPatch" in state)) { this.rows = new Map(state.transcript.map((row) => [row.key, row])); return { state, complete: true }; }
    const { transcriptPatch, ...rest } = state;
    const changed = new Map(transcriptPatch.rows.map((row) => [row.key, row]));
    const transcript = transcriptPatch.keys.flatMap((key) => { const row = changed.get(key) ?? this.rows.get(key); return row ? [row] : []; });
    this.rows = new Map(transcript.map((row) => [row.key, row]));
    return { state: { ...rest, transcript }, complete: transcript.length === transcriptPatch.keys.length };
  }
}
