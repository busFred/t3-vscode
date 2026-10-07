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
  host.revealSessionMatch(match.id);
  assert.equal(host.snapshot().transcript.length, 2); assert.ok(host.snapshot().transcript.some((entry) => entry.key === match.rowKey));
  assert.equal(host.snapshot("other").activeThreadId, "second");
  assert.throws(() => host.searchSession("second", options), /Open this conversation/);
  publishText(client, "first", "Latest rate rate rate", 3);
  await until(() => host.snapshot().sessionSearch?.total === 4);
  assert.equal(host.snapshot().sessionSearch!.matches[0]!.rowKey, match.rowKey, "Streaming updates preserve earlier search results");
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
