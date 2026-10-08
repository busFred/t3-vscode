import test from "node:test";
import assert from "node:assert/strict";
import { ModelPreferenceStore } from "./modelPreferenceStore.js";
import type { ModelPickerPreferences } from "../shared/modelPreferences.js";
import { harness } from "./testing/fakeTransport.js";

const previous: ModelPickerPreferences = { favoriteModels: [{ instanceId: "kimi", model: "kimi-for-coding" }], providerModelPreferences: {} };
const changed: ModelPickerPreferences = { favoriteModels: [], providerModelPreferences: { kimi: { hiddenModels: ["kimi-for-coding"], modelOrder: [] } } };
function optimisticStorage() {
  const values = new Map<string, unknown>([["favoriteModels", previous.favoriteModels]]);
  return { values, get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key: string, value: unknown) => { values.set(key, value); } };
}
test("Preference storage migrates favorites and exposes an optimistic native write only after success", async () => {
  const storage = optimisticStorage();
  let finish!: () => void;
  const store = new ModelPreferenceStore({ ...storage, update: (key, value) => {
    storage.values.set(key, value); return new Promise<void>((resolve) => { finish = resolve; });
  } });
  assert.deepEqual(store.read(), previous);
  const saving = store.save(changed);
  await Promise.resolve();
  assert.deepEqual(storage.get("modelPickerPreferences"), changed, "Native cache has already advanced");
  assert.deepEqual(store.read(), previous, "Readers retain the confirmed value during the write");
  finish(); await saving;
  assert.deepEqual(store.read(), changed);
  assert.deepEqual(storage.get("favoriteModels"), previous.favoriteModels, "Migration leaves the earlier key intact");
});
test("Rejected native writes restore the optimistic cache and keep confirmed values even when restoration fails", async () => {
  const storage = optimisticStorage();
  const error = new Error("Disk full"); let failing = true;
  const store = new ModelPreferenceStore({ ...storage, update: async (key, value) => {
    storage.values.set(key, value); if (failing) throw error;
  } });
  await assert.rejects(store.save(changed), (cause) => cause === error);
  assert.deepEqual(store.read(), previous);
  assert.deepEqual(storage.get("modelPickerPreferences"), previous);
  failing = false; await store.save(changed);
  assert.deepEqual(store.read(), changed, "A later successful save recovers normally");
});
test("Host preference save failures cannot leak Memento's pending or failed values into any chat", async (t) => {
  const storage = optimisticStorage();
  let rejectWrite!: (cause: Error) => void; let writes = 0;
  const store = new ModelPreferenceStore({ ...storage, update: (key, value) => {
    storage.values.set(key, value);
    return ++writes === 1 ? new Promise<void>((_resolve, reject) => { rejectWrite = reject; }) : Promise.reject(new Error("Rollback also failed"));
  } });
  const { host } = await harness({ modelPreferences: () => store.read(), saveModelPreferences: (value) => store.save(value) }); t.after(() => host.dispose());
  host.registerView("other-tab");
  const saving = host.setModelVisibility("kimi", "kimi-for-coding", false);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(host.snapshot("other-tab").favoriteModels, previous.favoriteModels);
  assert.deepEqual(host.snapshot().providerModelPreferences, {});
  rejectWrite(new Error("Original write failed"));
  await assert.rejects(saving, /Original write failed/);
  assert.deepEqual(host.snapshot().favoriteModels, previous.favoriteModels);
  assert.deepEqual(host.snapshot("other-tab").providerModelPreferences, {});
});
