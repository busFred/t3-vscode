import type { ThreadSummary, WireTurnItem } from "./bridge.js";
import { compareSessions, type SessionSort } from "./sessionSort.js";

export interface SessionTreeNode { readonly thread: ThreadSummary; readonly children: SessionTreeNode[] }

/** Search retains matching sessions and their ancestors; only ordinary conversations/forks can be roots. */
export function sessionTree(threads: ReadonlyArray<ThreadSummary>, matches: ReadonlyArray<ThreadSummary> = threads, sort: SessionSort = "date-desc"): SessionTreeNode[] {
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
  const ordered = threads.filter((thread) => retained.has(thread.id)).sort((a, b) => compareSessions(a, b, sort));
  const nodes = new Map(ordered.map((thread) => [thread.id, { thread, children: [] as SessionTreeNode[] }]));
  const roots: SessionTreeNode[] = [];
  for (const thread of ordered) {
    const node = nodes.get(thread.id)!;
    const parent = parentOf(thread);
    // Corrupt child lineage must never create a recursive render loop or a standalone subagent row.
    let ancestor = parent; const seen = new Set([thread.id]); let cyclic = false;
    while (ancestor) { if (seen.has(ancestor.id)) { cyclic = true; break; } seen.add(ancestor.id); ancestor = parentOf(ancestor); }
    const parentNode = !cyclic && parent ? nodes.get(parent.id) : undefined;
    if (parentNode) parentNode.children.push(node);
    else if (thread.relationshipToParent !== "subagent") roots.push(node);
  }
  return roots;
}

/** Classify each ordinary conversation once, by its own state, keeping all its children beneath it. */
export function sessionShelves(threads: ReadonlyArray<ThreadSummary>, matches: ReadonlyArray<ThreadSummary> = threads, sort: SessionSort = "date-desc") {
  const roots = sessionTree(threads, matches, sort);
  return {
    active: roots.filter(node => !node.thread.archived && !node.thread.settled),
    settled: roots.filter(node => !node.thread.archived && node.thread.settled),
    archived: roots.filter(node => node.thread.archived),
  };
}

/** The card and the sidebar must agree, so every status either reads as working on both or neither. */
const RUNNING_STATUSES = ["preparing", "running", "starting", "waiting", "in_progress", "pending"];
/**
 * A subagent's own status lags the run its parent drives, so a working child can still read as idle.
 * `activityRunStatus` is the live signal, and the sidebar and the transcript card must agree on it.
 */
export function statusIsWorking(status: string): boolean { return RUNNING_STATUSES.includes(status); }
export function threadIsWorking(thread: Pick<ThreadSummary, "status" | "activityRunStatus">): boolean {
  return statusIsWorking(thread.activityRunStatus ?? "") || statusIsWorking(thread.status);
}

/**
 * A thread whose own run is idle but that still has background work holding its completion
 * (delegated subagents, monitors, or unnamed provider tasks) reads as calm "Waiting", not as
 * actively "Working". `backgroundWork.holdsCompletion` is the server's own roster-derived
 * signal; `waitingOnSubagents` is a descendant-scan fallback (see `withSubagentWorkingState`
 * and the host-side transcript scan) for servers that predate the roster.
 */
export function threadIsWaiting(thread: Pick<ThreadSummary, "status" | "activityRunStatus" | "waitingOnSubagents" | "backgroundWork"> & Partial<Pick<ThreadSummary, "archived" | "settled">>): boolean {
  // A stale roster must not mask an archived or settled thread's own label.
  return !thread.archived && !thread.settled && !threadIsWorking(thread) && (!!thread.backgroundWork?.holdsCompletion || !!thread.waitingOnSubagents);
}

/** A short, human description of what a Waiting thread is still waiting on. */
export function waitingSummary(thread: Pick<ThreadSummary, "backgroundWork">): string {
  const work = thread.backgroundWork;
  if (!work) return "Waiting on subagents";
  const parts: string[] = [];
  if (work.subagents) parts.push(`${work.subagents} subagent${work.subagents === 1 ? "" : "s"}`);
  if (work.monitors) parts.push(`${work.monitors} monitor${work.monitors === 1 ? "" : "s"}`);
  if (work.tasks) parts.push(`${work.tasks} task${work.tasks === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(", ")} running` : "Waiting on subagents";
}

/**
 * The server only reports each thread's own run status, so a parent whose run already
 * completed (or whose steer run just finished) reads as idle while a delegated subagent
 * keeps working underneath it. Scan visible descendants and fold their working state (and
 * earliest start time) back onto every ancestor so the sidebar badge and elapsed timer keep
 * tracking the thread for as long as any of its subagents are still busy.
 */
export function withSubagentWorkingState<T extends Pick<ThreadSummary, "id" | "parentThreadId" | "relationshipToParent" | "archived" | "settled" | "status" | "activityRunStatus" | "workingStartedAt">>(
  entries: ReadonlyArray<T>,
): ReadonlyArray<T & { waitingOnSubagents?: boolean }> {
  const byParent = new Map<string, T[]>();
  for (const entry of entries) {
    if (entry.relationshipToParent === "subagent" && entry.parentThreadId) {
      const list = byParent.get(entry.parentThreadId);
      if (list) list.push(entry); else byParent.set(entry.parentThreadId, [entry]);
    }
  }
  if (!byParent.size) return entries;
  return entries.map((entry) => {
    if (threadIsWorking(entry)) return entry;
    let earliest: string | null = null;
    let found = false;
    const seen = new Set<string>([entry.id]);
    const stack = [...(byParent.get(entry.id) ?? [])];
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (!node.archived && !node.settled && threadIsWorking(node)) {
        found = true;
        if (node.workingStartedAt && (!earliest || Date.parse(node.workingStartedAt) < Date.parse(earliest))) earliest = node.workingStartedAt;
      }
      for (const child of byParent.get(node.id) ?? []) stack.push(child);
    }
    if (!found) return entry;
    return { ...entry, waitingOnSubagents: true, workingStartedAt: earliest ?? entry.workingStartedAt };
  });
}
export function subagentStatus(item: Extract<WireTurnItem, { type: "subagent" }>, child?: ThreadSummary): string {
  if (child?.pendingRuntimeRequest) return "input";
  // Parent task results can stay completed while the child works on a follow-up.
  if (child?.activityRunStatus) return child.activityRunStatus;
  if (child && RUNNING_STATUSES.includes(child.status)) return child.status;
  return item.status;
}

export function subagentElapsed(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}
