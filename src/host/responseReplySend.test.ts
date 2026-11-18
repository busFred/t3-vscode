import test from "node:test";
import assert from "node:assert/strict";
import { RunId } from "@t3tools/contracts";
import { viewsHarness, publishText } from "./testing/fakeTransport.js";
import { responseContextRecord } from "../shared/composerContext.js";

const reply = (threadId: string, text = "The earlier answer.", environmentId = "audit", messageId = "m-1") => responseContextRecord({
  citation: { environmentId, threadId, messageId, text, start: 0, end: text.length, prefix: "", suffix: "" }, itemId: "item-1", subagents: [],
});
const replyText = (record: ReturnType<typeof reply>) => `[${record.label}](t3-context://v1/response/${record.contextId}) Please expand.`;
const onVersion = (client: { config: unknown }, serverVersion: string | undefined) => {
  client.config = { ...(client.config as object), environment: { environmentId: "audit", label: "Audit", capabilities: {}, ...(serverVersion ? { serverVersion } : {}) } };
};

test("A reply is refused on a server that would drop its record, and on an unknown version", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  const record = reply("first");
  for (const version of ["0.1.9", undefined]) {
    onVersion(client, version);
    await assert.rejects(host.sendMessage(replyText(record), "first", "sidebar", "queue", [], [], [record]), /needs T3 Code 0\.1\.10/);
  }
  assert.equal(client.commands.filter((command) => command.type === "message.dispatch").length, 0);
});

test("A reply names a response in the conversation it is sent in, with no more text than the composer captures", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  onVersion(client, "0.1.10-nightly.20261116.4800");
  for (const forged of [reply("second"), reply("first", "x".repeat(301)), reply("first", "The earlier answer.", "elsewhere")]) {
    await assert.rejects(host.sendMessage(replyText(forged), "first", "sidebar", "queue", [], [], [forged]), /conversation it replies to/);
  }
  const own = reply("first");
  await host.sendMessage(replyText(own), "first", "sidebar", "queue", [], [], [own]);
  const sent = client.commands.find((command) => command.type === "message.dispatch");
  assert.ok(sent && "context" in sent && sent.context?.records.some((record) => record.kind === "response" && record.contextId === own.contextId));
});

test("A fork can reply to a response it carried over from its source conversation", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  onVersion(client, "0.1.10");
  host.registerView("fork-tab"); await host.selectThread("first", "fork-tab");
  publishText(client, "first", "Fork this completed reply", 1, { runId: RunId.make("trusted-run") });
  const fork = await host.forkFromResponse("first", "first", "text-first", "fork-tab");
  const carried = host.snapshot("fork-tab").transcript.find((row) => row.item.type === "assistant_message");
  assert.ok(carried && carried.item.type === "assistant_message" && carried.sourceThreadId === "first");
  const record = reply(carried.sourceThreadId, "Fork this completed reply", "audit", carried.item.messageId);
  await host.sendMessage(replyText(record), fork, "fork-tab", "queue", [], [], [record]);
  const sent = client.commands.find((command) => command.type === "message.dispatch" && command.threadId === fork);
  assert.ok(sent && "context" in sent && sent.context?.records.some((entry) => entry.kind === "response" && entry.contextId === record.contextId));
  // A response from a conversation this one does not show is still refused.
  const elsewhere = reply("third", "Not in this fork", "audit", "m-elsewhere");
  await assert.rejects(host.sendMessage(replyText(elsewhere), fork, "fork-tab", "queue", [], [], [elsewhere]), /conversation it replies to/);
});
