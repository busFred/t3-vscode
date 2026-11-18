import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

const UNANSWERED_LIMIT = 20;

/**
 * Questions that closed without an answer: Stop cancelled them, or the provider timed them out (T3 0.1.10).
 * Whatever was typed into their cards was never sent, so the webview moves it to the composer draft.
 * Absent when there are none, so an ordinary snapshot carries no extra field.
 */
export function unansweredUserInputIds(projection: Pick<OrchestrationV2ThreadProjection, "runtimeRequests">): { readonly unansweredUserInputIds?: ReadonlyArray<string> } {
  const ids = projection.runtimeRequests.flatMap((request) => request.kind === "user_input" && (request.status === "cancelled" || request.status === "expired") ? [request.id as string] : []);
  // Only recent ones can still have typed text waiting in the webview; older ones would grow every snapshot forever.
  return ids.length ? { unansweredUserInputIds: ids.slice(-UNANSWERED_LIMIT) } : {};
}
