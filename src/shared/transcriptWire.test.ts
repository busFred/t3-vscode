import test from "node:test";
import assert from "node:assert/strict";
import type { HostStateSnapshot, TranscriptItem } from "./bridge.js";
import { isWireState, TranscriptDecoder, TranscriptEncoder } from "./transcriptWire.js";

const row = (key: string, text = key) => ({ key, sourceThreadId: "thread", item: { type: "assistant_message", text }, toolLabel: null, output: null, needsDetail: false }) as unknown as TranscriptItem;
const state = (revision: number, transcript: TranscriptItem[]) => ({ revision, phase: "ready", transcript }) as unknown as HostStateSnapshot;

test("Delivered transcript rows travel as keys and decode to the host's transcript", () => {
  const encoder = new TranscriptEncoder(), decoder = new TranscriptDecoder();
  const a = row("a"), b = row("b"), streaming = row("c", "partial");
  const first = encoder.encode(state(1, [a, b, streaming]));
  assert.ok("transcript" in first);
  assert.deepEqual(decoder.decode(first).state.transcript, [a, b, streaming]);
  const finished = row("c", "final"), older = row("older");
  const second = encoder.encode(state(2, [older, a, b, finished]));
  assert.ok("transcriptPatch" in second && isWireState(second));
  assert.deepEqual(second.transcriptPatch, { keys: ["older", "a", "b", "c"], rows: [older, finished] });
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
