import test from "node:test";
import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import { OrchestrationV2AppThread, OrchestrationV2ThreadShell, OrchestrationV2ThreadStreamItem } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";

// T3 0.1.11 links issues to threads: `thread.issue-synced` events carry the updated thread, and
// thread shells carry an optional `issues` array. The extension does not show issues; both must
// still decode and flow through the projection and shell handling without disturbing it.
const NOW = "2026-06-20T00:00:00.000Z";
const issue = {
  tracker: "github", host: "github.com", scope: "acme/widgets", key: "42", projectId: "project-1",
  url: "https://github.com/acme/widgets/issues/42", source: "manual", linkedAt: NOW, displayKey: "#42", title: "Widget crashes",
};
const decodeStream = Schema.decodeUnknownSync(OrchestrationV2ThreadStreamItem as unknown as Schema.Codec<{ kind: string; sequence?: number; eventType?: string }, unknown>);

test("A thread.issue-synced event decodes as a known event and updates the projected thread", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first");
  const base = await client.getThreadProjection("first");
  const encodedThread = Schema.encodeSync(OrchestrationV2AppThread)(base.thread) as unknown as Record<string, unknown>;
  // Schema encoding keeps DateTime objects; the JSON round trip yields the wire's ISO strings.
  const thread = JSON.parse(JSON.stringify({ ...encodedThread, title: "Renamed by issue sync", issues: [{ ...issue, source: "agent" }] }));
  const item = { kind: "event", sequence: 500, event: { id: "event-issue", threadId: "first", occurredAt: NOW, type: "thread.issue-synced", payload: thread } };
  const decoded = decodeStream(item);
  assert.equal(decoded.kind, "event", "a known event type is not downgraded to unknown-event");
  client.threadHandlers.get("first")!(Schema.decodeUnknownSync(OrchestrationV2ThreadStreamItem)(item));
  const projected = host["threads"].get("first")!.projection!.thread;
  assert.equal(projected.title, "Renamed by issue sync");
  assert.equal(projected.issues?.[0]?.key, "42");
  assert.ok(host.snapshot().threads.some((entry) => entry.id === "first"), "the thread stays listed");
});

test("A thread shell with the optional issues field decodes and survives a shell snapshot", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const before = host.snapshot().threads.map((entry) => entry.id).sort();
  const first = client.shell.threads.find((thread) => thread.id === "first")!;
  const encoded = Schema.encodeSync(OrchestrationV2ThreadShell)(first);
  assert.equal(Schema.decodeUnknownSync(OrchestrationV2ThreadShell)({ ...encoded, issues: [issue] }).issues?.length, 1);
  assert.doesNotThrow(() => Schema.decodeUnknownSync(OrchestrationV2ThreadShell)(encoded), "servers without issues still decode");
  const withIssues = Schema.decodeUnknownSync(OrchestrationV2ThreadShell)({ ...encoded, title: "Has issues", issues: [issue] });
  client.shell = { ...client.shell, snapshotSequence: client.shell.snapshotSequence + 1, threads: client.shell.threads.map((thread) => thread.id === "first" ? withIssues : thread) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  const summary = host.snapshot().threads.find((entry) => entry.id === "first")!;
  assert.equal(summary.title, "Has issues");
  assert.deepEqual(host.snapshot().threads.map((entry) => entry.id).sort(), before);
});
