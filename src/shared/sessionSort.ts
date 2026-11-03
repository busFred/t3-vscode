import { sortPinnedThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
import type { ThreadSummary } from "./bridge.js";

export const SESSION_SORTS = [
  { value: "date-desc", label: "Date · newest first" },
  { value: "date-asc", label: "Date · oldest first" },
  { value: "title-asc", label: "Title · A → Z" },
  { value: "title-desc", label: "Title · Z → A" },
] as const;
export type SessionSort = typeof SESSION_SORTS[number]["value"];
export function sessionSort(value: unknown): SessionSort {
  return SESSION_SORTS.some(option => option.value === value) ? value as SessionSort : "date-desc";
}
/** Pins and ancestry keep their meaning; order applies to siblings within each shelf. */
export function compareSessions(a: ThreadSummary, b: ThreadSummary, sort: SessionSort): number {
  const pinned = Number(b.pinned) - Number(a.pinned);
  if (pinned) return pinned;
  if (a.id === b.id) return 0;
  if (a.pinned && b.pinned) return sortPinnedThreadsByOrderKey([a, b].map(thread => ({ ...thread, createdAt: thread.createdAt ?? thread.updatedAt })))[0]!.id === a.id ? -1 : 1;
  const direction = sort.endsWith("asc") ? 1 : -1;
  if (sort.startsWith("title")) return direction * (a.title || "Untitled").localeCompare(b.title || "Untitled", undefined, { numeric: true, sensitivity: "base" });
  const date = (thread: ThreadSummary) => {
    const active = Date.parse(thread.lastActiveAt ?? "");
    return Number.isFinite(active) ? active : Date.parse(thread.updatedAt);
  };
  const left = date(a), right = date(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number(Number.isFinite(right)) - Number(Number.isFinite(left));
  return direction * (left - right);
}
