/**
 * The Stop button's pending state (T3 0.1.10): after a click it reads "Stopping" and refuses repeat
 * clicks, so a second click cannot re-send the interrupt. It re-enables after `STOP_PENDING_MAX_MS` if the
 * stop never lands. The state belongs to one thread and one run, and ends when the run stops or changes.
 */
export const STOP_PENDING_MAX_MS = 10_000;

export type StopPhase = "pending" | "timedOut";
export interface StopState { readonly key: string; readonly phase: StopPhase | null }

/** One conversation's run; a new run (or a different conversation) starts a fresh Stop. */
export const stopKey = (threadId: string | null | undefined, runId: string | null | undefined): string => `${threadId ?? ""}:${runId ?? ""}`;

export const idleStop = (key: string): StopState => ({ key, phase: null });

/**
 * Brings a stored state up to date with what is on screen now. Returns the same object when nothing changed,
 * so callers can compare identities. Stop is no longer offered once the run has stopped, which also
 * acknowledges the click; a button that comes back for the same run starts enabled again.
 */
export function reconcileStop(state: StopState, key: string, canStop: boolean): StopState {
  if (state.key !== key) return idleStop(key);
  if (state.phase !== null && !canStop) return idleStop(key);
  return state;
}

export const stopClicked = (key: string): StopState => ({ key, phase: "pending" });

/** The timer's transition; ignored when the state moved on (another run, or already settled). */
export const stopTimedOut = (state: StopState, key: string): StopState => state.key === key && state.phase === "pending" ? { key, phase: "timedOut" } : state;

export const isStopDisabled = (state: StopState): boolean => state.phase === "pending";

/** The accessible name; the visible "Stopping…" accompanies it. */
export const stopLabel = (state: StopState): string => isStopDisabled(state) ? "Stopping" : "Stop generation";
