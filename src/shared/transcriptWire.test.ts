import test from "node:test";
import assert from "node:assert/strict";
import type { HostStateSnapshot, TranscriptItem } from "./bridge.js";
import { isWireState, TranscriptDecoder, TranscriptEncoder } from "./transcriptWire.js";

const row = (key: string, text = key) => ({ key, sourceThreadId: "thread", item: { type: "assistant_message", text }, toolLabel: null, output: null, needsDetail: false }) as unknown as TranscriptItem;
const state = (revision: number, transcript: TranscriptItem[]) => ({ revision, phase: "ready", transcript, threads: [] }) as unknown as HostStateSnapshot;

test("Delivered transcript rows travel as keys and decode to the host's transcript", () => {
  const encoder = new TranscriptEncoder(), decoder = new TranscriptDecoder();
  const a = row("a"), b = row("b"), streaming = row("c", "partial");
  const first = encoder.encode(state(1, [a, b, streaming]));
  assert.ok("transcript" in first);
  assert.deepEqual(decoder.decode(first).state.transcript, [a, b, streaming]);
  const finished = row("c", "final"), older = row("older");
  const second = encoder.encode(state(2, [older, a, b, finished]));
  assert.ok("transcriptPatch" in second && isWireState(second));
  assert.deepEqual(second.transcriptPatch, { keys: ["older", "a", "b", "c"], order: 1, rows: [older, finished] });
  assert.deepEqual(decoder.decode(second), { state: state(2, [older, a, b, finished]), complete: true });
});

test("A webview missing rows reports an incomplete state until a whole state arrives", () => {
  const encoder = new TranscriptEncoder(), reloaded = new TranscriptDecoder(), a = row("a"), b = row("b");
  encoder.encode(state(1, [a]));
  const patch = encoder.encode(state(2, [a, b]));
  const partial = reloaded.decode(patch);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.state.transcript.map((item) => item.key), ["b"]);
  encoder.reset();
  const whole = encoder.encode(state(3, [a, b]));
  assert.ok("transcript" in whole);
  assert.equal(reloaded.decode(whole).complete, true);
  assert.equal(isWireState({ revision: 1, phase: "ready" }), false);
});

test("Unchanged thread summaries keep their identity across decoded states", () => {
  const decoder = new TranscriptDecoder();
  const summary = (id: string, title: string) => ({ id, title, tags: ["a"], pullRequests: [{ number: 1 }] });
  const withThreads = (revision: number, threads: unknown[]) => ({ ...state(revision, []), threads }) as unknown as HostStateSnapshot;
  const first = decoder.decode(withThreads(1, [summary("x", "X"), summary("y", "Y")])).state.threads;
  const second = decoder.decode(withThreads(2, [summary("x", "X"), summary("y", "Y")])).state.threads;
  assert.equal(second, first);
  const third = decoder.decode(withThreads(3, [summary("x", "X"), summary("y", "Y renamed")])).state.threads;
  assert.notEqual(third, first);
  assert.equal(third[0], first[0]);
  assert.notEqual(third[1], first[1]);
  assert.equal(third[1]!.tags, first[1]!.tags);
  assert.equal(third[1]!.title, "Y renamed");
  const reordered = decoder.decode(withThreads(4, [third[1], summary("x", "X")])).state.threads;
  assert.equal(reordered[1], first[0]);
});

test("A push that changes no row hands back the same transcript and providers", () => {
  // The view runs several passes over the transcript and keys its memos on that identity, so a
  // fresh copy per push redoes all of them and re-renders rows that did not change.
  const decoder = new TranscriptDecoder();
  const providers = [{ instanceId: "codex", models: [] }] as unknown as HostStateSnapshot["providers"];
  const wire = (extra: object) => ({ revision: 1, phase: "ready", threads: [], providers, ...extra }) as never;
  const first = decoder.decode(wire({ transcript: [row("a", "one"), row("b", "two")] }));
  const second = decoder.decode(wire({ providers: structuredClone(providers), transcriptPatch: { keys: ["a", "b"], rows: [] } }));
  assert.equal(second.state.transcript, first.state.transcript, "unchanged rows keep the array's identity");
  assert.equal(second.state.providers, first.state.providers, "an unchanged catalogue keeps its identity");

  const third = decoder.decode(wire({ transcriptPatch: { keys: ["a", "b"], rows: [row("b", "changed")] } }));
  assert.notEqual(third.state.transcript, second.state.transcript, "a changed row produces a new array");
  assert.equal(third.state.transcript[0], second.state.transcript[0], "while the untouched row keeps its identity");
});

test("Unchanged session summaries travel as ids, and a fresh host object with equal content counts as unchanged", () => {
  const encoder = new TranscriptEncoder(), other = new TranscriptEncoder(), decoder = new TranscriptDecoder();
  const summary = (id: string, title: string) => ({ id, title, tags: ["a"], modelSelection: { instanceId: "codex", model: "m" } });
  const push = (revision: number, threads: unknown[]) => ({ ...state(revision, []), threads }) as unknown as HostStateSnapshot;
  const first = encoder.encode(push(1, [summary("wire-x", "X"), summary("wire-y", "Y")]));
  assert.ok("threads" in first);
  const held = decoder.decode(first).state.threads;
  // The host derives new objects every push; equal content must still go as an id only.
  const second = encoder.encode(push(2, [summary("wire-x", "X"), summary("wire-y", "Y renamed"), summary("wire-z", "Z")]));
  assert.ok("threadsPatch" in second && isWireState(second));
  assert.deepEqual(second.threadsPatch.ids, ["wire-x", "wire-y", "wire-z"]);
  assert.deepEqual(second.threadsPatch.rows.map((thread) => thread.id), ["wire-y", "wire-z"]);
  const decoded = decoder.decode(second);
  assert.equal(decoded.complete, true);
  assert.equal(decoded.state.threads[0], held[0], "an unchanged summary is the very object held before");
  assert.equal(decoded.state.threads[1]!.title, "Y renamed");
  assert.equal(decoded.state.threads[1]!.tags, held[1]!.tags, "unchanged nested values keep identity");
  // Another view's encoder tracks what *it* sent: its first state is whole.
  assert.ok("threads" in other.encode(push(3, [summary("wire-x", "X")])));
  // A webview that never received a summary reports itself incomplete so the host resends whole.
  const reloaded = new TranscriptDecoder();
  assert.equal(reloaded.decode(encoder.encode(push(4, [summary("wire-x", "X"), summary("wire-y", "Y renamed"), summary("wire-z", "Z")]))).complete, false);
});

test("A streaming push with the same row order sends no keys, and only an in-step webview accepts it", () => {
  const encoder = new TranscriptEncoder(), decoder = new TranscriptDecoder();
  const a = row("a"), b = row("b", "partial");
  decoder.decode(encoder.encode(state(1, [a, b])));
  // A whole state names no order, so the first patch after it carries its keys.
  const keyed = encoder.encode(state(2, [a, row("b", "partial and")]));
  assert.ok("transcriptPatch" in keyed && keyed.transcriptPatch.keys?.length === 2);
  assert.equal(decoder.decode(keyed).complete, true);
  const grown = row("b", "partial and more");
  const patch = encoder.encode(state(3, [a, grown]));
  assert.ok("transcriptPatch" in patch);
  assert.deepEqual(patch.transcriptPatch, { length: 2, order: keyed.transcriptPatch.order, rows: [grown] }, "no key list while only a row's content changes");
  const decoded = decoder.decode(patch);
  assert.equal(decoded.complete, true);
  assert.deepEqual(decoded.state.transcript, [a, grown]);
  // A webview that reloaded holds no order to apply it to, so it asks for a whole state.
  assert.equal(new TranscriptDecoder().decode(encoder.encode(state(4, [a, grown]))).complete, false);
});

test("A webview that missed a reorder with the same row count and revision asks for a whole state", () => {
  // A request reply and a push can share a revision, so the order id must not be the revision.
  const encoder = new TranscriptEncoder(), decoder = new TranscriptDecoder();
  const a = row("a"), b = row("b");
  decoder.decode(encoder.encode(state(5, [a, b])));
  assert.equal(decoder.decode(encoder.encode(state(5, [a, b]))).complete, true);
  encoder.encode(state(5, [b, a])); // the reorder this webview never receives
  const next = encoder.encode(state(5, [b, row("a", "edited")]));
  assert.ok("transcriptPatch" in next && !next.transcriptPatch.keys, "the following push omits the order");
  const result = decoder.decode(next);
  assert.equal(result.complete, false, "a stale order must not be patched");
});
