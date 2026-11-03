import test from "node:test";
import assert from "node:assert/strict";
import { OrchestrationV2TurnItemJson, TurnItemId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { SessionSearchJob } from "./sessionSearch.js";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";
import type { SessionSearchOptions } from "../shared/sessionSearch.js";
const options: SessionSearchOptions = { query: "rate", caseSensitive: false, wholeWord: false, scope: "messages" };
async function until(check: () => boolean): Promise<void> { for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error("Timed out waiting for search."); }
test("Full-session search scans older pages, keeps other views independent and reveals a result without losing current history", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("other"); await host.selectThread("second", "other"); await host.selectThread("first");
  publishText(client, "first", "Latest rate rate", 1);
  const projection = await client.getThreadProjection("first");
  const latest = projection.visibleTurnItems[0]!;
  if (latest.item.type !== "assistant_message") throw new Error("Expected message fixture");
  const older = { ...latest, sourceItemId: TurnItemId.make("older"), position: 0, item: { ...latest.item, id: TurnItemId.make("older"), type: "assistant_message" as const, text: "Older rate", streaming: false, messageId: "older-message" as never, ordinal: 0 } };
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection, historyCursor: "before", hasMoreHistory: true });
  client.getHistory = async () => ({ snapshotSequence: 2, items: [older], nextCursor: null, hasMoreHistory: false });
  host.searchSession("first", options);
  await until(() => host.snapshot().sessionSearch?.scanning === false);
  const search = host.snapshot().sessionSearch!;
  assert.equal(search.total, 3); assert.equal(host.snapshot("other").sessionSearch, undefined);
  assert.equal(host.snapshot().transcript.length, 1, "Scanning does not flood the visible transcript");
  const match = search.matches.find((entry) => entry.rowKey.endsWith(":older"))!;
  assert.equal(host.sessionSearchPreviews("first", options.query, [match.id])[0]?.text, "Older rate");
  assert.equal(host.snapshot().transcript.length, 1, "Previewing cached search context does not reveal or fetch transcript history");
  assert.throws(() => host.sessionSearchPreviews("first", options.query, [match.id], "other"), /again/);
  assert.throws(() => host.sessionSearchPreviews("first", "different", [match.id]), /again/);
  host.revealSessionMatch(match.id);
  assert.equal(host.snapshot().transcript.length, 2); assert.ok(host.snapshot().transcript.some((entry) => entry.key === match.rowKey));
  assert.equal(host.snapshot("other").activeThreadId, "second");
  assert.throws(() => host.searchSession("second", options), /Open this conversation/);
  publishText(client, "first", "Latest rate rate rate", 3);
  await until(() => host.snapshot().sessionSearch?.total === 4);
  assert.equal(host.snapshot().sessionSearch!.matches[0]!.rowKey, match.rowKey, "Streaming updates preserve earlier search results");
  const updated = host.snapshot().sessionSearch!;
  const latestMatch = updated.matches.find(entry => entry.rowKey !== match.rowKey)!;
  assert.match(host.sessionSearchPreviews("first", options.query, [latestMatch.id])[0]!.text, /rate rate rate/);
  assert.ok(updated.revision! > search.revision!);
});

test("Search display preferences are persisted per host workspace without changing per-view search jobs", async (t) => {
  const saved: unknown[] = [];
  const { host, client } = await viewsHarness({ searchPreferences: { layout: "side", contextLines: 2 }, saveSearchPreferences: async value => { saved.push(value); } });
  t.after(() => host.dispose());
  host.registerView("other"); await host.selectThread("second", "other");
  publishText(client, "first", "rate", 1); host.searchSession("first", options);
  await until(() => host.snapshot().sessionSearch?.scanning === false);
  const original = host.snapshot().sessionSearch;
  await host.setSearchPreferences({ resultsHeight: 380, order: "newest" });
  assert.equal(host.snapshot().sessionSearch, original);
  assert.equal(host.snapshot("other").sessionSearch, undefined);
  assert.equal(host.snapshot("other").activeThreadId, "second");
  assert.deepEqual(host.snapshot("other").searchPreferences, { layout: "side", contextLines: 2, order: "newest", resultsHeight: 380 });
  const restarted = await viewsHarness({ searchPreferences: host.snapshot().searchPreferences! }); t.after(() => restarted.host.dispose());
  assert.deepEqual(restarted.host.snapshot().searchPreferences, saved[0]);
  const independent = await viewsHarness(); t.after(() => independent.host.dispose());
  assert.equal(independent.host.snapshot().searchPreferences?.layout, "above");
});
test("Missing history cursors report incomplete counts", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "rate", 1);
  const projection = await client.getThreadProjection("first");
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection, hasMoreHistory: true });
  host.searchSession("first", options);
  await until(() => host.snapshot().sessionSearch?.scanning === false);
  assert.match(host.snapshot().sessionSearch!.error!, /incomplete/);
});
test("Cancelled searches cannot publish late history or survive a closed view", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView("search"); await host.selectThread("first", "search"); publishText(client, "first", "rate loss", 1);
  const projection = await client.getThreadProjection("first");
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection, historyCursor: "before", hasMoreHistory: true });
  let release!: () => void;
  client.getHistory = async () => { await new Promise<void>((resolve) => { release = resolve; }); return { snapshotSequence: 2, items: [], nextCursor: null, hasMoreHistory: false }; };
  host.searchSession("first", options, "search"); await until(() => !!release);
  host.cancelSessionSearch("search"); release(); await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(host.snapshot("search").sessionSearch, undefined);
  await host.removeView("search"); assert.throws(() => host.revealSessionMatch("old", "search"));
});
test("Streaming updates received during a slow detail fetch are indexed without needing another event", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "rate", 1);
  const original = (await client.getThreadProjection("first")).visibleTurnItems[0]!;
  assert.equal(original.item.type, "assistant_message");
  if (original.item.type !== "assistant_message") throw new Error("Expected message fixture");
  const job = new SessionSearchJob("first", { ...options, scope: "all" }, () => {}); t.after(() => job.cancel());
  let release: (() => void) | undefined;
  await job.scan([original], null, {
    present: (row) => ({ key: `${row.sourceThreadId}:${row.sourceItemId}`, sourceThreadId: row.sourceThreadId,
      item: Schema.encodeSync(OrchestrationV2TurnItemJson)(row.item), toolLabel: null, output: null,
      needsDetail: row.item.type === "assistant_message" && row.item.streaming }),
    history: async () => { throw new Error("No older pages"); },
    detail: async (row) => { await new Promise<void>((resolve) => { release = resolve; }); return row; },
  });
  job.refresh([{ ...original, item: { ...original.item, text: "rate rate", streaming: true } }]);
  await until(() => !!release);
  job.refresh([{ ...original, item: { ...original.item, text: "rate rate rate", streaming: false } }]);
  release!();
  await until(() => job.state.total === 3);
});

test("Plain message filters stream incremental history matches and cancel on change or close", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "Latest rate", 1);
  const projection = await client.getThreadProjection("first"), latest = projection.visibleTurnItems[0]!;
  if (latest.item.type !== "assistant_message") throw new Error("Expected message");
  const older = { ...latest, position: 0, sourceItemId: TurnItemId.make("old-stream"), item: { ...latest.item, id: TurnItemId.make("old-stream"), messageId: "old-message" as never, text: "Old rate" } };
  client.threadHandlers.get("first")!({ kind: "snapshot", snapshotSequence: 2, projection, historyCursor: "before", hasMoreHistory: true });
  let historyCalls = 0;
  client.getHistory = async () => { historyCalls++; return { snapshotSequence: 2, items: [older], nextCursor: null, hasMoreHistory: false }; };
  const plain: SessionSearchOptions = { ...options, scope: "text", sources: ["user", "assistant"] };
  host.searchSession("first", plain);
  await until(() => client.threadSearches.length === 1);
  assert.equal(historyCalls, 0);
  const receive = client.threadSearches[0]![2];
  receive({ snapshotSequence: 2, totalMatches: 1, activeIndex: 0, complete: false, match: { entryId: latest.item.messageId, runId: latest.item.runId, occurrence: 0 } });
  await until(() => host.snapshot().sessionSearch?.matches.length === 1);
  assert.equal(host.snapshot().sessionSearch!.scanning, true);
  receive({ snapshotSequence: 2, totalMatches: 2, activeIndex: 0, match: null, navigation: [
    { entryId: older.item.messageId, runId: older.item.runId, startIndex: 0, count: 1 },
    { entryId: latest.item.messageId, runId: latest.item.runId, startIndex: 1, count: 1 },
  ] });
  await until(() => host.snapshot().sessionSearch?.scanning === false);
  assert.equal(host.snapshot().sessionSearch!.total, 2);
  assert.equal(host.snapshot().transcript.length, 1);
  assert.equal(historyCalls, 1);
  const match = host.snapshot().sessionSearch!.matches[0]!;
  host.revealSessionMatch(match.id);
  assert.ok(host.snapshot().transcript.some(row => row.key === match.rowKey));
  host.searchSession("first", { ...plain, query: "new" });
  await until(() => client.threadSearchStops === 1);
  receive({ snapshotSequence: 2, totalMatches: 100, activeIndex: 0, match: null });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(host.snapshot().sessionSearch!.query, "new");
  assert.equal(host.snapshot().sessionSearch!.total, 0);
  host.cancelSessionSearch(); await until(() => client.threadSearchStops === 2);
});

test("Advanced filters keep the existing local search", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "rate", 1);
  const plain: SessionSearchOptions = { ...options, scope: "text", sources: ["user", "assistant"] };
  for (const patch of [{ caseSensitive: true }, { wholeWord: true }, { content: ["code"] as const }, { sources: ["tools"] as const }, { sources: ["user", "assistant", "tools"] as const }, { query: "r".repeat(201) }]) {
    host.searchSession("first", { ...plain, ...patch });
    await until(() => host.snapshot().sessionSearch?.scanning === false);
  }
  assert.equal(client.threadSearches.length, 0);
});

test("A refreshed stream ignores delayed history failures and stops late subscription handles", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "rate", 1);
  const row = (await client.getThreadProjection("first")).visibleTurnItems[0]!;
  const job = new SessionSearchJob("first", { ...options, scope: "text", sources: ["user", "assistant"] }, () => {});
  t.after(() => job.cancel());
  const handlers: Array<(result: import("@t3tools/contracts").OrchestrationV2SearchThreadResult) => void> = [];
  let rejectHistory!: (cause: Error) => void, releaseFirst!: (stop: () => Promise<void>) => void;
  let firstStops = 0, secondStops = 0;
  const starting = job.stream([row], "older", {
    present: entry => ({ key: `${entry.sourceThreadId}:${entry.sourceItemId}`, sourceThreadId: entry.sourceThreadId,
      item: Schema.encodeSync(OrchestrationV2TurnItemJson)(entry.item), toolLabel: null, output: null, needsDetail: false }),
    history: () => new Promise((_, reject) => { rejectHistory = reject; }), detail: async entry => entry,
  }, async handler => {
    handlers.push(handler);
    if (handlers.length === 1) return new Promise(resolve => { releaseFirst = resolve; });
    return async () => { secondStops++; };
  });
  await until(() => handlers.length === 1);
  handlers[0]!({ snapshotSequence: 1, totalMatches: 1, activeIndex: 0, complete: false, match: { entryId: "missing", runId: null, occurrence: 0 } });
  await until(() => !!rejectHistory);
  job.refresh([{ ...row }]); await until(() => handlers.length === 2);
  rejectHistory(new Error("stale failure"));
  releaseFirst(async () => { firstStops++; }); await starting;
  assert.equal(firstStops, 1, "A late obsolete subscription is stopped immediately");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(job.state.error, undefined);
  job.cancel(); await until(() => secondStops === 1);
});

test("Stream navigation beyond 17 entries retains every rendered-text match", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  publishText(client, "first", "hello **world**", 1);
  const original = (await client.getThreadProjection("first")).visibleTurnItems[0]!;
  if (original.item.type !== "assistant_message") throw new Error("Expected message");
  const item = original.item;
  const rows = Array.from({ length: 18 }, (_, n) => ({ ...original, position: n, sourceItemId: TurnItemId.make(`item-${n}`), item: { ...item, id: TurnItemId.make(`item-${n}`), messageId: `message-${n}` as never } }));
  const job = new SessionSearchJob("first", { ...options, query: "hello world", scope: "text", sources: ["user", "assistant"] }, () => {});
  t.after(() => job.cancel());
  const indices: Array<number | undefined> = [];
  await job.stream(rows, null, {
    present: row => ({ key: `${row.sourceThreadId}:${row.sourceItemId}`, sourceThreadId: row.sourceThreadId,
      item: Schema.encodeSync(OrchestrationV2TurnItemJson)(row.item), toolLabel: null, output: null, needsDetail: false }),
    history: async () => { throw new Error("No history fetch expected"); }, detail: async row => row,
  }, async (handler, _, index) => {
    indices.push(index);
    handler({ snapshotSequence: 1, totalMatches: 18, activeIndex: index ?? 0, match: null,
      navigation: rows.slice(index ?? 0, index === undefined ? 17 : 18).map((row, n) => ({ entryId: row.item.messageId, runId: row.item.runId, startIndex: (index ?? 0) + n, count: 1 })) });
    return async () => {};
  });
  await until(() => job.state.matches.length === 18 && !job.state.scanning);
  assert.deepEqual(indices, [undefined, 17]);
  assert.equal(job.state.total, 18);
  const match = job.state.matches[0]!;
  assert.equal(job.previews([match.id])[0]!.text, "hello world");
});
