import { useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { WorktreePreparation, WorktreeReview, WorktreeSummary } from "../../shared/worktrees";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { defaultWorktreeBase } from "./WorktreeDefaults";
import { WorktreeInspector } from "./WorktreeInspector";
import { preparationIsNewer } from "./WorktreePreparation";

export interface WorktreeRunGroup {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly runs: ReadonlyArray<{ readonly item: WorktreeSummary; readonly preparation: WorktreePreparation }>;
}
/** Only real, persisted preparations can establish that checkouts share a launch. */
export function worktreeRunGroups(state: HostStateSnapshot, projectId: string): ReadonlyArray<WorktreeRunGroup> {
  const latest = new Map<string, WorktreePreparation>();
  for (const preparation of state.worktrees?.preparations ?? []) if (preparation.projectId === projectId && preparation.path && (!latest.has(preparation.path) || preparationIsNewer(preparation, latest.get(preparation.path)!))) latest.set(preparation.path, preparation);
  const latestGrouped = new Map<string, WorktreePreparation>();
  for (const preparation of state.worktrees?.preparations ?? []) if (preparation.projectId === projectId && preparation.path && preparation.groupId && (!latestGrouped.has(preparation.path) || preparationIsNewer(preparation, latestGrouped.get(preparation.path)!))) latestGrouped.set(preparation.path, preparation);
  const groups = new Map<string, WorktreeRunGroup>();
  for (const item of state.worktrees?.items ?? []) {
    if (item.projectId !== projectId) continue;
    const preparation = latest.get(item.path);
    const grouped = preparation?.groupId ? preparation : latestGrouped.get(item.path);
    if (!grouped?.groupId) continue;
    const group = groups.get(grouped.groupId) ?? { id: grouped.groupId, title: grouped.title || "Parallel runs", projectId, runs: [] };
    groups.set(group.id, { ...group, runs: [...group.runs, { item, preparation: preparation ?? grouped }] });
  }
  return [...groups.values()].filter((group) => group.runs.length > 1);
}

function RunSummary({ state, run, baseRef, refresh, onInspect }: { readonly state: HostStateSnapshot; readonly run: WorktreeRunGroup["runs"][number]; readonly baseRef: string; readonly refresh: number; readonly onInspect: () => void }) {
  const action = useActions(); const { item, preparation } = run;
  const thread = state.threads.find((thread) => thread.id === preparation.threadId) ?? state.threads.find((thread) => item.threadIds.includes(thread.id));
  const provider = state.providers.find((provider) => provider.instanceId === thread?.modelSelection.instanceId);
  const model = provider?.models.find((model) => model.slug === thread?.modelSelection.model);
  const review = useBridgeQuery<WorktreeReview>("worktreeReview", { projectId: item.projectId, path: item.path, baseRef }, !item.missing && baseRef.trim() ? `${item.projectId}:${item.path}:${baseRef}:${refresh}` : null);
  const files = review.data?.files;
  return <section className="history-shelf" aria-label={`Run ${item.branch || item.path}`}>
    <div className="history-heading"><strong>{item.branch || "Detached checkout"}</strong><small>{item.missing ? "Missing" : preparation.phase !== "ready" && !preparation.background ? preparation.phase : thread?.activeRunId ? "Working" : thread?.settled ? "Settled" : "Ready"}</small></div>
    <p className="task-context">{model?.name ?? thread?.modelSelection.model ?? "Model unavailable"}{provider ? ` · ${provider.displayName ?? provider.instanceId}` : ""}<br />{item.path}</p>
    {review.pending ? <small role="status">Loading changes…</small> : review.error ? <p className="task-status" role="status">{review.error}</p> : files ? <small>{files.length} changed {files.length === 1 ? "file" : "files"} · +{files.reduce((total, file) => total + file.additions, 0)} −{files.reduce((total, file) => total + file.deletions, 0)}</small> : null}
    <div className="worktree-actions"><button type="button" disabled={!thread} onClick={() => { if (thread) void action("openSessionTab", { threadId: thread.id, preview: true }); }}>Open chat</button><button type="button" disabled={item.missing || !baseRef.trim() || state.phase !== "ready"} onClick={() => { void action("worktreeAction", { projectId: item.projectId, path: item.path, action: "review", baseRef }); }}>Review changes</button><button type="button" onClick={onInspect}>Checkout actions</button></div>
  </section>;
}

export function WorktreeComparison({ state, group, onClose }: { readonly state: HostStateSnapshot; readonly group: WorktreeRunGroup; readonly onClose: () => void }) {
  const [baseRef, setBaseRef] = useState(() => defaultWorktreeBase(state, group.projectId)); const [refresh, setRefresh] = useState(0); const [inspecting, setInspecting] = useState<string | null>(null);
  const checkout = state.worktrees?.items.find((item) => item.projectId === group.projectId && item.path === inspecting);
  return <div className="scheduled-task-editor" aria-label="Compare worktree runs"><header><button type="button" className="text-button" onClick={onClose}><ArrowLeftIcon size={13} />Worktrees</button><h2>Compare runs · {group.runs.length}</h2></header><div className="task-editor-fields"><fieldset><p className="task-context">{group.title}</p>
    <label>Compare with<input aria-label="Run comparison base branch" value={baseRef} onChange={(event) => setBaseRef(event.target.value)} /></label>
    <div className="worktree-actions"><button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh changes</button></div>
    {group.runs.map((run) => <RunSummary key={run.item.path} state={state} run={run} baseRef={baseRef} refresh={refresh} onInspect={() => setInspecting(inspecting === run.item.path ? null : run.item.path)} />)}
    {checkout ? <fieldset aria-label="Selected checkout actions"><WorktreeInspector key={checkout.path} state={state} item={checkout} /></fieldset> : null}
  </fieldset></div></div>;
}
