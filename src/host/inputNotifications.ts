import type { HostStateSnapshot, ThreadSummary } from "../shared/bridge.js";

/** Shell summaries cover unopened conversations. Ignore reconnect replays and other workspaces. */
export class InputNotificationTracker {
  private readonly seen = new Set<string>();
  update(state: HostStateSnapshot): ReadonlyArray<ThreadSummary> {
    if (state.phase !== "ready" || !state.environment) return [];
    const pending = state.threads.filter((thread) => !thread.archived && thread.pendingRuntimeRequest);
    const keys = new Set(pending.map((thread) => `${state.environment!.environmentId}:${thread.id}:${thread.pendingRuntimeRequest!.id}`));
    const notifications = pending.filter((thread) => {
      const key = `${state.environment!.environmentId}:${thread.id}:${thread.pendingRuntimeRequest!.id}`;
      if (this.seen.has(key)) return false;
      this.seen.add(key);
      return true;
    });
    // Retain every pending request; evict only inactive entries from the reconnect cache.
    if (this.seen.size > 1000) for (const key of this.seen) {
      if (!keys.has(key)) this.seen.delete(key);
      if (this.seen.size <= 1000) break;
    }
    return notifications;
  }
}
