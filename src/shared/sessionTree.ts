import type { ThreadSummary, WireTurnItem } from "./bridge.js";

export interface SessionTreeNode { readonly thread: ThreadSummary; readonly children: SessionTreeNode[] }

/** Search retains matching sessions and their ancestors; ordinary forks remain roots. */
export function sessionTree(threads: ReadonlyArray<ThreadSummary>, matches: ReadonlyArray<ThreadSummary> = threads): SessionTreeNode[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const parentOf = (thread: ThreadSummary): ThreadSummary | undefined => {
    const parent = thread.relationshipToParent === "subagent" && thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined;
    return parent && parent.id !== thread.id && parent.projectId === thread.projectId ? parent : undefined;
  };
  const retained = new Set<string>();
  for (const match of matches) {
    let thread: ThreadSummary | undefined = byId.get(match.id);
    const seen = new Set<string>();
    while (thread && !seen.has(thread.id)) { seen.add(thread.id); retained.add(thread.id); thread = parentOf(thread); }
  }
  const ordered = threads.filter((thread) => retained.has(thread.id)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const nodes = new Map(ordered.map((thread) => [thread.id, { thread, children: [] as SessionTreeNode[] }]));
  const roots: SessionTreeNode[] = [];
  for (const thread of ordered) {
    const node = nodes.get(thread.id)!;
    const parent = parentOf(thread);
    // Corrupt lineage must never hide sessions or create a recursive render loop.
    let ancestor = parent; const seen = new Set([thread.id]); let cyclic = false;
    while (ancestor) { if (seen.has(ancestor.id)) { cyclic = true; break; } seen.add(ancestor.id); ancestor = parentOf(ancestor); }
    const parentNode = !cyclic && parent ? nodes.get(parent.id) : undefined;
    if (parentNode) parentNode.children.push(node); else roots.push(node);
  }
  return roots;
}

export function subagentStatus(item: Extract<WireTurnItem, { type: "subagent" }>, child?: ThreadSummary): string {
  if (child?.pendingRuntimeRequest) return "input";
  // Parent task results can stay completed while the child works on a follow-up.
  if (child?.activityRunStatus) return child.activityRunStatus;
  if (child && ["preparing", "running", "starting", "waiting"].includes(child.status)) return child.status;
  return item.status;
}

export function subagentElapsed(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}
