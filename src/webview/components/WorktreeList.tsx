import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranchIcon, SearchIcon, XIcon, RefreshCwIcon, PlusIcon, SettingsIcon, MoreHorizontalIcon, MessageSquareIcon, CheckIcon, FolderIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { WorktreeChoice, WorktreeSummary } from "../../shared/worktrees";
import { useActions } from "../actions";
import { WorktreePopover } from "./WorktreePopover";
import { WorktreeInspector } from "./WorktreeInspector";
import { WorktreeChoiceFields, validWorktreeChoice } from "./WorktreeChoice";
import { WorktreeSettings } from "./WorktreeSettings";
import { WorktreePreparation } from "./WorktreePreparation";
import { defaultWorktreeBase } from "./WorktreeDefaults";
import { WorktreeComparison, worktreeRunGroups } from "./WorktreeComparison";

function Checkout({ state, item, query }: { readonly state: HostStateSnapshot; readonly item: WorktreeSummary; readonly query: string }) {
  const [open, setOpen] = useState(false); const anchor = useRef<HTMLButtonElement>(null); const close = useCallback(() => setOpen(false), []);
  const run = useActions();
  const sessions = state.threads.filter((thread) => thread.projectId === item.projectId && (item.threadIds.includes(thread.id) || (item.root ? !thread.worktreePath : thread.worktreePath === item.path)));
  const matching = query && !`${item.branch} ${item.path}`.toLowerCase().includes(query) ? sessions.filter((thread) => thread.title.toLowerCase().includes(query)) : sessions;
  const settled = sessions.length > 0 && sessions.every((thread) => thread.settled || thread.archived);
  if (query && !matching.length && !`${item.branch} ${item.path}`.toLowerCase().includes(query)) return null;
  return <details className="worktree-checkout history-shelf" key={`${item.id}:${!!query}`} open={query ? true : undefined}>
    <summary title={item.path}>{item.root ? <FolderIcon size={13} /> : <GitBranchIcon size={13} />}<span>{item.root ? "Root" : item.branch || "Detached checkout"}</span><small className="shelf-count">{item.missing ? "Missing" : item.environment?.status === "preparing" ? "Preparing" : [item.imported ? "Imported" : "", settled ? "Settled" : ""].filter(Boolean).join(" · ") || sessions.length}</small></summary>
    <div className="worktree-checkout-tools worktree-actions"><button ref={anchor} type="button" aria-label={`Manage ${item.root ? "root checkout" : item.branch || item.path}`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontalIcon size={13} />Manage</button><button type="button" disabled={item.missing || state.phase !== "ready"} onClick={() => { void run("newWorktreeChat", { projectId: item.projectId, choice: item.root ? { type: "root" } : { type: "existing", path: item.path } }); }}><PlusIcon size={12} />Chat</button></div>
    <div className="session-tree-children">{matching.map((thread) => <button key={thread.id} className={`thread${thread.id === state.activeThreadId ? " active" : ""}`} data-thread-id={thread.id} aria-current={thread.id === state.activeThreadId ? "page" : undefined} onClick={(event) => { void run("openSessionTab", { threadId: thread.id, preview: event.detail < 2 }); }} onDoubleClick={() => { void run("openSessionTab", { threadId: thread.id, preview: false }); }}><span className="thread-title-line"><span className="thread-title">{thread.title || "Untitled"}</span></span><span className="thread-meta"><small>{thread.pendingRuntimeRequest ? "Input needed" : thread.activeRunId ? "Working" : thread.archived ? "Archived" : thread.settled ? "Settled" : "Session"}</small>{thread.settled ? <CheckIcon size={12} /> : <MessageSquareIcon size={12} />}</span></button>)}{!matching.length ? <p className="empty-list">No sessions in this checkout.</p> : null}</div>
    {open && anchor.current ? <WorktreePopover anchor={anchor.current} title="Checkout" onClose={close}><div className="task-editor-fields"><fieldset><WorktreeInspector state={state} item={item} /></fieldset></div></WorktreePopover> : null}
  </details>;
}

export function WorktreeList({ state, onAppearance, active = false }: { readonly state: HostStateSnapshot; readonly onAppearance: () => void; readonly active?: boolean }) {
  const run = useActions(); const [search, setSearch] = useState(""); const [selectedProject, setProject] = useState("");
  const [comparison, setComparison] = useState<{ projectId: string; groupId: string } | null>(null);
  const [settingsProject, setSettingsProject] = useState<string | null>(null); const [creating, setCreating] = useState(false); const [failed, setFailed] = useState(false); const [picker, setPicker] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null); const close = useCallback(() => setPicker(false), []);
  const projectId = state.projects.some((project) => project.id === selectedProject) ? selectedProject : state.threads.find((thread) => thread.id === state.activeThreadId)?.projectId ?? state.draft.projectId ?? state.projects[0]?.id;
  const [choice, setChoice] = useState<WorktreeChoice>({ type: "new", baseRef: "main" });
  useEffect(() => { if (active && state.phase === "ready") void run("refreshWorktrees", { cleanupEnvironments: true }); }, [active, state.phase, run]);
  const comparisonGroup = comparison ? worktreeRunGroups(state, comparison.projectId).find((group) => group.id === comparison.groupId) : undefined;
  if (comparisonGroup) return <WorktreeComparison key={comparisonGroup.id} state={state} group={comparisonGroup} onClose={() => setComparison(null)} />;
  const settings = state.worktrees?.settings.find((item) => item.projectId === settingsProject);
  if (settings) return <WorktreeSettings key={settings.projectId} state={state} settings={settings} onClose={() => setSettingsProject(null)} />;
  const query = search.trim().toLowerCase();
  const hasMatches = !query || state.projects.some((project) => project.title.toLowerCase().includes(query)) || state.worktrees?.items.some((item) => `${item.branch} ${item.path}`.toLowerCase().includes(query)) || state.threads.some((thread) => thread.title.toLowerCase().includes(query)) || state.worktrees?.preparations.some((preparation) => preparation.title?.toLowerCase().includes(query));
  const create = async () => {
    if (!projectId || creating || !validWorktreeChoice(choice)) return;
    setCreating(true); setFailed(false); const ok = await run("newWorktreeChat", { projectId, choice }); setCreating(false); if (ok) close(); else setFailed(true);
  };
  return <aside className="projects-sidebar worktree-sidebar" aria-label="Worktrees">
    <div className="sidebar-search-row"><label className="thread-search thread-search-with-clear"><SearchIcon size={14} /><input aria-label="Search worktrees and sessions" placeholder="Search worktrees…" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" className="icon-button thread-search-clear" disabled={!search} aria-label="Clear worktree search" style={{ visibility: search ? "visible" : "hidden" }} onClick={() => setSearch("")}><XIcon size={13} /></button></label>
      <button type="button" className="icon-button sidebar-search-add" aria-label="Refresh worktrees" disabled={state.worktrees?.loading || state.phase !== "ready"} onClick={() => { void run("refreshWorktrees", { cleanupEnvironments: true }); }}><RefreshCwIcon size={15} /></button><button ref={anchor} type="button" className="icon-button sidebar-search-add" aria-label="New worktree chat" aria-expanded={picker} disabled={!projectId || state.phase !== "ready"} onClick={() => { if (!picker) { const defaults = state.worktrees?.settings.find((item) => item.projectId === projectId); setChoice({ type: "new", baseRef: defaultWorktreeBase(state, projectId!), startFromOrigin: defaults?.startFromOrigin ?? false, copyEnv: defaults?.copyEnv ?? false }); } setPicker(!picker); setFailed(false); }}><PlusIcon size={15} /></button></div>
    {state.worktrees?.loading ? <p className="search-status" role="status">Loading worktrees…</p> : null}{state.worktrees?.error ? <p className="search-status turn-error" role="alert">{state.worktrees.error}</p> : null}{state.phase !== "ready" ? <p className="empty-list" role="status">Connect to T3 to manage worktrees.</p> : null}
    <div className="worktree-list">{!hasMatches ? <p className="empty-list">No matching worktrees or sessions.</p> : null}{state.projects.map((project) => {
      const items = state.worktrees?.items.filter((item) => item.projectId === project.id) ?? [];
      const groups = worktreeRunGroups(state, project.id);
      const groupedPaths = new Set(groups.flatMap((group) => group.runs.map((run) => run.item.path)));
      const preparations = state.worktrees?.preparations.filter((preparation) => preparation.projectId === project.id && (!preparation.path || !items.some((item) => item.path === preparation.path))) ?? [];
      const visibleItems = query && project.title.toLowerCase().includes(query) ? "" : query;
      return <section key={project.id} aria-label={`${project.title} checkouts`}>
        <div className="history-heading"><strong>{project.title}</strong><button type="button" className="icon-button" aria-label={`Worktree settings for ${project.title}`} title="Worktree settings" disabled={!state.worktrees?.settings.some((item) => item.projectId === project.id)} onClick={() => setSettingsProject(project.id)}><SettingsIcon size={14} /></button></div>
        {groups.map((group) => <details className="history-shelf" open key={group.id}><summary><span>{group.title}</span><small className="shelf-count">{group.runs.length} runs</small></summary><div className="worktree-checkout-tools worktree-actions"><button type="button" onClick={() => setComparison({ projectId: project.id, groupId: group.id })}>Compare runs</button></div>{group.runs.map(({ item }) => <Checkout key={item.id} state={state} item={item} query={group.title.toLowerCase().includes(query) ? "" : visibleItems} />)}</details>)}
        {items.filter((item) => !groupedPaths.has(item.path)).map((item) => <Checkout key={item.id} state={state} item={item} query={visibleItems} />)}
        {preparations.map((preparation) => <WorktreePreparation key={preparation.id} preparation={preparation} />)}
        {!items.length && !state.worktrees?.loading ? <p className="empty-list">No checkouts available. Refresh to try again.</p> : null}
      </section>;
    })}{!state.projects.length ? <p className="empty-list">Open a project to manage worktrees.</p> : null}</div>
    <div className="history-settings"><button type="button" className="icon-button" aria-label="T3 VSCode settings" title="T3 VSCode settings" onClick={onAppearance}><SettingsIcon size={15} /></button><span>Project checkouts and sessions</span></div>
    {picker && anchor.current && projectId ? <WorktreePopover anchor={anchor.current} title="New worktree chat" onClose={close}><div className="task-editor-fields">{state.projects.length > 1 ? <label className="task-project-select">Project<select aria-label="New worktree project" value={projectId} onChange={(event) => { const projectId = event.target.value; setProject(projectId); setChoice((previous) => ({ ...previous, baseRef: defaultWorktreeBase(state, projectId) })); }}>{state.projects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}</select></label> : null}<WorktreeChoiceFields state={state} projectId={projectId} choice={choice} onChange={setChoice} disabled={creating} />{failed ? <p className="task-status" role="alert">Could not open the chat. Your choices are kept.</p> : null}</div><footer><button type="button" disabled={creating} onClick={close}>Cancel</button><button type="button" className="primary" disabled={creating || !validWorktreeChoice(choice) || state.phase !== "ready"} onClick={() => { void create(); }}>{creating ? "Opening…" : "Open chat"}</button></footer></WorktreePopover> : null}
  </aside>;
}
