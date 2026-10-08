import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Metadata updates and visits are deliberately excluded from conversation activity. */
export function sessionActivityAt(thread: OrchestrationV2ThreadShell): string | null {
  const stamps = [thread.latestUserMessageAt, thread.latestVisibleMessage?.updatedAt,
    thread.latestRunRequestedAt, thread.latestRunStartedAt, thread.latestRunCompletedAt,
    thread.activityRunStartedAt, thread.pendingRuntimeRequest?.createdAt,
    thread.itemCount === 0 ? thread.createdAt : null];
  const times = stamps.flatMap((stamp) => stamp ? [DateTime.toEpochMillis(stamp)] : []).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
