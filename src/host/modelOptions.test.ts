import test from "node:test";
import assert from "node:assert/strict";
import { ProviderInstanceId } from "@t3tools/contracts";
import { FakeTransport, harness, provider } from "./testing/fakeTransport.js";
import type { FavoriteModel } from "../shared/bridge.js";

const effortModel = { slug: "reasoner", name: "Reasoner", isCustom: true, capabilities: { optionDescriptors: [
  { id: "reasoningEffort", label: "Effort", type: "select" as const, options: [{ id: "low", label: "Low" }, { id: "max", label: "Max", isDefault: true }] },
  { id: "fastMode", label: "Fast", type: "boolean" as const },
] } };
function transport() {
  const client = new FakeTransport(); client.config = { providers: [{ ...provider, requiresNewThreadForModelChange: true, models: [...provider.models, effortModel] }] }; return client;
}
test("Draft effort preserves other model options and is carried to the first message, without changing other views", async (t) => {
  const client = transport(); const { host } = await harness({}, client); t.after(() => host.dispose());
  host.registerView("other-tab");
  await host.setModel(undefined, { instanceId: provider.instanceId, model: "reasoner", options: [{ id: "fastMode", value: true }] });
  const otherDraft = host.snapshot("other-tab").draft;
  await host.setModelOption(undefined, "reasoningEffort", "max");
  assert.deepEqual(host.snapshot().draft.modelSelection?.options, [{ id: "fastMode", value: true }, { id: "reasoningEffort", value: "max" }]);
  assert.deepEqual(host.snapshot("other-tab").draft, otherDraft);
  assert.equal(client.commands.length, 0);
  await host.sendMessage("First message with max effort");
  assert.deepEqual(client.commands.find((command) => command.type === "thread.create")?.modelSelection.options, host.snapshot().draft.modelSelection?.options);
});
test("An existing conversation can change effort on a provider that forbids changing the model", async (t) => {
  const client = transport();
  client.shell = { ...client.shell, threads: client.shell.threads.map((thread) => ({ ...thread, itemCount: 5, modelSelection: { instanceId: provider.instanceId, model: "reasoner", options: [{ id: "fastMode", value: false }] } })) };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  const id = host.snapshot().activeThreadId!;
  await host.setModelOption(id, "reasoningEffort", "low");
  const change = client.commands.findLast((command) => command.type === "thread.model-selection.set");
  assert.equal(change?.threadId, id); assert.equal(change?.modelSelection.model, "reasoner");
  assert.deepEqual(change?.modelSelection.options, [{ id: "fastMode", value: false }, { id: "reasoningEffort", value: "low" }]);
  await assert.rejects(host.setModel(id, { instanceId: provider.instanceId, model: provider.models[0]!.slug }), /new thread/);
});
test("Unsupported efforts, missing options and malformed values cannot reach the server", async (t) => {
  const client = transport(); const { host } = await harness({}, client); t.after(() => host.dispose());
  await host.setModel(undefined, { instanceId: provider.instanceId, model: "reasoner" });
  const draft = host.snapshot().draft;
  for (const [id, value] of [["reasoningEffort", "invented"], ["reasoningEffort", true], ["missing", "max"], ["fastMode", "true"], ["reasoningEffort", { value: "max" }]] as const) {
    await assert.rejects(host.setModelOption(undefined, id, value), /does not support/);
  }
  assert.deepEqual(host.snapshot().draft, draft); assert.equal(client.commands.length, 0);
  await host.setModel(undefined, { instanceId: provider.instanceId, model: provider.models[0]!.slug });
  await assert.rejects(host.setModelOption(undefined, "effort", "max"), /does not support/);
});
test("Favorites persist by provider instance, broadcast to all views and never switch conversations", async (t) => {
  let favorites: ReadonlyArray<FavoriteModel> = [];
  const client = transport(); client.config = { providers: [...client.config.providers, { ...provider, instanceId: ProviderInstanceId.make("other-kimi") }] };
  const options = { favoriteModels: () => favorites, saveFavoriteModels: async (value: ReadonlyArray<FavoriteModel>) => { favorites = value; } };
  const { host } = await harness(options, client); t.after(() => host.dispose()); host.registerView("other-tab");
  const initial = [host.snapshot().activeThreadId, host.snapshot("other-tab").activeThreadId];
  const draft = host.snapshot("other-tab").draft;
  await host.toggleFavoriteModel(provider.instanceId, provider.models[0]!.slug);
  assert.deepEqual(host.snapshot("other-tab").favoriteModels, [{ instanceId: "kimi", model: "kimi-for-coding" }]);
  await host.toggleFavoriteModel("other-kimi", provider.models[0]!.slug);
  await host.toggleFavoriteModel(provider.instanceId, provider.models[0]!.slug);
  assert.deepEqual(favorites, [{ instanceId: "other-kimi", model: "kimi-for-coding" }]);
  await assert.rejects(host.toggleFavoriteModel("missing", "nonexistent"), /not found/);
  assert.deepEqual([host.snapshot().activeThreadId, host.snapshot("other-tab").activeThreadId], initial);
  assert.deepEqual(host.snapshot("other-tab").draft, draft); assert.equal(client.commands.length, 0);
  await host.dispose(); const restarted = await harness(options, transport()); t.after(() => restarted.host.dispose());
  assert.deepEqual(restarted.host.snapshot().favoriteModels, favorites);
});
test("Prompt-injected efforts cannot be dispatched as provider options", async (t) => {
  const client = transport();
  client.config = { providers: [{ ...provider, models: [{ ...effortModel, capabilities: { optionDescriptors: [
    { id: "effort", type: "select", label: "Effort", promptInjectedValues: ["ultrathink"], options: [{ id: "high", label: "High" }, { id: "ultrathink", label: "Ultrathink" }] },
  ] } }] }] };
  const { host } = await harness({}, client); t.after(() => host.dispose());
  await host.setModel(undefined, { instanceId: provider.instanceId, model: effortModel.slug });
  await assert.rejects(host.setModelOption(undefined, "effort", "ultrathink"), /message text/);
  assert.equal(client.commands.length, 0);
  await host.sendMessage("Ultrathink:\nReason about this");
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.text, "Ultrathink:\nReason about this");
  await host.sendMessage("/deploy.prod", host.snapshot().activeThreadId);
  assert.equal(client.commands.findLast((command) => command.type === "message.dispatch")?.text, "/deploy.prod");
});
