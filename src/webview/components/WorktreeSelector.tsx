import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { WorktreeChoice } from "../../shared/worktrees";
import { useActions } from "../actions";
import { WorktreePopover } from "./WorktreePopover";
import { WorktreeChoiceFields, validWorktreeChoice, worktreeChoiceLabel } from "./WorktreeChoice";
import { WorktreeInspector } from "./WorktreeInspector";
import { defaultWorktreeBase } from "./WorktreeDefaults";

export function composerWorktreeLabel(state: HostStateSnapshot): string {
  const thread = state.threads.find((thread) => thread.id === state.activeThreadId);
  return thread && !thread.canChooseWorkspace ? thread.worktreePath ? state.worktrees?.items.find((item) => item.path === thread.worktreePath)?.branch || "Worktree" : "Root" : worktreeChoiceLabel(state.draft.workspace, state);
}
export function WorktreeSelector({ state, disabled }: { readonly state: HostStateSnapshot; readonly disabled: boolean }) {
  const thread = state.threads.find((thread) => thread.id === state.activeThreadId);
  const projectId = thread?.projectId ?? state.draft.projectId;
  const choosing = !thread || thread.canChooseWorkspace === true;
  const label = composerWorktreeLabel(state);
  const anchor = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<WorktreeChoice>(state.draft.workspace ?? { type: "root" });
  const close = useCallback(() => setOpen(false), []); const run = useActions();
  const choiceKey = JSON.stringify(state.draft.workspace ?? { type: "root" });
  useEffect(() => { setChoice(JSON.parse(choiceKey) as WorktreeChoice); }, [choiceKey]);
  useEffect(() => { if (open && state.phase === "ready") void run("refreshWorktrees", { projectId }); }, [open, projectId, state.phase, run]);
  const item = state.worktrees?.items.find((item) => item.projectId === projectId && (thread?.worktreePath ? item.path === thread.worktreePath : item.root));
  const submit = async () => {
    if (!projectId || busy || !validWorktreeChoice(choice)) return;
    setBusy(true); setFailed(false);
    const ok = await run("configureWorktree", { projectId, choice });
    setBusy(false); if (ok) close(); else setFailed(true);
  };
  if (!projectId || !state.worktrees) return null;
  return <><button type="button" ref={anchor} className="worktree-control" title={!choosing ? `Checkout: ${thread?.worktreePath ?? "Root"}. Existing conversations keep their checkout.` : `Checkout for this draft: ${label}`} aria-label={`Worktree: ${label}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}><GitBranchIcon size={12} /><span>{label}</span><ChevronDownIcon size={11} /></button>
    {open && anchor.current ? <WorktreePopover anchor={anchor.current} title={!choosing ? "Session checkout" : "Choose checkout"} onClose={close}>
      {!choosing ? <><div className="task-editor-fields"><p className="task-context">This session stays bound to its checkout. Start a new chat to choose another checkout.</p>{item ? <WorktreeInspector state={state} item={item} /> : <p className="task-context">{thread?.worktreePath ?? state.projects.find((item) => item.id === projectId)?.workspaceRoot}</p>}</div><footer><button type="button" onClick={close}>Close</button><button type="button" className="primary" disabled={busy || state.phase !== "ready"} onClick={() => { setBusy(true); void run("newWorktreeChat", { projectId, choice: { type: "new", baseRef: defaultWorktreeBase(state, projectId) } }).then((ok) => { if (ok) close(); }).finally(() => setBusy(false)); }}>New worktree chat</button></footer></>
        : <><div className="task-editor-fields">{state.worktrees?.error ? <p className="task-status" role="alert">{state.worktrees.error}</p> : null}{state.phase !== "ready" ? <p className="task-status" role="status">Connect to T3 to choose a checkout.</p> : null}<WorktreeChoiceFields state={state} projectId={projectId} choice={choice} onChange={setChoice} disabled={busy} />{failed ? <p className="task-status" role="alert">Could not save the checkout. Your choices are kept.</p> : null}</div><footer><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="button" className="primary" disabled={busy || state.phase !== "ready" || !validWorktreeChoice(choice)} onClick={() => { void submit(); }}>{busy ? "Saving…" : "Use checkout"}</button></footer></>}
    </WorktreePopover> : null}</>;
}
