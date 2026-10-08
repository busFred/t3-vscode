import type { TaskOrigin } from "../shared/scheduledTasks.js";

/** Extension-owned provenance, separate from the server's mutable result destination. */
export class TaskOriginStore {
  private origins: ReadonlyArray<TaskOrigin>;
  private readonly storage: { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> };
  constructor(storage: TaskOriginStore["storage"]) { this.storage = storage; this.origins = storage.get<ReadonlyArray<TaskOrigin>>("scheduledTaskOrigins") ?? []; }
  read(): ReadonlyArray<TaskOrigin> { return this.origins; }
  async save(origin: TaskOrigin): Promise<void> {
    const next = [...this.origins.filter((item) => item.environmentId !== origin.environmentId || item.projectId !== origin.projectId || item.taskId !== origin.taskId), origin];
    try { await this.storage.update("scheduledTaskOrigins", next); this.origins = next; }
    catch (cause) { await Promise.resolve().then(() => this.storage.update("scheduledTaskOrigins", this.origins)).catch(() => undefined); throw cause; }
  }
}
