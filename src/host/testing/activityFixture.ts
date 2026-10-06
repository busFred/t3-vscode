import { MessageId, NodeId, PlanId, ProviderThreadId, RunAttemptId, RunId, ThreadId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { v2Now } from "../../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { turnFixture } from "./turnFixture.js";
import type { FakeTransport } from "./fakeTransport.js";

export function activityFixture(id: string, steer = true): OrchestrationV2ThreadProjection {
  const projection = turnFixture(id); const seed = projection.runs[0]!;
  const active = { ...seed, id: RunId.make(`active-${id}`), ordinal: 3, status: "running" as const, providerThreadId: ProviderThreadId.make(`provider-${id}`), activeAttemptId: RunAttemptId.make(`attempt-${id}`), completedAt: null };
  const queued = [1, 2].map((position) => ({ ...seed, id: RunId.make(`queued-${id}-${position}`), ordinal: 3 + position, queuePosition: position, status: "queued" as const, userMessageId: MessageId.make(`queued-message-${id}-${position}`), completedAt: null }));
  // Session evidence mirrors the focused workflow fixtures in T3 Code's tests.
  const evidence = { providerThreads: [{ id: active.providerThreadId, providerSessionId: `session-${id}`, appThreadId: id }],
    providerSessions: [{ id: `session-${id}`, status: "running", capabilities: { turns: { supportsQueuedMessages: true, supportsActiveSteering: steer, supportsSteeringByInterruptRestart: false } } }],
    providerTurns: [{ id: `native-turn-${id}`, runAttemptId: active.activeAttemptId, status: "running" }] } as unknown as Pick<OrchestrationV2ThreadProjection, "providerThreads" | "providerSessions" | "providerTurns">;
  return { ...projection, ...evidence, runs: [...projection.runs, active, ...queued],
    messages: queued.map((run, index) => ({ id: run.userMessageId, threadId: ThreadId.make(id), runId: run.id, nodeId: null, role: "user", text: `Queued follow-up ${index + 1}`, attachments: [], streaming: false, createdAt: v2Now, updatedAt: v2Now, createdBy: "user", creationSource: "web", context: { version: 1, records: [] } })),
    plans: [{ id: PlanId.make(`tasks-${id}`), threadId: ThreadId.make(id), runId: active.id, nodeId: NodeId.make(`plan-node-${id}`), status: "active", kind: "todo_list", steps: [{ id: "read", text: "Read the source", status: "completed" }, { id: "implement", text: "Implement the approved design", status: "running" }, { id: "test", text: "Verify both surfaces", status: "pending" }] }] };
}
export function publishActivity(client: FakeTransport, id: string, steer = true) { client.threadHandlers.get(id)?.({ kind: "snapshot", snapshotSequence: 20, projection: activityFixture(id, steer) }); }
