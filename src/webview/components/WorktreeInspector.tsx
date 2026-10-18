import { useState } from "react";
import { existingCheckoutChoice } from "../../shared/worktreeGroups";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { WorktreeReview, WorktreeSummary } from "../../shared/worktrees";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { WorktreePreparation } from "./WorktreePreparation";
import { defaultWorktreeBase, defaultWorktreeDestination } from "./WorktreeDefaults";
import { useDateTimeFormat } from "../timeFormat";

function Review({ state, item }: { readonly state: HostStateSnapshot; readonly item: WorktreeSummary }) {
  const [baseRef, setBaseRef] = useState(() => defaultWorktreeBase(state, item.projectId)); const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [destination, setDestination] = useState(() => defaultWorktreeDestination(state, item.projectId, item.path));
  const [message, setMessage] = useState(""); const [operation, setOperation] = useState("commit"); const [busy, setBusy] = useState(false);
  const run = useActions();
  const review = useBridgeQuery<WorktreeReview>("worktreeReview", { projectId: item.projectId, path: item.path, baseRef }, `${item.projectId}:${item.path}:${baseRef}:${refresh}`, 250);
  const action = async (params: object) => { setBusy(true); const ok = await run("worktreeAction", { projectId: item.projectId, path: item.path, baseRef, ...params }); setBusy(false); if (ok) { setRefresh((value) => value + 1); setSelected(new Set()); } };
  return <fieldset disabled={busy || state.phase !== "ready"}>
    <label>Compare with<input aria-label="Review base branch" value={baseRef} onChange={(event) => { setBaseRef(event.target.value); setSelected(new Set()); }} /></label>
    {review.pending ? <small role="status">Loading changed files…</small> : review.error ? <p className="task-status" role="alert">{review.error}<button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></p> : null}
    {review.data ? <><div className="worktree-actions"><button type="button" onClick={() => { void action({ action: "review" }); }}>Open native diff</button><button type="button" onClick={() => setSelected(new Set(review.data!.files.map((file) => file.path)))}>Select all</button><button type="button" onClick={() => setSelected(new Set())}>Clear</button></div>
      {review.data.files.map((file) => <label className="task-enabled worktree-review-file" key={file.path}><input type="checkbox" checked={selected.has(file.path)} onChange={(event) => { setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(file.path); else next.delete(file.path); return next; }); }} /><span>{file.path}</span><small>+{file.additions} −{file.deletions}</small></label>)}
      {!review.data.files.length ? <small>No changes against {baseRef}.</small> : null}
      <label>Apply selected files to<select aria-label="Apply destination" value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Choose checkout</option>{state.worktrees?.items.filter((checkout) => checkout.projectId === item.projectId && checkout.path !== item.path && !checkout.missing).map((checkout) => <option key={checkout.path} value={checkout.path}>{checkout.root ? "Root" : checkout.branch || checkout.path}</option>)}</select></label>
      <div className="worktree-actions"><button type="button" disabled={!selected.size || !destination || review.pending} onClick={() => { void action({ action: "apply", files: [...selected], destination }); }}>Apply {selected.size || "selected"} files…</button><button type="button" onClick={() => { setSelected(new Set()); setRefresh((value) => value + 1); }}>Refresh changes</button></div>
    </> : null}
    <label>Git action<select aria-label="Git action" value={operation} onChange={(event) => setOperation(event.target.value)}><option value="commit">Commit</option><option value="push">Push</option><option value="create_pr">Create pull request</option><option value="commit_push">Commit and push</option><option value="commit_push_pr">Commit, push and create pull request</option></select></label>
    {operation.startsWith("commit") ? <label>Commit message<input aria-label="Commit message" value={message} onChange={(event) => setMessage(event.target.value)} /></label> : null}
    <div className="worktree-actions"><button type="button" disabled={operation.startsWith("commit") && !message.trim()} onClick={() => { void action({ action: "git", operation, commitMessage: message }); }}>Continue…</button></div>
  </fieldset>;
}

export function WorktreeInspector({ state, item }: { readonly state: HostStateSnapshot; readonly item: WorktreeSummary }) {
  const { dateTime } = useDateTimeFormat();
  const run = useActions(); const [review, setReview] = useState(false); const [busy, setBusy] = useState(false);
  const settings = state.worktrees?.settings.find((settings) => settings.projectId === item.projectId);
  const actions = settings?.actions ?? [];
  const hasFileActions = settings?.fileActions.some((action) => !actions.some((existing) => existing.id === action.id));
  const preparations = state.worktrees?.preparations.filter((preparation) => preparation.projectId === item.projectId && preparation.path === item.path) ?? [];
  const action = async (action: string, params: object = {}) => { setBusy(true); await run("worktreeAction", { projectId: item.projectId, path: item.path, action, ...params }); setBusy(false); };
  const environment = item.environment;
  return <>
    <p className="task-context">{item.root ? "Root checkout" : item.branch || "Detached checkout"}{item.missing ? " · Missing" : ""}{item.locked ? " · Locked" : ""}<br />{item.path}</p>
    <div className="worktree-actions"><button type="button" disabled={busy || item.missing || state.phase !== "ready"} onClick={() => { void action("open"); }}>Open window</button><button type="button" disabled={busy || item.missing || state.phase !== "ready"} onClick={() => { void action("terminal"); }}>Terminal</button><button type="button" disabled={busy || item.missing || state.phase !== "ready"} onClick={() => { void run("newWorktreeChat", { projectId: item.projectId, choice: existingCheckoutChoice(item) }); }}>New chat</button>
      {!item.root ? item.missing ? <button type="button" disabled={busy || state.phase !== "ready"} onClick={() => { void action("restore"); }}>Restore…</button> : <button type="button" disabled={busy || state.phase !== "ready" || item.locked} onClick={() => { void action("remove"); }}>Remove…</button> : null}</div>
    <details className="task-workspace" open><summary>Environment · {item.root ? "Root checkout" : environment?.status ?? (settings?.environment.enabled ? "Not prepared" : "Disabled")}</summary>
      {item.root ? <small>Worktree environment profiles apply to linked checkouts. The root checkout keeps its existing environment.</small> : <>
      {environment ? <><p className="task-context">{environment.location === "directory" ? "Directory" : "Conda name"}: {environment.target}<br />Ownership: {environment.reserved ? "Managed by T3 VSCode" : "Not reserved"}</p>{environment.diagnostics.map((diagnostic, index) => <p className="task-status" key={index}>{diagnostic}</p>)}</> : null}
      {environment?.missingSince && settings?.environment.autoCleanup !== false ? <small>Cleanup eligible after {dateTime(new Date(Date.parse(environment.missingSince) + 24 * 60 * 60 * 1000))}; checked again when Worktrees opens or refreshes.</small> : null}
      {item.environmentCommand ? <><small>Run through this checkout’s environment:</small><pre className="worktree-log">{item.environmentCommand}</pre></> : null}
      {item.environmentInstructions ? <p className="task-context">{item.environmentInstructions}</p> : null}
      <small>Project actions use the environment helper. Arbitrary agent shell commands need an explicit environment command; this does not activate the provider’s shell.</small>
      {settings?.environment.enabled && !item.root && !item.missing ? <div className="worktree-actions"><button type="button" disabled={busy || state.phase !== "ready" || environment?.status === "preparing"} onClick={() => { void action("prepare"); }}>{environment?.status === "ready" ? "Re-run setup" : "Prepare environment"}</button></div> : null}
      </>}
    </details>
    {preparations.map((preparation) => <WorktreePreparation key={preparation.id} preparation={preparation} />)}
    {actions.length && !item.missing ? <details className="task-workspace"><summary>Project actions</summary>{actions.map((projectAction) => <div key={projectAction.id}><small>{projectAction.name}{projectAction.runOnWorktreeCreate ? projectAction.async === false ? " · waits during setup" : " · setup in background" : ""}</small><pre className="worktree-log">{projectAction.command}</pre><div className="worktree-actions"><button type="button" disabled={busy || state.phase !== "ready" || environment?.status === "preparing"} onClick={() => { void action("runAction", { actionId: projectAction.id }); }}>Run {projectAction.name}</button></div></div>)}</details> : null}
    {hasFileActions ? <small>Import t3.json actions in Worktree settings before running them.</small> : null}
    {!item.missing ? <details className="task-workspace" open={review} onToggle={(event) => setReview(event.currentTarget.open)}><summary>Review, apply and Git actions</summary>{review ? <Review state={state} item={item} /> : null}</details> : null}
  </>;
}
