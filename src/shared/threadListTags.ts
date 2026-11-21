import type { ThreadSummary } from "./bridge.js";

/** Subagents and remote children inherit the visibility of their session. */
export function filterThreadListTags(threads: ReadonlyArray<ThreadSummary>, tags: ReadonlyArray<string> | ReadonlySet<string> = []): ThreadSummary[] {
  const selected = new Set(tags);
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const visible = (thread: ThreadSummary, seen = new Set<string>()): boolean => {
    if (thread.hiddenByTag) return false;
    if (seen.has(thread.id)) return false;
    seen.add(thread.id);
    // Subagents and side chats follow their parent's tags, as they sit beneath it.
    const candidate = (thread.relationshipToParent === "subagent" || thread.relationshipToParent === "side-chat") && thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined;
    // As in the Sessions tree, a side chat left active under an archived parent stands alone and uses its own tags.
    const parent = candidate && !(thread.relationshipToParent === "side-chat" && !thread.archived && candidate.archived) ? candidate : undefined;
    return parent ? visible(parent, seen) : selected.size === 0 || thread.tags?.some(tag => selected.has(tag)) === true;
  };
  return threads.filter(thread => visible(thread));
}
