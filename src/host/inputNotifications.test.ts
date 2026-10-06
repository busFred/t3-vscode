import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeRequestId } from "@t3tools/contracts";
import { v2Now } from "../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { viewsHarness } from "./testing/fakeTransport.js";
import { InputNotificationTracker } from "./inputNotifications.js";

test("Unopened workspace sessions report input requests, while other projects and reconnect replays stay quiet", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const tracker = new InputNotificationTracker();
  assert.deepEqual(tracker.update(host.snapshot()), []);
  const request = { id: RuntimeRequestId.make("input-one"), kind: "user_input" as const, createdAt: v2Now };
  client.shell = { ...client.shell, threads: client.shell.threads.map((thread) => ["second", "outside-thread"].includes(thread.id) ? { ...thread, pendingRuntimeRequest: request } : thread) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.equal(client.threadHandlers.has("second"), false);
  const state = host.snapshot();
  assert.equal(state.threads.find((thread) => thread.id === "second")?.pendingRuntimeRequest?.id, "input-one");
  assert.deepEqual(tracker.update(state).map((thread) => thread.id), ["second"]);
  assert.deepEqual(tracker.update(state), []);
  await host.reconnect();
  assert.deepEqual(tracker.update(host.snapshot()), []);
  client.shell = { ...client.shell, threads: client.shell.threads.map((thread) => thread.id === "second" ? { ...thread, pendingRuntimeRequest: { ...request, id: RuntimeRequestId.make("input-two") } } : thread) };
  client.shellHandler!({ kind: "snapshot", snapshot: client.shell });
  assert.deepEqual(tracker.update(host.snapshot()).map((thread) => thread.id), ["second"]);
});
