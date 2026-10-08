import type { FavoriteModel } from "../shared/bridge.js";
import type { ModelPickerPreferences } from "../shared/modelPreferences.js";

interface PreferenceStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}
const key = "modelPickerPreferences";

/** VS Code Memento changes its cache before its write resolves; expose only confirmed saves. */
export class ModelPreferenceStore {
  private readonly storage: PreferenceStorage;
  private current: ModelPickerPreferences;
  private chain: Promise<void> = Promise.resolve();
  constructor(storage: PreferenceStorage) {
    this.storage = storage;
    this.current = storage.get<ModelPickerPreferences>(key)
      ?? { favoriteModels: storage.get<ReadonlyArray<FavoriteModel>>("favoriteModels") ?? [], providerModelPreferences: {} };
  }
  read(): ModelPickerPreferences { return this.current; }
  save(preferences: ModelPickerPreferences): Promise<void> {
    const operation = this.chain.then(async () => {
      const previous = this.current;
      try {
        await this.storage.update(key, preferences);
        this.current = preferences;
      } catch (cause) {
        // Restore Memento's optimistic cache as well; even if storage still fails,
        // the confirmed in-memory snapshot remains authoritative until a later save.
        await Promise.resolve().then(() => this.storage.update(key, previous)).catch(() => undefined);
        throw cause;
      }
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }
}
