import test from "node:test";
import assert from "node:assert/strict";
import { ProviderInstanceId } from "@t3tools/contracts";
import { FakeTransport, harness, provider } from "./testing/fakeTransport.js";
import type { ModelPickerPreferences } from "../shared/modelPreferences.js";

function fixture() {
  const client = new FakeTransport();
  const models = [...provider.models, { slug: "luna", name: "Luna", isCustom: false, capabilities: null }, { slug: "terra", name: "Terra", isCustom: false, isLegacy: true, capabilities: null }];
  client.config = { providers: [{ ...provider, models }, { ...provider, instanceId: ProviderInstanceId.make("other-kimi"), models }] };
  let preferences: ModelPickerPreferences = { favoriteModels: [{ instanceId: "other-kimi", model: "luna" }], providerModelPreferences: {} };
  const options = { modelPreferences: () => preferences, saveModelPreferences: async (value: ModelPickerPreferences) => { preferences = value; } };
  return { client, options };
}
test("Local model preferences persist and broadcast without changing conversations or catalogs", async (t) => {
  const { client, options } = fixture(); const { host } = await harness(options, client); t.after(() => host.dispose());
  host.registerView("other-tab");
  const initial = host.snapshot(); const other = host.snapshot("other-tab");
  await host.toggleFavoriteModel("kimi", "terra");
  await host.setModelVisibility("kimi", provider.models[0]!.slug, false);
  await host.setModelVisibility("kimi", "terra", true);
  await host.moveModel("kimi", "luna", "up");
  const snapshot = host.snapshot("other-tab");
  assert.deepEqual(snapshot.favoriteModels, [{ instanceId: "other-kimi", model: "luna" }, { instanceId: "kimi", model: "terra" }]);
  assert.deepEqual(snapshot.providerModelPreferences, options.modelPreferences().providerModelPreferences);
  assert.deepEqual(snapshot.providers, initial.providers);
  assert.deepEqual(snapshot.draft, other.draft); assert.deepEqual(host.snapshot().threads, initial.threads);
  assert.equal(client.commands.length, 0);
  const restarted = await harness(options, client); t.after(() => restarted.host.dispose());
  assert.deepEqual(restarted.host.snapshot().providerModelPreferences, snapshot.providerModelPreferences);
  assert.deepEqual(restarted.host.snapshot().favoriteModels, snapshot.favoriteModels);
});
test("Visibility, ordering and favorites serialize independent updates by provider instance", async (t) => {
  const { client, options } = fixture(); const { host } = await harness(options, client); t.after(() => host.dispose());
  await Promise.all([host.setModelVisibility("kimi", provider.models[0]!.slug, false), host.moveModel("kimi", "luna", "up"), host.toggleFavoriteModel("kimi", "luna")]);
  assert.deepEqual(host.snapshot().providerModelPreferences?.kimi, { hiddenModels: ["terra", provider.models[0]!.slug], modelOrder: ["luna", provider.models[0]!.slug, "terra"] });
  assert.deepEqual(host.snapshot().favoriteModels, [{ instanceId: "other-kimi", model: "luna" }, { instanceId: "kimi", model: "luna" }]);
  assert.equal(host.snapshot().providerModelPreferences?.["other-kimi"], undefined);
  await host.setModelVisibility("kimi", "terra", true);
  assert.deepEqual(host.snapshot().providerModelPreferences?.kimi?.hiddenModels, [provider.models[0]!.slug]);
  await host.moveModel("kimi", "luna", "up"); // Boundary move is a no-op.
  assert.equal(host.snapshot().providerModelPreferences?.kimi?.modelOrder[0], "luna");
  for (const action of [host.setModelVisibility("missing", "luna", false), host.setModelVisibility("kimi", "missing", false),
    host.setModelVisibility("kimi", "luna", "false"), host.moveModel("kimi", "luna", "sideways")]) await assert.rejects(action);
  assert.equal(client.commands.length, 0);
});
test("Failed preference persistence preserves the prior display settings and favorites", async (t) => {
  const { client, options } = fixture(); const initial = options.modelPreferences();
  const { host } = await harness({ ...options, saveModelPreferences: async () => { throw new Error("Disk full"); } }, client); t.after(() => host.dispose());
  await assert.rejects(host.setModelVisibility("kimi", provider.models[0]!.slug, false), /Disk full/);
  assert.deepEqual(host.snapshot().favoriteModels, initial.favoriteModels);
  assert.deepEqual(host.snapshot().providerModelPreferences, initial.providerModelPreferences);
});

test("Providers named constructor can update visibility and ordering without inherited preferences", async (t) => {
  const { client, options } = fixture();
  client.config = { providers: [...client.config.providers, { ...client.config.providers[0]!, instanceId: ProviderInstanceId.make("constructor") }] };
  const { host } = await harness(options, client); t.after(() => host.dispose());
  await host.setModelVisibility("constructor", "terra", true);
  await host.moveModel("constructor", "terra", "up");
  const own = host.snapshot().providerModelPreferences!;
  assert.equal(Object.hasOwn(own, "constructor"), true);
  assert.deepEqual(own.constructor, { hiddenModels: [], modelOrder: [provider.models[0]!.slug, "terra", "luna"] });
});
