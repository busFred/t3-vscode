import type { ThreadSummary } from "./bridge.js";

/** Subagents and remote children inherit the visibility of their session. */
export function filterThreadListTags(threads: ReadonlyArray<ThreadSummary>, tags: ReadonlyArray<string> | ReadonlySet<string> = []): ThreadSummary[] {
  const selected = new Set(tags);
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const visible = (thread: ThreadSummary, seen = new Set<string>()): boolean => {
    if (thread.hiddenByTag) return false;
    if (seen.has(thread.id)) return false;
    seen.add(thread.id);
    const parent = thread.relationshipToParent === "subagent" && thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined;
    return parent ? visible(parent, seen) : selected.size === 0 || thread.tags?.some(tag => selected.has(tag)) === true;
  };
  return threads.filter(thread => visible(thread));
}
