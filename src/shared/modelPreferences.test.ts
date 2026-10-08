import test from "node:test";
import assert from "node:assert/strict";
import { getProviderModelPreference, orderedProviderModels, parseModelPreferencesImport, visibleProviderModels } from "./modelPreferences.js";

const provider = { models: [
  { slug: "sol", name: "Sol", isCustom: false },
  { slug: "astra", name: "Astra", isCustom: false },
  { slug: "luna", name: "Luna", isCustom: false },
  { slug: "terra", name: "Terra", isCustom: false, isLegacy: true },
  { slug: "custom", name: "Custom", isCustom: true },
].map((model) => ({ ...model, capabilities: null })) };
test("Imported device preferences retain visible legacy/custom models and configured order", () => {
  const preferences = { hiddenModels: ["sol", "missing"], modelOrder: ["luna", "terra", "astra", "sol", "missing"] };
  assert.deepEqual(visibleProviderModels(provider, preferences).map((model) => model.slug), ["luna", "terra", "astra", "custom"]);
  assert.deepEqual(visibleProviderModels(provider, preferences, true).map((model) => model.slug), ["luna", "terra", "astra", "custom"]);
  assert.deepEqual(visibleProviderModels(provider).map((model) => model.slug), ["sol", "astra", "luna", "custom"]);
  assert.equal(visibleProviderModels(provider, undefined, true).length, 5);
  assert.equal(visibleProviderModels(provider, { hiddenModels: provider.models.map((model) => model.slug), modelOrder: [] }, true).length, 0);
  assert.deepEqual(orderedProviderModels(provider, { hiddenModels: [], modelOrder: ["terra", "terra", "luna"] }).map((model) => model.slug), ["terra", "luna", "sol", "astra", "custom"]);
  assert.equal(provider.models[0]?.slug, "sol", "Display sorting must not mutate the server catalog");
});
test("Browser model preference import accepts only its display fields and preserves provider-instance identity", () => {
  assert.deepEqual(parseModelPreferencesImport(JSON.stringify({ favorites: [{ provider: "codex-personal", model: "luna" }],
    providerModelPreferences: { "codex-personal": { hiddenModels: ["sol"], modelOrder: ["luna", "terra"] } },
    providers: { secret: "not imported" }, theme: "dark" })), {
    favoriteModels: [{ instanceId: "codex-personal", model: "luna" }],
    providerModelPreferences: { "codex-personal": { hiddenModels: ["sol"], modelOrder: ["luna", "terra"] } },
  });
  assert.deepEqual(parseModelPreferencesImport('{"favorites":[]}'), { favoriteModels: [] });
  assert.deepEqual(parseModelPreferencesImport('{"providerModelPreferences":{"codex":{}}}'), { providerModelPreferences: { codex: { hiddenModels: [], modelOrder: [] } } });
  for (const input of ["", "null", "{}", "[]", '{"favorites":null}', '{"favorites":[{"provider":"codex","model":""}]}',
    '{"providerModelPreferences":{"codex":{"hiddenModels":[1]}}}', '{"favorites":[]}' + " ".repeat(200_000)]) {
    assert.throws(() => parseModelPreferencesImport(input), /Paste valid T3 Web JSON/);
  }
});

test("Valid provider IDs matching Object property names require an own preference entry", () => {
  for (const instanceId of ["constructor", "toString", "hasOwnProperty"]) {
    assert.equal(getProviderModelPreference({}, instanceId), undefined);
    assert.equal(visibleProviderModels(provider, getProviderModelPreference({}, instanceId)).length, 4);
  }
  const imported = parseModelPreferencesImport('{"providerModelPreferences":{"constructor":{"hiddenModels":["sol"],"modelOrder":["luna"]}}}');
  assert.deepEqual(visibleProviderModels(provider, getProviderModelPreference(imported.providerModelPreferences, "constructor")).map((model) => model.slug), ["luna", "astra", "terra", "custom"]);
});
