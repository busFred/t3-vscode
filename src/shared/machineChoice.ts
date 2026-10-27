import type { HostStateSnapshot } from "./bridge";

/**
 * Whether the active conversation is a new chat that still chooses where it runs. A fork keeps the machine it was
 * forked on (T3 Code cannot move it), so it is never a new chat bound to the draft machine even while it is empty.
 */
export function choosingMachine(state: Pick<HostStateSnapshot, "activeThreadId" | "threads">): boolean {
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  return !thread || (thread.canChooseWorkspace === true && thread.relationshipToParent !== "fork");
}
