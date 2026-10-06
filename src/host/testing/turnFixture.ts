import { CheckpointId, CheckpointRef, CheckpointScopeId, MessageId, NodeId, RunId, ThreadId, TurnItemId, type OrchestrationV2Checkpoint, type OrchestrationV2ThreadProjection, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { v2Now, v2Projection } from "../../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import type { FakeTransport } from "./fakeTransport.js";

export const turnPatch = 'diff --git a/src/example.ts b/src/example.ts\nindex 1111111..2222222 100644\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-before\n+after\n';
export function turnFixture(id: string, turn = 2): OrchestrationV2ThreadProjection {
  const threadId = ThreadId.make(id); const scopeId = CheckpointScopeId.make(`scope-${id}`); const nodeId = NodeId.make(`node-${id}`);
  const checkpoint = (ordinal: number): OrchestrationV2Checkpoint => ({ id: CheckpointId.make(`checkpoint-${id}-${ordinal}`), threadId, scopeId,
    runId: ordinal ? RunId.make(`run-${id}-${ordinal}`) : null, nodeId, parentCheckpointId: null, ordinalWithinScope: ordinal, appRunOrdinal: ordinal || null,
    ref: CheckpointRef.make(`refs/t3/checkpoints/${id}/${ordinal}`), status: "ready", files: ordinal ? [{ path: "src/example.ts", kind: "modified", additions: 1, deletions: 1 }] : [], capturedAt: v2Now });
  const item: OrchestrationV2TurnItem = { id: TurnItemId.make(`changes-${id}`), threadId, runId: RunId.make(`run-${id}-${turn}`), nodeId, providerThreadId: null,
    providerTurnId: null, nativeItemRef: null, parentItemId: null, ordinal: 0, title: null, status: "completed", startedAt: v2Now, completedAt: v2Now, updatedAt: v2Now,
    type: "checkpoint", checkpointId: checkpoint(turn).id, scopeId, files: checkpoint(turn).files };
  return { ...v2Projection, thread: { ...v2Projection.thread, id: threadId },
    checkpointScopes: [{ id: scopeId, threadId, runId: null, nodeId, parentScopeId: null, providerThreadId: null, kind: "root_run", ordinalWithinParent: 0, advancesAppRunCount: true, cwd: "/tmp/t3-vscode", createdAt: v2Now }],
    checkpoints: Array.from({ length: turn + 1 }, (_, index) => checkpoint(index)),
    runs: Array.from({ length: turn }, (_, index) => ({ id: RunId.make(`run-${id}-${index + 1}`), threadId, ordinal: index + 1,
      providerInstanceId: v2Projection.thread.providerInstanceId, modelSelection: v2Projection.thread.modelSelection, providerThreadId: null, userMessageId: MessageId.make(`message-${index}`),
      rootNodeId: nodeId, activeAttemptId: null, status: "completed", requestedAt: v2Now, startedAt: v2Now, completedAt: v2Now, checkpointId: checkpoint(index + 1).id, contextHandoffId: null })),
    turnItems: [item], visibleTurnItems: [{ sourceThreadId: threadId, sourceItemId: item.id, position: 0, visibility: "local", item }] };
}
export function publishTurn(client: FakeTransport, id: string, turn = 2) { client.threadHandlers.get(id)?.({ kind: "snapshot", snapshotSequence: 10, projection: turnFixture(id, turn) }); }
