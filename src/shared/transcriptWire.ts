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

/** Webview side; mirrors the encoder by decoding every state in arrival order. */
export class TranscriptDecoder {
  private rows: ReadonlyMap<string, TranscriptItem> = new Map();
  /** `complete` is false when a patch names a row this webview never received; request a whole state then. */
  decode(state: WireState): { state: HostStateSnapshot; complete: boolean } {
    if (!("transcriptPatch" in state)) { this.rows = new Map(state.transcript.map((row) => [row.key, row])); return { state, complete: true }; }
    const { transcriptPatch, ...rest } = state;
    const changed = new Map(transcriptPatch.rows.map((row) => [row.key, row]));
    const transcript = transcriptPatch.keys.flatMap((key) => { const row = changed.get(key) ?? this.rows.get(key); return row ? [row] : []; });
    this.rows = new Map(transcript.map((row) => [row.key, row]));
    return { state: { ...rest, transcript }, complete: transcript.length === transcriptPatch.keys.length };
  }
}
