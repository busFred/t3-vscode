import { useState } from "react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { WorktreePreparation as Preparation } from "../../shared/worktrees";
import { useActions } from "../actions";
import "./worktrees.css";

export function WorktreePreparation({ preparation }: { readonly preparation: Preparation }) {
  const run = useActions(); const [pending, setPending] = useState(false);
  const action = async (action: "cancel" | "retry") => {
    if (pending) return; setPending(true);
    await run("worktreeAction", { projectId: preparation.projectId, action, preparationId: preparation.id });
    setPending(false);
  };
  return <div className="worktree-preparation" role={preparation.phase === "failed" ? "alert" : "status"}>
    <details open={preparation.phase === "failed" ? true : undefined}><summary>{preparation.branch ? `${preparation.branch} · ` : ""}{preparation.background ? preparation.backgroundRunning ? `Background setup · ${preparation.stage}` : preparation.phase === "failed" ? "Background setup failed" : preparation.phase === "cancelled" ? "Background setup cancelled" : preparation.phase === "ready" ? "Ready" : `Background setup · ${preparation.stage}` : preparation.phase === "running" ? `Preparing · ${preparation.stage}` : preparation.phase === "ready" ? "Ready" : preparation.phase === "cancelled" ? "Setup cancelled" : "Setup failed"}</summary>
      {preparation.path ? <p className="task-context">{preparation.path}</p> : null}
      {preparation.error ? <p className="task-status">{preparation.error}</p> : null}
      <pre className="worktree-log">{preparation.log || "No setup output yet."}</pre>
      <div className="worktree-actions">{preparation.phase === "running" || preparation.backgroundRunning ? <button type="button" disabled={pending} onClick={() => { void action("cancel"); }}>Cancel setup</button> : preparation.phase === "failed" || preparation.phase === "cancelled" ? <button type="button" disabled={pending} onClick={() => { void action("retry"); }}>Retry setup</button> : null}
        {preparation.threadId && !preparation.threadId.startsWith("checkout:") ? <button type="button" onClick={() => { void run("openSessionTab", { threadId: preparation.threadId, preview: true }); }}>Open chat</button> : null}
        {preparation.phase === "ready" && preparation.path ? <button type="button" onClick={() => { void run("worktreeAction", { projectId: preparation.projectId, path: preparation.path, action: "review" }); }}>Review changes</button> : null}</div>
    </details>
    {preparation.background ? <small>Background setup does not block the agent.</small> : preparation.phase !== "ready" ? <small>The first agent message waits for setup to finish.</small> : null}
  </div>;
}
export function preparationIsNewer(candidate: Preparation, previous: Preparation): boolean {
  const date = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value : -Infinity;
  return date(candidate.updatedAt) >= date(previous.updatedAt);
}
export function activeWorktreePreparations(state: HostStateSnapshot): ReadonlyArray<Preparation> {
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  if (!thread) return [];
  // Persisted records need an explicit clock; fixtures and legacy records retain insertion order.
  const matching = state.worktrees?.preparations.filter((item) => item.threadId === thread.id || !!thread.worktreePath && item.path === thread.worktreePath) ?? [];
  const latest = matching.reduce<Preparation | undefined>((previous, item) => !previous || preparationIsNewer(item, previous) ? item : previous, undefined);
  return latest ? [latest] : [];
}
