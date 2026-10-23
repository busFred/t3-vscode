import * as DateTime from "effect/DateTime";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import type { PendingSecretRequest } from "../shared/bridge.js";

/**
 * Secret requests the user can answer here: pending and owned by this thread.
 * Inherited rows belong to another thread, which is where T3 expects the answer.
 * Only the request's label and reason are carried; the secret itself never enters host state.
 */
export function derivePendingSecretRequests(rows: OrchestrationV2ThreadProjection["visibleTurnItems"]): PendingSecretRequest[] {
  const secrets: PendingSecretRequest[] = [];
  for (const row of rows) {
    const item = row.item;
    if (row.visibility !== "local" || item.type !== "secret_request" || item.secretStatus !== "pending") continue;
    const at = item.startedAt ?? item.updatedAt;
    secrets.push({ turnItemId: item.id, label: item.label, reason: item.reason,
      ...(item.placeholder !== undefined ? { placeholder: item.placeholder } : {}), createdAt: at ? DateTime.formatIso(at) : null });
  }
  return secrets;
}
