import { useEffect, useRef, useState } from "react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { turnAnnouncement } from "../../shared/turnAnnouncements";

/**
 * A polite live region narrating a turn's progress (T3 0.1.9), so a screen-reader user can follow
 * what the agent is doing without leaving the composer.
 *
 * Visually hidden, announced only when the phrase actually changes, and throttled: assistive
 * technology queues every update, so a fast-changing turn would otherwise talk over itself.
 */
const MIN_INTERVAL_MS = 1_000;

export function TurnAnnouncer({ state }: { readonly state: HostStateSnapshot }) {
  const thread = state.threads.find((entry) => entry.id === state.activeThreadId);
  const running = Boolean(thread?.activeRunId || state.queue?.activeRunId || state.sending);
  // Only the newest row is announced, so do not allocate a copy of the whole transcript on every
  // render: a streaming turn renders many times a second.
  const newest = state.transcript.at(-1);
  const phrase = turnAnnouncement({
    running,
    items: newest ? [{
      type: newest.item.type,
      label: newest.toolLabel ?? newest.item.title ?? null,
      status: newest.item.status ?? null,
      ...("streaming" in newest.item ? { streaming: newest.item.streaming === true } : {}),
    }] : [],
    pendingApprovals: state.pending.approvals.length,
    pendingQuestions: state.pending.userInputs.length,
    pendingSecrets: state.pending.secrets.length,
  });

  const [announced, setAnnounced] = useState("");
  const last = useRef({ phrase: "", at: 0 });
  useEffect(() => {
    const next = phrase ?? "";
    if (next === last.current.phrase) return;
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last.current.at));
    const commit = () => { last.current = { phrase: next, at: Date.now() }; setAnnounced(next); };
    if (wait === 0) { commit(); return; }
    const timer = setTimeout(commit, wait);
    return () => clearTimeout(timer);
  }, [phrase]);

  return <div className="turn-announcer" role="status" aria-live="polite" aria-atomic="true">{announced}</div>;
}
