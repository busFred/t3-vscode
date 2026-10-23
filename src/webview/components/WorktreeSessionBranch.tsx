import { useState } from "react";
import type { HostStateSnapshot, ThreadSummary } from "../../shared/bridge";
import type { SessionBranchPolicy, WorktreeSummary } from "../../shared/worktrees";
import { useActions } from "../actions";

export const branchPolicyLabel = (policy: SessionBranchPolicy) => policy === "pinned" ? "Keep the session branch" : "Follow the checkout";

export function WorktreeSessionBranch({ state, thread, item }: { readonly state: HostStateSnapshot; readonly thread: ThreadSummary; readonly item: WorktreeSummary }) {
  const run = useActions(); const [busy, setBusy] = useState(false);
  const settings = state.worktrees?.settings.find((entry) => entry.projectId === thread.projectId);
  const projectPolicy = settings?.branchPolicy ?? "follow";
  const override = settings?.sessionBranchPolicies?.[thread.id];
  const policy = override ?? projectPolicy;
  const recorded = thread.branch ?? null, actual = item.branch || null;
  const changed = !item.missing && recorded !== actual;
  const action = async (params: object) => { setBusy(true); await run("sessionBranch", { threadId: thread.id, ...params }); setBusy(false); };
  return <details className="task-workspace" open={changed || undefined}><summary>Branch · {policy === "pinned" ? "Kept" : "Follows checkout"}{changed ? " · Changed" : ""}</summary>
    <p className="task-context">Session: {recorded ?? "No branch recorded"}<br />Checkout: {item.missing ? "Missing" : actual ?? "Detached HEAD"}</p>
    <label>When the checkout branch changes<select aria-label="Session branch policy" disabled={busy || state.phase !== "ready"} value={override ?? ""} onChange={(event) => { void action({ action: "policy", policy: event.target.value || null }); }}>
      <option value="">Project default · {branchPolicyLabel(projectPolicy)}</option><option value="follow">{branchPolicyLabel("follow")}</option><option value="pinned">{branchPolicyLabel("pinned")}</option></select></label>
    <small>{policy === "pinned" ? "Messages are held until the checkout is back on the session branch, or you use the checkout branch." : "Sending a message records the checkout’s current branch for this session."}</small>
    {changed ? <div className="worktree-actions"><button type="button" disabled={busy || state.phase !== "ready"} onClick={() => { void action({ action: "adopt" }); }}>Use {actual ?? "detached HEAD"}</button>
      {recorded ? <button type="button" disabled={busy || state.phase !== "ready" || !!thread.activeRunId} onClick={() => { void action({ action: "switch" }); }}>Switch checkout to {recorded}…</button> : null}</div> : null}
  </details>;
}
