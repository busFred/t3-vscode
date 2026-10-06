import test from "node:test";
import assert from "node:assert/strict";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { viewsHarness } from "./testing/fakeTransport.js";
import { searchThreads } from "../shared/composerSuggestions.js";

test("Message search preserves workspace scope and finds threads whose titles do not match", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  client.searchMatches = { matches: ["first", "outside-thread"].map((id) => ({ threadId: ThreadId.make(id), projectId: ProjectId.make("project-v2"), source: "assistant", snippet: "Switch the model here", messageCreatedAt: null })) };
  const hits = await host.searchThreads(" model ");
  assert.deepEqual(hits.map((hit) => hit.threadId), ["first"]); assert.deepEqual(client.searches, ["model"]);
  assert.deepEqual(searchThreads(host.snapshot().threads, "model", new Set(hits.map((hit) => hit.threadId))).map((thread) => thread.id), ["first"]);
  await host.searchThreads("m"); assert.equal(client.searches.length, 1);
  await assert.rejects(host.searchThreads("x".repeat(201)), /200 characters/);
});
test("Settled and archived are independent durable states and settling does not switch other tabs", async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose()); host.registerView("tab"); await host.selectThread("second", "tab");
  await host.threadAction("first", "settle");
  let first = host.snapshot().threads.find((thread) => thread.id === "first")!;
  assert.equal(first.settled, true); assert.equal(first.archived, false); assert.equal(host.snapshot("tab").activeThreadId, "second");
  await host.threadAction("first", "archive"); first = host.snapshot().threads.find((thread) => thread.id === "first")!;
  assert.equal(first.archived, true); assert.equal(first.settled, true);
  await host.threadAction("first", "unarchive"); await host.threadAction("first", "unsettle");
  first = host.snapshot().threads.find((thread) => thread.id === "first")!; assert.equal(first.archived, false); assert.equal(first.settled, false);
});
test("Composer commands and files come from the chosen provider and host-owned conversation directory", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const provider = client.config.providers[0]!;
  client.config = { providers: [{ ...provider, slashCommands: [{ name: "wrong-global" }], skills: [], workspaceSnapshots: [{ cwd: "/tmp/t3-vscode", checkedAt: "2026-10-06T00:00:00Z", slashCommands: [{ name: "compact", description: "Summarize this conversation" }], skills: [
    { name: "Review", path: "/tmp/t3-vscode/.agents/skills/review", enabled: true, description: "Review code changes" },
    { name: "Hidden", path: "/tmp/hidden", enabled: true, userInvocable: false },
  ] }] }] };
  const commands = await host.composerSuggestions("slash-command", "", true);
  assert.ok(commands.some((item) => item.label === "/compact")); assert.ok(commands.some((item) => item.label === "/usage-limits"));
  assert.ok(commands.some((item) => item.value === "$Review ")); assert.ok(!commands.some((item) => /Hidden|wrong-global/.test(item.label)));
  assert.ok(!(await host.composerSuggestions("slash-command", "compact", false)).some((item) => item.kind === "command"));
  client.pathEntries = { entries: [{ path: "src/example.ts", kind: "file" }], truncated: false };
  const files = await host.composerSuggestions("path", "exam", false);
  assert.equal(files[0]?.value, "src/example.ts"); assert.deepEqual(client.pathSearches, [{ cwd: "/tmp/t3-vscode", query: "exam" }]);
  assert.equal(client.providerRefreshes.length, 0);
});
