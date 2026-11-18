import type { TranscriptItem } from "./bridge.js";

export interface ResponseSubagent { readonly threadId: string; readonly title: string; readonly environmentId?: string }
interface Child { readonly threadId: string; readonly environmentId?: string; readonly title?: string | null }
/** The wire item fields this reads; typed loosely because each lives on a different item variant. */
type LooseItem = {
  readonly type: string; readonly subagentId?: string; readonly childThreadId?: string | null; readonly senderThreadId?: string;
  readonly remoteChild?: { readonly environmentId: string; readonly threadId: string; readonly title?: string };
  readonly source?: { readonly taskIds?: ReadonlyArray<string>; readonly childThreadId?: string };
};

/**
 * Ported from T3 Code `readResponseSubagents` (apps/web/src/state/entities.ts, 0.1.10), over the rows this view has loaded:
 * a subagent's result reaches the thread as a message from its thread or as a completion notice, so the inputs just before the
 * response decide which subagents it reported on. T3 also reads a message's delegated-completion cohort, which the transcript
 * rows do not carry, so a reply may name fewer subagents than T3 would; it never names a wrong one.
 */
export function responseSubagents(rows: ReadonlyArray<TranscriptItem>, rowKey: string, titleOf: (threadId: string) => string | undefined): ReadonlyArray<ResponseSubagent> {
  const items = rows.map((row) => row.item as unknown as LooseItem);
  const isInput = (index: number) => items[index]?.type === "user_message" || items[index]?.type === "notification";
  let index = rows.findIndex((row) => row.key === rowKey) - 1;
  if (index < -1) return [];
  while (index >= 0 && !isInput(index)) index -= 1;
  const byTask = new Map<string, Child>(), local = new Map<string, Child>();
  for (const item of items) {
    if (item.type !== "subagent" || !item.subagentId) continue;
    if (item.childThreadId) { const child = { threadId: item.childThreadId }; byTask.set(item.subagentId, child); local.set(item.childThreadId, child); }
    else if (item.remoteChild) byTask.set(item.subagentId, { threadId: item.remoteChild.threadId, environmentId: item.remoteChild.environmentId, title: item.remoteChild.title ?? null });
  }
  const found = new Map<string, Child>();
  const add = (child: Child | undefined) => { if (child) found.set(`${child.environmentId ?? ""}:${child.threadId}`, child); };
  for (; index >= 0 && isInput(index); index -= 1) {
    const item = items[index]!;
    if (item.type === "notification") {
      // A notice names its child itself, so it counts even when the task is no longer loaded.
      if (item.source?.childThreadId) add(local.get(item.source.childThreadId) ?? { threadId: item.source.childThreadId });
      for (const taskId of item.source?.taskIds ?? []) add(byTask.get(taskId));
    } else if (item.senderThreadId) add(local.get(item.senderThreadId)); // Only this thread's own subagents count as senders.
  }
  return [...found.values()].map(({ title, ...child }) => ({ ...child, title: title?.trim() || (child.environmentId ? undefined : titleOf(child.threadId)?.trim()) || "Agent" }));
}
