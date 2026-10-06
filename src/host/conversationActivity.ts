import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import type { ConversationQueue, ConversationTasks } from "../shared/bridge.js";

export function conversationActivity(projection: OrchestrationV2ThreadProjection | null | undefined): { queue: ConversationQueue | null; tasks: ConversationTasks | null } {
  if (!projection) return { queue: null, tasks: null };
  const workflow = deriveThreadQueueWorkflowState(projection);
  const active = workflow.activeRun;
  // T3 shows task progress only for the running turn's own todo plan.
  const plans = projection.plans.filter((plan) => plan.kind === "todo_list");
  const plan = active ? plans.findLast((plan) => plan.runId === active.id) : undefined;
  return { queue: { activeRunId: active?.id ?? null, canSteer: workflow.canPromoteToSteer, canReorder: workflow.canReorder, held: workflow.isHeld,
    entries: workflow.queuedRuns.map(({ run, text, attachments }) => ({ runId: run.id, text, attachmentNames: attachments.map((attachment) => attachment.name) })) },
    tasks: plan?.steps.length && active ? { runId: active.id, steps: plan.steps.map(({ text, status, durationMs }) => ({ text, status, ...(durationMs === undefined ? {} : { durationMs }) })) } : null };
}
