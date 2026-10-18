import { useCallback, useRef, useState } from "react";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot, ModelSelection } from "../../shared/bridge";
import type { WorktreeChoice as Choice } from "../../shared/worktrees";
import { ModelPicker } from "./ModelPicker";
import { defaultWorktreeBase } from "./WorktreeDefaults";

export function worktreeChoiceLabel(choice: Choice | undefined, state: HostStateSnapshot): string {
  if (!choice || choice.type === "root") return "Root";
  if (choice.type === "new") return choice.branch || "New worktree";
  if (choice.type === "pr") return `PR ${choice.reference ?? ""}`.trim();
  return choice.branch ?? state.worktrees?.items.find((item) => item.path === choice.path)?.branch ?? choice.path?.split(/[\\/]/).at(-1) ?? "Worktree";
}

function RunModel({ state, selection, onChange }: { state: HostStateSnapshot; selection: ModelSelection; onChange: (value: ModelSelection) => void }) {
  const anchor = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false); const close = useCallback(() => setOpen(false), []);
  const provider = state.providers.find((provider) => provider.instanceId === selection.instanceId);
  const model = provider?.models.find((model) => model.slug === selection.model);
  return <><button type="button" className="task-model-choice" ref={anchor} onClick={() => setOpen(!open)} aria-label="Choose worktree run model">{model?.name ?? selection.model}<ChevronDownIcon size={13} /></button>
    {open && anchor.current ? <ModelPicker state={state} selection={selection} anchor={anchor.current} onClose={close} onSelect={onChange} /> : null}</>;
}

export function WorktreeChoiceFields({ state, projectId, choice, onChange, disabled = false }: { readonly state: HostStateSnapshot; readonly projectId: string; readonly choice: Choice; readonly onChange: (choice: Choice) => void; readonly disabled?: boolean }) {
  const patch = (change: Partial<Choice>) => onChange({ ...choice, ...change });
  const settings = state.worktrees?.settings.find((item) => item.projectId === projectId);
  const project = state.projects.find((item) => item.id === projectId);
  const items = state.worktrees?.items.filter((item) => item.projectId === projectId && !item.root && !item.missing) ?? [];
  const branches = state.worktrees?.branches.filter((item) => item.projectId === projectId) ?? [];
  const runs = choice.runs ?? [];
  const removeRun = (index: number) => {
    const remaining = runs.filter((_, i) => i !== index);
    if (remaining.length) { patch({ runs: remaining }); return; }
    const { runs: _removed, ...single } = choice;
    onChange(single);
  };
  const total = runs.length ? runs.reduce((count, run) => count + run.count, 0) : 1;
  const defaultModel = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection ?? state.draft.modelSelection;
  return <fieldset disabled={disabled}>
    <label>Checkout<select aria-label="Worktree checkout" value={choice.type} onChange={(event) => {
      const type = event.target.value as Choice["type"];
      onChange({ type, baseRef: defaultWorktreeBase(state, projectId), startFromOrigin: settings?.startFromOrigin ?? false, copyEnv: settings?.copyEnv ?? false, ...(type === "existing" && items[0] ? { path: items[0].path } : {}), ...(type === "branch" && branches[0] ? { branch: branches[0].name } : {}) });
    }}><option value="root">Root checkout</option><option value="new">New worktree</option><option value="existing" disabled={!items.length}>Existing worktree</option><option value="branch">Existing branch</option><option value="pr">Pull request</option></select></label>
    {choice.type === "root" ? <small>{project?.workspaceRoot}</small> : null}
    {choice.type === "existing" ? <label>Worktree<select aria-label="Existing worktree" value={choice.path ?? ""} onChange={(event) => patch({ path: event.target.value })}>{!items.some((item) => item.path === choice.path) ? <option value="">Choose worktree</option> : null}{items.map((item) => <option key={item.path} value={item.path}>{item.branch || item.path}</option>)}</select></label> : null}
    {choice.type === "branch" ? <label>Branch<input aria-label="Existing branch" list={`worktree-branches-${projectId}`} required value={choice.branch ?? ""} onChange={(event) => patch({ branch: event.target.value })} /><datalist id={`worktree-branches-${projectId}`}>{branches.map((branch) => <option key={branch.name} value={branch.name} />)}</datalist></label> : null}
    {choice.type === "pr" ? <label>Pull request number or URL<input aria-label="Pull request reference" required value={choice.reference ?? ""} onChange={(event) => patch({ reference: event.target.value })} /></label> : null}
    {choice.type === "new" || choice.type === "branch" || choice.type === "pr" ? <>
      <label>Base branch<input aria-label="Worktree base branch" required value={choice.baseRef ?? defaultWorktreeBase(state, projectId)} onChange={(event) => patch({ baseRef: event.target.value })} /></label>
      {choice.type === "new" ? <label>Branch name (optional)<input aria-label="New worktree branch" placeholder="Generated automatically" value={choice.branch ?? ""} onChange={(event) => patch({ branch: event.target.value })} /></label> : null}
      <label className="task-enabled"><input type="checkbox" checked={choice.startFromOrigin ?? false} onChange={(event) => patch({ startFromOrigin: event.target.checked })} />Start from origin</label>
      <label className="task-enabled"><input type="checkbox" checked={choice.copyEnv ?? false} onChange={(event) => patch({ copyEnv: event.target.checked })} />Copy .env files</label>
    </> : null}
    {choice.type === "new" ? <details className="task-workspace"><summary>Parallel runs · {total} of 4</summary><small>Each run gets its own checkout and the same first prompt. The agent starts after setup is ready.</small>
      {runs.map((run, index) => <div className="task-model-field" key={index}><RunModel state={state} selection={run.modelSelection} onChange={(modelSelection) => patch({ runs: runs.map((item, i) => i === index ? { ...item, modelSelection } : item) })} />
        <label>Runs<input aria-label={`Run count for model ${index + 1}`} type="number" min="1" max={4 - total + run.count} value={run.count} onChange={(event) => { const count = Math.max(1, Math.min(4 - total + run.count, Number(event.target.value) || 1)); patch({ runs: runs.map((item, i) => i === index ? { ...item, count } : item) }); }} /></label>
        <button type="button" className="text-button" aria-label={`Remove run model ${index + 1}`} onClick={() => removeRun(index)}><XIcon size={12} />Remove</button></div>)}
      <button type="button" className="text-button" disabled={!defaultModel || runs.length > 0 && total >= 4} onClick={() => { if (defaultModel) patch({ runs: [...runs, { modelSelection: defaultModel, count: 1 }] }); }}><PlusIcon size={12} />{runs.length ? "Add model" : "Choose models and run counts"}</button>
    </details> : null}
  </fieldset>;
}

export function validWorktreeChoice(choice: Choice): boolean {
  if (choice.runs && (!choice.runs.length || choice.type !== "new" || choice.runs.some((run) => !Number.isSafeInteger(run.count) || run.count < 1 || !run.modelSelection.instanceId || !run.modelSelection.model) || choice.runs.reduce((sum, run) => sum + run.count, 0) > 4)) return false;
  if (choice.type === "existing") return !!choice.path;
  if (choice.type === "branch") return !!choice.branch?.trim() && !!choice.baseRef?.trim();
  if (choice.type === "pr") return !!choice.reference?.trim() && !!choice.baseRef?.trim();
  return choice.type !== "new" || !!choice.baseRef?.trim();
}
