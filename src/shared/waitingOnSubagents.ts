import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { waitingOnSubagentsLabel } from "@t3tools/client-runtime/state/subagentRuntime";
import type { TranscriptItem } from "./bridge.js";

export { waitingOnSubagentsLabel };

/**
 * How many of a run's subagents are still live when the run has done nothing since launching them (T3 0.1.10).
 * Reads back from the newest row while rows are subagent rows of `runId`; any other row (a message, a command, a
 * reasoning step, another run's row) means the parent is working itself, not waiting.
 */
export function runningSubagentsAtRunTail(rows: ReadonlyArray<Pick<TranscriptItem, "item">>, runId: string | null | undefined): number {
  if (!runId) return 0;
  let running = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const { item } = rows[index]!;
    if (item.type !== "subagent" || item.runId !== runId) break;
    if (isOrchestrationV2WorkActive(item.status)) running += 1;
  }
  return running;
}

/** The status word beside a running run: "Waiting on a subagent" instead of "Working" while only children run. */
export function runStatusLabel(rows: ReadonlyArray<Pick<TranscriptItem, "item">>, runId: string | null | undefined): string {
  const waiting = runningSubagentsAtRunTail(rows, runId);
  return waiting > 0 ? waitingOnSubagentsLabel(waiting) : "Working";
}
