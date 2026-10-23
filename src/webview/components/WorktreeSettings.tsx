import { useState } from "react";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { ProjectAction, WorktreeProjectSettings } from "../../shared/worktrees";
import type { WorktreeEnvironmentProfile } from "../../shared/worktreeEnvironment";
import { useActions } from "../actions";
import { branchPolicyLabel } from "./WorktreeSessionBranch";

export function WorktreeSettings({ state, settings, onClose }: { readonly state: HostStateSnapshot; readonly settings: WorktreeProjectSettings; readonly onClose: () => void }) {
  const [draft, setDraft] = useState(settings); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const run = useActions();
  const patch = (change: Partial<WorktreeProjectSettings>) => { setFailed(false); setDraft({ ...draft, ...change }); };
  const environment = (change: Partial<WorktreeEnvironmentProfile>) => patch({ environment: { ...draft.environment, ...change } });
  const cleanup = (change: Partial<WorktreeProjectSettings["cleanup"]>) => patch({ cleanup: { ...draft.cleanup, ...change } });
  const updateAction = (id: string, change: Partial<ProjectAction>) => patch({ actions: draft.actions.map((action) => action.id === id ? { ...action, ...change } : change.runOnWorktreeCreate === true ? { ...action, runOnWorktreeCreate: false } : action) });
  const valid = draft.actions.every((action) => !!action.name.trim() && !!action.command.trim()) && (!draft.environment.enabled || !!draft.environment.condaExecutable.trim() && (draft.environment.location === "directory" ? !!draft.environment.directory.trim() : !!draft.environment.namePrefix.trim()) && (draft.environment.seed === "file" ? !!draft.environment.specification.trim() : !!draft.environment.cloneFrom.trim()));
  return <form className="scheduled-task-editor" aria-label="Worktree settings" onSubmit={(event) => { event.preventDefault(); if (!valid || busy) return; setBusy(true); void run("saveWorktreeSettings", { projectId: draft.projectId, settings: draft }).then((ok) => { if (ok) onClose(); else setFailed(true); }).finally(() => setBusy(false)); }}>
    <header><button type="button" className="text-button" disabled={busy} onClick={onClose}><ArrowLeftIcon size={13} />Worktrees</button><h2>Worktree settings</h2></header>
    <div className="task-editor-fields"><p className="task-context">{state.projects.find((project) => project.id === draft.projectId)?.title}</p>{failed ? <p className="task-status" role="alert">Save failed. Your edits are kept.</p> : null}
      <fieldset disabled={busy}>
        <details className="task-workspace" open><summary>Project actions · synced with T3</summary><small>The selected setup action runs when a worktree is created. Waiting setup finishes before the first agent starts.</small>
          {draft.actions.map((action) => <fieldset key={action.id}>
            <label>Name<input required aria-label="Action name" value={action.name} onChange={(event) => updateAction(action.id, { name: event.target.value })} /></label>
            <label>Command<textarea required aria-label={`Command for ${action.name || "action"}`} value={action.command} onChange={(event) => updateAction(action.id, { command: event.target.value })} /></label>
            <label>Icon<select aria-label="Action icon" value={action.icon} onChange={(event) => updateAction(action.id, { icon: event.target.value })}>{["play", "test", "lint", "configure", "build", "debug"].map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
            <label className="task-enabled"><input type="checkbox" checked={action.runOnWorktreeCreate} onChange={(event) => updateAction(action.id, { runOnWorktreeCreate: event.target.checked })} />Run on worktree creation</label>
            {draft.capabilities?.runOnSettle || action.runOnSettle ? <label className="task-enabled"><input type="checkbox" disabled={!draft.capabilities?.runOnSettle} checked={action.runOnSettle ?? false} onChange={(event) => updateAction(action.id, { runOnSettle: event.target.checked })} />Run when the session settles</label> : null}
            {action.runOnWorktreeCreate ? <label className="task-enabled"><input type="checkbox" checked={action.async === false} onChange={(event) => updateAction(action.id, { async: !event.target.checked })} />Wait for completion before the agent starts</label> : null}
            <div className="worktree-actions"><button type="button" onClick={() => patch({ actions: draft.actions.filter((item) => item.id !== action.id) })}>Delete action</button></div>
          </fieldset>)}
          <div className="worktree-actions"><button type="button" onClick={() => patch({ actions: [...draft.actions, { id: crypto.randomUUID(), name: "", command: "", icon: "configure", runOnWorktreeCreate: false, async: false }] })}><PlusIcon size={12} />Add action</button></div>
          <details className="task-workspace"><summary>Actions from project configuration</summary>{draft.fileError ? <p className="task-status">{draft.fileError}</p> : null}{!draft.fileActions.length ? <small>No file actions found.</small> : null}{draft.fileActions.map((action) => <div key={action.id}><small>{action.name}</small><pre className="worktree-log">{action.command}</pre><div className="worktree-actions"><button type="button" disabled={draft.actions.some((item) => item.id === action.id)} onClick={() => patch({ actions: [...draft.actions.map((item) => action.runOnWorktreeCreate ? { ...item, runOnWorktreeCreate: false } : item), { ...action }] })}>Import action</button></div></div>)}</details>
        </details>
        <details className="task-workspace" open><summary>Python environment · extension managed</summary><small>Shared across this extension’s windows. T3 Web has no environment profile editor. Project actions use this environment helper; arbitrary agent commands require explicit conda run.</small>
          <label className="task-enabled"><input type="checkbox" checked={draft.environment.enabled} onChange={(event) => environment({ enabled: event.target.checked })} />Prepare an isolated environment per checkout</label>
          <fieldset disabled={!draft.environment.enabled}>
            <label>Location<select aria-label="Environment location" value={draft.environment.location} onChange={(event) => environment({ location: event.target.value as "directory" | "named" })}><option value="directory">Directory inside checkout</option><option value="named">Unique Conda name</option></select></label>
            {draft.environment.location === "directory" ? <label>Environment directory<input aria-label="Environment directory" value={draft.environment.directory} onChange={(event) => environment({ directory: event.target.value })} /></label> : <label>Name prefix<input aria-label="Environment name prefix" value={draft.environment.namePrefix} onChange={(event) => environment({ namePrefix: event.target.value })} /></label>}
            <label>Create environment from<select aria-label="Environment seed" value={draft.environment.seed} onChange={(event) => environment({ seed: event.target.value as "file" | "clone" })}><option value="file">Environment file</option><option value="clone">Clone existing environment</option></select></label>
            {draft.environment.seed === "file" ? <label>Specification file<input aria-label="Environment specification" value={draft.environment.specification} onChange={(event) => environment({ specification: event.target.value })} /></label> : <label>Clone from name or path<input aria-label="Clone environment from" value={draft.environment.cloneFrom} onChange={(event) => environment({ cloneFrom: event.target.value })} /></label>}
            <label>Custom setup command<textarea aria-label="Environment setup command" value={draft.environment.customSetup} onChange={(event) => environment({ customSetup: event.target.value })} /></label>
            <label>Editable packages (one checkout-relative path per line)<textarea aria-label="Editable package paths" value={draft.environment.editable.join("\n")} onChange={(event) => environment({ editable: event.target.value.split("\n") })} /></label>
            <label>Conda executable<input aria-label="Conda executable" value={draft.environment.condaExecutable} onChange={(event) => environment({ condaExecutable: event.target.value })} /></label>
          </fieldset>
        </details>
        <details className="task-workspace"><summary>Creation defaults · synced with T3</summary>
          <label className="task-enabled"><input type="checkbox" checked={draft.startFromOrigin} onChange={(event) => patch({ startFromOrigin: event.target.checked })} />Start from origin</label>
          <label>Branch prefix<input aria-label="Worktree branch prefix" value={draft.branchPrefix} onChange={(event) => patch({ branchPrefix: event.target.value })} /></label>
          <label>Worktree location (T3 service-wide)<input disabled={!draft.capabilities?.worktreesDirectory} aria-label="Worktree location" value={draft.location} onChange={(event) => patch({ location: event.target.value })} /></label>
          {!draft.capabilities?.worktreesDirectory ? <small>This server does not support changing the worktree directory.</small> : null}
          <label>Submodules<select aria-label="Worktree submodules" value={draft.submodules} onChange={(event) => patch({ submodules: event.target.value as WorktreeProjectSettings["submodules"] })}><option value="recursive">Recursive</option><option value="top-level">Top level</option><option value="none">None</option></select></label>
          <label className="task-enabled"><input type="checkbox" checked={draft.copyEnv} onChange={(event) => patch({ copyEnv: event.target.checked })} />Copy .env files (extension)</label>
        </details>
        <details className="task-workspace"><summary>Session branches · extension only</summary>
          <label>When a session’s checkout changes branch<select aria-label="Default session branch policy" value={draft.branchPolicy ?? "follow"} onChange={(event) => patch({ branchPolicy: event.target.value as "follow" | "pinned" })}><option value="follow">{branchPolicyLabel("follow")}</option><option value="pinned">{branchPolicyLabel("pinned")}</option></select></label>
          <small>Sessions stay bound to their checkout folder. Following records the checkout’s current branch when you send a message. Keeping the branch holds messages until the checkout is switched back or you use its branch. Each session can override this in Session checkout.</small>
        </details>
        <details className="task-workspace"><summary>Cleanup · synced with T3</summary>
          <label className="task-enabled"><input type="checkbox" checked={draft.cleanup.enabled} onChange={(event) => cleanup({ enabled: event.target.checked })} />Enable automatic cleanup</label>
          <fieldset disabled={!draft.cleanup.enabled}>
            <label>Inactive for (days; 0 disables)<input type="number" min="0" aria-label="Cleanup inactive days" value={draft.cleanup.inactiveDays} onChange={(event) => cleanup({ inactiveDays: Math.max(0, Number(event.target.value) || 0) })} /></label>
            <label>Settled for (days; empty disables)<input type="number" min="0" disabled={!draft.capabilities?.cleanupRetention} aria-label="Cleanup settled days" value={draft.cleanup.settledDays ?? ""} onChange={(event) => cleanup({ settledDays: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) })} /></label>
            <label className="task-enabled"><input type="checkbox" checked={draft.cleanup.merged} onChange={(event) => cleanup({ merged: event.target.checked })} />Include merged branches</label>
            <label className="task-enabled"><input type="checkbox" checked={draft.cleanup.unchanged} onChange={(event) => cleanup({ unchanged: event.target.checked })} />Include unchanged worktrees</label>
            <label>Keep checkouts with<select disabled={!draft.capabilities?.cleanupRetention} aria-label="Cleanup preserve local files" value={draft.cleanup.keepLocalFiles} onChange={(event) => cleanup({ keepLocalFiles: event.target.value as WorktreeProjectSettings["cleanup"]["keepLocalFiles"] })}><option value="any">Any local files</option><option value="uncommitted">Uncommitted files</option><option value="tracked">Tracked changes</option></select></label>
          </fieldset>
          {!draft.capabilities?.cleanupRetention ? <small>This server does not support settled retention or local-file cleanup guards.</small> : null}
        </details>
        <details className="task-workspace"><summary>Environment cleanup · extension only</summary>
          <label className="task-enabled"><input type="checkbox" checked={draft.environment.autoCleanup ?? true} onChange={(event) => environment({ autoCleanup: event.target.checked })} />Clean up environments of deleted worktrees</label>
          <small>Checked when Worktrees opens or refreshes. Owned environments are removed after a 24-hour grace period from confirmed checkout removal. Moved or inaccessible checkouts and known active work are skipped. Separately launched Python processes may still be using an environment; turn this off to retain it.</small>
        </details>
      </fieldset>
    </div>
    <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy || !valid || state.phase !== "ready"}>{busy ? "Saving…" : "Save settings"}</button></footer>
  </form>;
}
