import type { OrchestrationV2Subagent, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Matches the web relationship control, including a child's later follow-up run. */
export function canStopSubagent(agent: OrchestrationV2Subagent, child?: OrchestrationV2ThreadShell): boolean {
  const active = (status: string) => ["pending", "running", "waiting"].includes(status);
  let status: string = agent.status, startedAt = agent.startedAt;
  if (child && !active(status)) {
    const live = child.activityRunStatus ?? (child.status === "queued" ? "queued" : null);
    const newer = child.latestRunRequestedAt && DateTime.toEpochMillis(child.latestRunRequestedAt) > DateTime.toEpochMillis(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
    if (live || newer) {
      status = live ?? child.status;
      if (["preparing", "starting", "queued"].includes(status)) status = "pending";
      startedAt = live ? child.activityRunStartedAt ?? null : child.latestRunStartedAt ?? null;
    }
  }
  return !!startedAt && active(status) &&
    (agent.origin === "app_owned" || (agent.origin === "provider_native" && agent.driver === "claudeAgent" &&
      agent.runId != null && agent.nativeTaskRef?.strength === "strong" && agent.nativeTaskRef.nativeId !== null && active(agent.status)));
}
