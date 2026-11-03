import test from "node:test";
import assert from "node:assert/strict";
import { PullRequestUnavailableError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { T3Client } from "./t3Client.js";
import { harness, FakeTransport } from "./testing/fakeTransport.js";
import { BridgeHandler, WebviewRegistry } from "./bridge.js";
import { FakeWebview } from "./testing/fakeWebview.js";
import { pullRequestOperations } from "../shared/pullRequests.js";

test("PR bridge derives references from conversation links and rejects unrelated PRs and operations", async t => {
  const client = new FakeTransport(); const calls: unknown[] = [];
  client.shell = { ...client.shell, threads: client.shell.threads.map(thread => ({ ...thread, pullRequests: [{ host: "github.com", repository: "owner/repo", number: 12, url: "https://github.com/owner/repo/pull/12", source: "manual", linkedAt: "2026-11-01T00:00:00Z", snapshot: null, stack: null }] })) };
  client.pullRequestRequest = async (id, operation, input) => { calls.push([id, operation, input]); return { error: "Sign in", signInRequired: true }; };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  const thread = host.snapshot().threads[0]!;
  const registry = new WebviewRegistry(), view = new FakeWebview(); registry.add("sidebar", view.webview);
  new BridgeHandler(host, registry, async () => {}).attach(view.webview, "sidebar");
  const params = { threadId: thread.id, number: 12, url: "https://github.com/owner/repo/pull/12" };
  assert.deepEqual(await view.request("conversationPullRequest", { ...params, operation: "summary", projectId: "injected" }), { error: "Sign in", signInRequired: true });
  assert.deepEqual(calls[0], [thread.id, "summary", { projectId: thread.projectId, host: "github.com", repository: "owner/repo", number: 12 }]);
  await view.request("conversationPullRequest", { ...params, operation: "signInStart" });
  assert.deepEqual(calls[1], [thread.id, "signInStart", { provider: "github", host: "github.com" }]);
  await view.request("conversationPullRequest", { ...params, operation: "appAccess" });
  assert.deepEqual(calls[2], [thread.id, "appAccess", { provider: "github", host: "github.com", repository: "owner/repo" }]);
  await assert.rejects(host.conversationPullRequest(thread.id, "summary", 99, params.url), /not linked/);
  await assert.rejects(host.conversationPullRequest(thread.id, "merge", 12, params.url), /Unsupported/);
  assert.equal(calls.length, 3);
});

test("PR transport decodes contract inputs and preserves structured authentication failures", async () => {
  const client = new T3Client(); const calls: [string, unknown][] = [];
  const fake = client as unknown as { requireSession: () => unknown; run: (effect: Effect.Effect<unknown, unknown>) => Promise<unknown> };
  fake.requireSession = () => ({ client: new Proxy({}, { get: (_, method) => (input: unknown) => { calls.push([String(method), input]); return Effect.fail(new PullRequestUnavailableError({ reason: "cli-unauthenticated" })); } }) });
  fake.run = effect => Effect.runPromise(effect);
  for (const operation of pullRequestOperations) {
    const input = operation.startsWith("signIn") ? { provider: "github", host: "github.com" } : operation === "appAccess" ? { provider: "github", host: "github.com", repository: "owner/repo" } : { projectId: "p", host: "github.com", repository: "owner/repo", number: 12 };
    const result = await client.pullRequestRequest("thread", operation, input);
    assert.deepEqual(result, { error: "This host has no working credentials.", signInRequired: true });
    assert.equal(calls.at(-1)?.[0], `${operation.startsWith("signIn") || operation === "appAccess" ? "sourceControl" : "pullRequests"}.${operation}`);
  }
  await assert.rejects(client.pullRequestRequest("thread", "summary", { number: -1 }), /projectId|Missing/);
});
