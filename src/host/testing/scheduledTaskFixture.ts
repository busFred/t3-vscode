import { ScheduledTask } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { v2ThreadShell } from "../../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";

export function scheduledTaskFixture(overrides: Record<string, unknown> = {}): ScheduledTask {
  return Schema.decodeUnknownSync(ScheduledTask)({ id: "task-training", title: "Check training", prompt: "Read the training log and report progress.", enabled: true,
    projectId: v2ThreadShell.projectId, threadId: v2ThreadShell.id, workspaceStrategy: { type: "root" }, modelSelection: v2ThreadShell.modelSelection,
    runtimeMode: "full-access", interactionMode: "default", createdBy: "agent", creationSource: "mcp", schedule: { type: "interval", everyMs: 1_800_000 },
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", nextRunAt: null, lastRunAt: null, lastRunStatus: "never", lastRunError: null, runCount: 0, ...overrides });
}
