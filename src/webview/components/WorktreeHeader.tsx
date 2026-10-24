import { useCallback, useEffect, useRef, useState } from "react";
import { ServerIcon, GitBranchIcon, CircleCheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { WorktreePopover } from "./WorktreePopover";
import { WorktreeInspector } from "./WorktreeInspector";
import { checkoutForWorkingDirectory } from "../../shared/worktreeGroups";

export function WorktreeHeader({ state }: { readonly state: HostStateSnapshot }) {
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const projectId = thread?.projectId ?? state.draft.projectId;
  const path = thread?.worktreePath ?? (state.draft.workspace?.type === "existing" ? state.draft.workspace.path : undefined)
    ?? state.projects.find(project => project.id === projectId)?.workspaceRoot;
  const items = state.worktrees?.items.filter(item => item.projectId === projectId) ?? [];
  const item = items.find(item => item.path === path)
    ?? (thread ? items.find(item => item.threadIds.includes(thread.id)) : undefined)
    ?? items.find(item => item.path === (thread?.worktreePath || state.draft.workspace?.type === "existing"
      ? checkoutForWorkingDirectory(path ?? "", items.map(item => item.path))
      : items[0]?.projectCheckoutPath ?? checkoutForWorkingDirectory(path ?? "", items.map(item => item.path))));
  const [open, setOpen] = useState(false); const [copyEdits, setCopyEdits] = useState(false); const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []); const anchor = useRef<HTMLButtonElement>(null); const run = useActions();
  useEffect(() => { if (projectId && state.phase === "ready" && !state.remoteSession) void run("refreshWorktrees", { projectId }); }, [projectId, state.phase, state.remoteSession, run]);
  if (state.remoteSession) return <span className="remote-session-note" title={`Runs on ${state.remoteSession.label}; checkout, worktree and saved-turn diff actions are unavailable.`}><ServerIcon size={12} /><span>Running on {state.remoteSession.label}</span></span>;
  if (!state.worktrees || !item && !thread?.branch) return null;
  const status = item?.environment?.status;
  return <><button ref={anchor} type="button" className="worktree-control worktree-header-control" title={`${item?.path ?? thread?.worktreePath ?? "Root checkout"}${status ? ` · Environment ${status}` : ""}`} aria-label={`Checkout ${item?.branch ?? thread?.branch ?? "Root"}${status ? `, environment ${status}` : ""}`} aria-expanded={open} disabled={!item} onClick={() => setOpen(!open)}><GitBranchIcon size={12} /><span>{item?.branch || thread?.branch || "Root"}</span>{status === "ready" ? <CircleCheckIcon size={12} aria-label="Environment ready" /> : status === "preparing" ? <LoaderCircleIcon size={12} className="animate-spin" aria-label="Preparing environment" /> : status === "failed" || status === "cancelled" ? <CircleAlertIcon size={12} aria-label={`Environment ${status}`} /> : null}</button>
    {open && item && anchor.current ? <WorktreePopover anchor={anchor.current} title="Checkout and environment" onClose={close}><div className="task-editor-fields"><fieldset><WorktreeInspector state={state} item={item} />
      {item.root && thread && !thread.canChooseWorkspace && !thread.activeRunId && !thread.archived && !thread.providerNativeSubagent ? <details className="task-workspace"><summary>Continue in a worktree</summary><small>Moves this conversation to a new checkout at the current commit; its history stays with it.</small><label className="task-enabled"><input type="checkbox" checked={copyEdits} onChange={(event) => setCopyEdits(event.target.checked)} />Copy uncommitted files</label><div className="worktree-actions"><button type="button" disabled={busy || state.phase !== "ready"} onClick={() => { setBusy(true); void run("worktreeAction", { projectId, action: "continue", copyEdits }).then((ok) => { if (ok) close(); }).finally(() => setBusy(false)); }}>Continue…</button></div></details> : null}
    </fieldset></div></WorktreePopover> : null}</>;
}
