import type { ThreadSummary } from "./bridge.js";

/** Resolve environment-scoped remote tasks without mistaking a same-id local thread for the child. */
export function withRemoteSubagents(threads: ReadonlyArray<ThreadSummary>): ThreadSummary[] {
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const result = new Map(byId);
  for (const parent of threads) for (const task of parent.remoteSubagents ?? []) {
    const candidate = byId.get(task.threadId);
    const child = candidate?.environmentId === task.environmentId ? candidate : undefined;
    if (child?.relationshipToParent === "subagent" && child.parentThreadId) continue;
    const id = child?.id ?? `remote-task:${parent.id}:${task.id}`;
    const status = child ? child.activityRunStatus ?? child.status : task.status;
    const outcome = status === "failed" ? "failed" as const : ["cancelled", "interrupted"].includes(status) ? "stopped" as const : undefined;
    result.set(id, {
      ...(child ?? { modelSelection: parent.modelSelection, runtimeMode: parent.runtimeMode, interactionMode: parent.interactionMode,
        updatedAt: parent.updatedAt, status: task.status, activeRunId: null, archived: false, pinned: false }), id, projectId: child?.projectId ?? parent.projectId, title: child?.title || task.title,
      environmentId: task.environmentId, environmentLabel: task.label,
      ...(task.stopSubagent ? { stopSubagent: task.stopSubagent } : {}),
      ...(outcome ? { subagentOutcome: outcome } : {}),
      parentThreadId: parent.id, relationshipToParent: "subagent", remoteDelegation: true, ...(child?.remoteSubagents ? { remoteSubagents: child.remoteSubagents } : {}),
      ...(child ? {} : { readOnlyHint: `Machine ${task.label} is not paired or its thread is unavailable. Pair this machine to open the conversation.`,
        status: task.status, activityRunStatus: task.status, activeRunId: null, pendingRuntimeRequest: null,
        archived: false, settled: false, pinned: false, waitingOnSubagents: false,
        workingStartedAt: task.startedAt }),
    });
  }
  return [...result.values()];
}
