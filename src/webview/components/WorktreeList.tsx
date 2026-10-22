import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GitBranchIcon, SearchIcon, XIcon, RefreshCwIcon, PlusIcon, SettingsIcon, MoreHorizontalIcon, MessageSquareIcon, CheckIcon, FolderIcon, ChevronRightIcon, BotIcon, ArchiveIcon } from "lucide-react";
import type { HostStateSnapshot, ThreadSummary } from "../../shared/bridge";
import type { WorktreeChoice } from "../../shared/worktrees";
import { useActions } from "../actions";
import { bridge } from "../bridge-client";
import { sessionShelves, threadIsWorking, type SessionTreeNode } from "../../shared/sessionTree";
import { checkoutForWorkingDirectory, checkoutPath, existingCheckoutChoice, worktreeRepositoryGroups, worktreeVisibilityScope, type RepositoryCheckout, type RepositoryGroup } from "../../shared/worktreeGroups";
import { WorktreePopover } from "./WorktreePopover";
import { WorktreeInspector } from "./WorktreeInspector";
import { WorktreeChoiceFields, validWorktreeChoice } from "./WorktreeChoice";
import { WorktreeSettings } from "./WorktreeSettings";
import { WorktreePreparation } from "./WorktreePreparation";
import { defaultWorktreeBase } from "./WorktreeDefaults";
import { WorktreeComparison, worktreeRunGroups } from "./WorktreeComparison";

function CheckoutSessions({ state, sessions, query, path }: { readonly state: HostStateSnapshot; readonly sessions: RepositoryCheckout["sessions"]; readonly query: string; readonly path: string }) {
  const run = useActions();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [subagents, setSubagents] = useState<ReadonlySet<string>>(new Set());
  const matching = query ? sessions.filter((thread) => thread.title.toLowerCase().includes(query)) : sessions;
  const shelves = sessionShelves(sessions, matching);
  const toggle = (id: string) => setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const row = (thread: ThreadSummary) => {
    const effectivePath = thread.worktreePath ?? state.projects.find((project) => project.id === thread.projectId)?.workspaceRoot;
    const items = state.worktrees?.items ?? [];
    const actualCheckout = items.find((item) => effectivePath && checkoutPath(item.path) === checkoutPath(effectivePath))?.path
      ?? items.find((item) => item.projectId === thread.projectId && item.threadIds.includes(thread.id))?.path
      ?? (!thread.worktreePath ? items.find((item) => item.projectId === thread.projectId && item.projectCheckoutPath)?.projectCheckoutPath : undefined)
      ?? (effectivePath ? checkoutForWorkingDirectory(effectivePath, items.map((item) => item.path)) : undefined);
    const checkoutHint = effectivePath && checkoutPath(actualCheckout ?? effectivePath) !== checkoutPath(path) ? `Checkout: ${effectivePath}` : undefined;
    return <button title={checkoutHint} aria-description={checkoutHint} className={`thread${thread.id === state.activeThreadId ? " active" : ""}`} data-thread-id={thread.id} aria-label={thread.title || "Untitled"} aria-current={thread.id === state.activeThreadId ? "page" : undefined} onClick={(event) => { void run("openSessionTab", { threadId: thread.id, preview: event.detail < 2 }); }} onDoubleClick={() => { void run("openSessionTab", { threadId: thread.id, preview: false }); }}><span className="thread-title-line"><span className="thread-title" title={checkoutHint ? `${thread.title || "Untitled"} · ${checkoutHint}` : thread.title || "Untitled"}>{thread.title || "Untitled"}</span></span><span className="thread-meta"><small>{thread.pendingRuntimeRequest ? "Input needed" : threadIsWorking(thread) ? (thread.waitingOnSubagents ? "Waiting on subagents" : "Working") : thread.archived ? "Archived" : thread.settled ? "Settled" : "Session"}</small>{thread.relationshipToParent === "subagent" ? <BotIcon size={12} /> : thread.settled ? <CheckIcon size={12} /> : <MessageSquareIcon size={12} />}</span></button>;
  };
  const tree = (node: SessionTreeNode, depth = 0): ReactNode => {
    const open = !!query || expanded.has(node.thread.id);
    return <div className="session-tree-node" key={node.thread.id} data-session-depth={depth}>
      <div className="session-tree-row">{node.children.length ? <button type="button" className="session-tree-toggle icon-button" aria-label={`${open ? "Collapse" : "Expand"} session of ${node.thread.title || "Untitled"}`} aria-expanded={open} onClick={() => toggle(node.thread.id)}><ChevronRightIcon size={12} className={open ? "rotate-90" : ""} /></button> : <span className="session-tree-spacer" />}{row(node.thread)}</div>
      {open && node.children.length ? <div className="session-expanded-groups"><details className="session-task-group" open={!!query || subagents.has(node.thread.id)} onToggle={(event) => { const isOpen = event.currentTarget.open; setSubagents((previous) => { const next = new Set(previous); if (isOpen) next.add(node.thread.id); else next.delete(node.thread.id); return next; }); }}><summary>Subagents<small>{node.children.length}</small></summary><div className="session-tree-children" aria-label={`Subagents of ${node.thread.title || "Untitled"}`}>{node.children.map((child) => tree(child, depth + 1))}</div></details></div> : null}
    </div>;
  };
  return <>{shelves.active.map((node) => tree(node))}{shelves.settled.length ? <details className="history-shelf" open={query ? true : undefined}><summary><CheckIcon size={13} /><span>Settled</span><small className="shelf-count">{shelves.settled.length}</small></summary>{shelves.settled.map((node) => tree(node))}</details> : null}{shelves.archived.length ? <details className="history-shelf" open={query ? true : undefined}><summary><ArchiveIcon size={13} /><span>Archive</span><small className="shelf-count">{shelves.archived.length}</small></summary>{shelves.archived.map((node) => tree(node))}</details> : null}{!shelves.active.length && !shelves.settled.length && !shelves.archived.length ? <p className="empty-list">{query ? "No matching sessions in this checkout." : "No sessions in this checkout."}</p> : null}</>;
}

function Checkout({ state, checkout, query, actionProjectId }: { readonly state: HostStateSnapshot; readonly checkout: RepositoryCheckout; readonly query: string; readonly actionProjectId?: string }) {
  const [open, setOpen] = useState(false); const anchor = useRef<HTMLButtonElement>(null); const close = useCallback(() => setOpen(false), []);
  const [selectedOwner, setOwner] = useState("");
  const source = checkout.sources.find((item) => item.projectId === (selectedOwner || actionProjectId)) ?? checkout.item;
  const item = { ...source, active: checkout.item.active, missing: checkout.item.missing, threadIds: checkout.item.threadIds };
  const run = useActions(); const { sessions } = checkout;
  const roots = sessionShelves(sessions); const count = roots.active.length + roots.settled.length + roots.archived.length;
  const settled = count > 0 && !roots.active.length && !item.active && !sessions.some(threadIsWorking);
  const opened = checkout.item.openInWindow ?? state.workspaceRoots.some((root) => { const checkout = checkoutForWorkingDirectory(root, state.worktrees?.items.map((item) => item.path) ?? []); return checkout && checkoutPath(checkout) === checkoutPath(item.path); });
  const label = item.root ? `Main checkout${item.branch ? ` · ${item.branch}` : ""}` : item.branch || `Detached checkout · ${item.head ? `${item.head.slice(0, 7)} · ` : ""}${item.path}`;
  const checkoutMatch = `${label} ${item.path}`.toLowerCase().includes(query);
  if (query && !checkoutMatch && !sessions.some((thread) => thread.title.toLowerCase().includes(query))) return null;
  return <details className="worktree-checkout history-shelf" key={`${item.id}:${!!query}`} open={query ? true : undefined} data-checkout-path={item.path}>
    <summary title={item.path}>{item.root ? <FolderIcon size={13} /> : <GitBranchIcon size={13} />}<span>{label}</span><small className="shelf-count">{[opened ? "Open" : "", item.missing ? "Missing" : item.environment?.status === "preparing" ? "Preparing" : [item.imported ? "Imported" : "", settled ? "Settled" : ""].filter(Boolean).join(" · "), String(count)].filter(Boolean).join(" · ")}</small></summary>
    <div className="worktree-checkout-tools worktree-actions"><button ref={anchor} type="button" aria-label={`Manage ${item.root ? "main checkout" : item.branch || item.path}`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontalIcon size={13} />Manage</button><button type="button" disabled={item.missing || state.phase !== "ready"} onClick={() => { void run("newWorktreeChat", { projectId: item.projectId, choice: existingCheckoutChoice(item) }); }}><PlusIcon size={12} />Chat</button></div>
    <div className="session-tree-children"><CheckoutSessions state={state} sessions={sessions} query={checkoutMatch ? "" : query} path={item.path} /></div>
    {open && anchor.current ? <WorktreePopover anchor={anchor.current} title="Checkout" onClose={close}><div className="task-editor-fields">{checkout.sources.length > 1 ? <label>Project actions and setup<select aria-label="Checkout action project" value={item.projectId} onChange={(event) => setOwner(event.target.value)}>{checkout.sources.map((source) => { const project = state.projects.find((project) => project.id === source.projectId); return <option key={source.projectId} value={source.projectId}>{project?.title ?? source.projectId} · {project?.workspaceRoot ?? source.projectRoot}</option>; })}</select></label> : null}<fieldset><WorktreeInspector key={item.projectId} state={state} item={item} /></fieldset></div></WorktreePopover> : null}
  </details>;
}

function Repository({ state, group, query, onSettings, onComparison }: { readonly state: HostStateSnapshot; readonly group: RepositoryGroup; readonly query: string; readonly onSettings: (projectId: string) => void; readonly onComparison: (projectId: string, groupId: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false); const settingsAnchor = useRef<HTMLButtonElement>(null); const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settingsProjects = group.projects.filter((project) => state.worktrees?.settings.some((settings) => settings.projectId === project.id));
  const projectIds = new Set(group.projects.map((project) => project.id));
  const preparations = state.worktrees?.preparations.filter((preparation) => projectIds.has(preparation.projectId) && (!preparation.path || !group.checkouts.some((checkout) => checkoutPath(checkout.item.path) === checkoutPath(preparation.path!)))) ?? [];
  const titleMatch = group.projects.some((project) => `${project.title} ${project.workspaceRoot}`.toLowerCase().includes(query));
  const childQuery = titleMatch ? "" : query;
  const claimed = new Set<string>();
  const runs = group.projects.flatMap((project) => worktreeRunGroups(state, project.id)).map((runGroup) => ({ ...runGroup, visibleRuns: runGroup.runs.filter(({ item }) => { const path = checkoutPath(item.path); if (claimed.has(path)) return false; claimed.add(path); return true; }) })).filter((group) => group.runs.length);
  const matched = !childQuery || group.checkouts.some(({ item, sessions }) => `${item.root ? "main checkout " : !item.branch ? "detached checkout " : ""}${item.branch} ${item.head ?? ""} ${item.path}`.toLowerCase().includes(childQuery) || sessions.some((thread) => thread.title.toLowerCase().includes(childQuery))) || runs.some((group) => group.title.toLowerCase().includes(childQuery)) || preparations.some((preparation) => preparation.title?.toLowerCase().includes(childQuery));
  if (!matched) return null;
  return <details className="worktree-repository history-shelf" open={!!query || expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} aria-label={`${group.title} checkouts`} data-repository-id={group.id}>
    <summary className="history-heading" title={group.path}><strong>{group.title}</strong><button ref={settingsAnchor} type="button" className="icon-button" aria-label={`Worktree settings for ${group.title}`} title="Worktree settings" disabled={!settingsProjects.length} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (settingsProjects.length === 1) onSettings(settingsProjects[0]!.id); else setSettingsOpen(!settingsOpen); }}><SettingsIcon size={14} /></button></summary>
    {runs.map((runGroup) => <details className="history-shelf" open key={`${runGroup.projectId}:${runGroup.id}`}><summary><span>{runGroup.title}</span><small className="shelf-count">{runGroup.runs.length} runs</small></summary><div className="worktree-checkout-tools worktree-actions"><button type="button" onClick={() => onComparison(runGroup.projectId, runGroup.id)}>Compare runs</button></div>{runGroup.visibleRuns.map(({ item }) => <Checkout key={item.path} state={state} checkout={group.checkouts.find((checkout) => checkoutPath(checkout.item.path) === checkoutPath(item.path))!} actionProjectId={runGroup.projectId} query={runGroup.title.toLowerCase().includes(query) ? "" : childQuery} />)}</details>)}
    {group.checkouts.filter((checkout) => !claimed.has(checkoutPath(checkout.item.path))).map((checkout) => <Checkout key={checkout.item.path} state={state} checkout={checkout} query={childQuery} />)}
    {preparations.filter((preparation) => !childQuery || preparation.title?.toLowerCase().includes(childQuery)).map((preparation) => <WorktreePreparation key={preparation.id} preparation={preparation} />)}
    {!group.checkouts.length && !state.worktrees?.loading ? <p className="empty-list">No checkouts available. Refresh to try again.</p> : null}
    {settingsOpen && settingsAnchor.current ? <WorktreePopover anchor={settingsAnchor.current} title="Project worktree settings" onClose={closeSettings}><div className="task-editor-fields">{settingsProjects.map((project) => <button type="button" className="text-button worktree-project-choice" key={project.id} onClick={() => { setSettingsOpen(false); onSettings(project.id); }}>{project.title}<small>{project.workspaceRoot}</small></button>)}</div></WorktreePopover> : null}
  </details>;
}

interface VisibilityPreferences { readonly [scope: string]: ReadonlyArray<string> }
function savedVisibility(): VisibilityPreferences {
  const value = bridge.readViewState<{ worktreeGroupVisibility?: unknown }>()?.worktreeGroupVisibility;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === "string")));
}

export function WorktreeList({ state, onAppearance, active = false }: { readonly state: HostStateSnapshot; readonly onAppearance: () => void; readonly active?: boolean }) {
  const run = useActions(); const [search, setSearch] = useState(""); const [selectedProject, setProject] = useState("");
  const [comparison, setComparison] = useState<{ projectId: string; groupId: string } | null>(null);
  const [settingsProject, setSettingsProject] = useState<string | null>(null); const [creating, setCreating] = useState(false); const [failed, setFailed] = useState(false); const [picker, setPicker] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null); const close = useCallback(() => setPicker(false), []);
  const projectId = state.projects.some((project) => project.id === selectedProject) ? selectedProject : state.threads.find((thread) => thread.id === state.activeThreadId)?.projectId ?? state.draft.projectId ?? state.projects[0]?.id;
  const [choice, setChoice] = useState<WorktreeChoice>({ type: "new", baseRef: "main" });
  useEffect(() => { if (active && state.phase === "ready") void run("refreshWorktrees", { cleanupEnvironments: true }); }, [active, state.phase, run]);
  const [visibility, setVisibility] = useState<VisibilityPreferences>(savedVisibility);
  const [visibilityOpen, setVisibilityOpen] = useState(false); const visibilityAnchor = useRef<HTMLButtonElement>(null); const closeVisibility = useCallback(() => setVisibilityOpen(false), []);
  const scope = worktreeVisibilityScope(state); const hidden = new Set(visibility[scope] ?? []);
  const repositoryGroups = worktreeRepositoryGroups(state); const visibleGroups = repositoryGroups.filter((group) => !hidden.has(group.id));
  const setGroupVisible = (id: string, visible: boolean) => {
    const nextHidden = new Set(hidden); if (visible) nextHidden.delete(id); else nextHidden.add(id);
    const next = { ...visibility, [scope]: [...nextHidden] }; setVisibility(next);
    bridge.saveViewState({ ...bridge.readViewState<Record<string, unknown>>(), worktreeGroupVisibility: next });
  };
  const comparisonGroup = comparison ? worktreeRunGroups(state, comparison.projectId).find((group) => group.id === comparison.groupId) : undefined;
  if (comparisonGroup) return <WorktreeComparison key={comparisonGroup.id} state={state} group={comparisonGroup} onClose={() => setComparison(null)} />;
  const settings = state.worktrees?.settings.find((item) => item.projectId === settingsProject);
  if (settings) return <WorktreeSettings key={settings.projectId} state={state} settings={settings} onClose={() => setSettingsProject(null)} />;
  const query = search.trim().toLowerCase();
  const hasMatches = !query || visibleGroups.some((group) => group.projects.some((project) => `${project.title} ${project.workspaceRoot}`.toLowerCase().includes(query)) || group.checkouts.some(({ item, sessions }) => `${item.root ? "main checkout " : !item.branch ? "detached checkout " : ""}${item.branch} ${item.head ?? ""} ${item.path}`.toLowerCase().includes(query) || sessions.some((thread) => thread.title.toLowerCase().includes(query))) || state.worktrees?.preparations.some((preparation) => group.projects.some((project) => project.id === preparation.projectId) && preparation.title?.toLowerCase().includes(query)));
  const create = async () => {
    if (!projectId || creating || !validWorktreeChoice(choice)) return;
    setCreating(true); setFailed(false); const ok = await run("newWorktreeChat", { projectId, choice }); setCreating(false); if (ok) close(); else setFailed(true);
  };
  return <aside className="projects-sidebar worktree-sidebar" aria-label="Worktrees">
    <div className="sidebar-search-row"><label className="thread-search thread-search-with-clear"><SearchIcon size={14} /><input aria-label="Search worktrees and sessions" placeholder="Search worktrees…" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" className="icon-button thread-search-clear" disabled={!search} aria-label="Clear worktree search" style={{ visibility: search ? "visible" : "hidden" }} onClick={() => setSearch("")}><XIcon size={13} /></button></label>
      <button type="button" className="icon-button sidebar-search-add" aria-label="Refresh worktrees" disabled={state.worktrees?.loading || state.phase !== "ready"} onClick={() => { void run("refreshWorktrees", { cleanupEnvironments: true }); }}><RefreshCwIcon size={15} className={state.worktrees?.loading ? "animate-spin" : undefined} /></button><button ref={anchor} type="button" className="icon-button sidebar-search-add" aria-label="New worktree chat" aria-expanded={picker} disabled={!projectId || state.phase !== "ready"} onClick={() => { if (!picker) { const defaults = state.worktrees?.settings.find((item) => item.projectId === projectId); setChoice({ type: "new", baseRef: defaultWorktreeBase(state, projectId!), startFromOrigin: defaults?.startFromOrigin ?? false, copyEnv: defaults?.copyEnv ?? false }); } setPicker(!picker); setFailed(false); }}><PlusIcon size={15} /></button></div>
    {state.worktrees?.loading && !state.worktrees.items.length && !state.worktrees.preparations.length ? <p className="search-status" role="status">Loading worktrees…</p> : null}{state.worktrees?.error ? <p className="search-status turn-error" role="alert">{state.worktrees.error}</p> : null}{state.phase !== "ready" ? <p className="empty-list" role="status">Connect to T3 to manage worktrees.</p> : null}
    <div className="worktree-list" aria-busy={state.worktrees?.loading || undefined}>{!hasMatches ? <p className="empty-list">No matching worktrees or sessions.</p> : null}{visibleGroups.map((group) => <Repository key={group.id} state={state} group={group} query={query} onSettings={setSettingsProject} onComparison={(projectId, groupId) => setComparison({ projectId, groupId })} />)}{repositoryGroups.length && !visibleGroups.length ? <p className="empty-list">All repository groups are hidden.</p> : null}{!state.projects.length ? <p className="empty-list">Open a project to manage worktrees.</p> : null}</div>
    <div className="history-settings"><button type="button" className="icon-button" aria-label="T3 VSCode settings" title="T3 VSCode settings" onClick={onAppearance}><SettingsIcon size={15} /></button><button ref={visibilityAnchor} type="button" className="worktree-group-visibility" aria-label="Visible repository groups" title="Show or hide repository groups" aria-haspopup="dialog" aria-expanded={visibilityOpen} onClick={() => setVisibilityOpen(!visibilityOpen)}>Groups</button></div>
    {visibilityOpen && visibilityAnchor.current ? <WorktreePopover anchor={visibilityAnchor.current} title="Visible repository groups" onClose={closeVisibility}><div className="task-editor-fields">{repositoryGroups.map((group) => <label className="task-enabled worktree-group-option" key={group.id}><input type="checkbox" checked={!hidden.has(group.id)} onChange={(event) => setGroupVisible(group.id, event.target.checked)} /><span>{group.title}<small>{group.path}</small></span></label>)}{!repositoryGroups.length ? <p className="empty-list">Open a project to manage repository groups.</p> : null}</div></WorktreePopover> : null}
    {picker && anchor.current && projectId ? <WorktreePopover anchor={anchor.current} title="New worktree chat" onClose={close}><div className="task-editor-fields">{state.projects.length > 1 ? <label className="task-project-select">Project<select aria-label="New worktree project" value={projectId} onChange={(event) => { const projectId = event.target.value; setProject(projectId); setChoice((previous) => ({ ...previous, baseRef: defaultWorktreeBase(state, projectId) })); }}>{state.projects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}</select></label> : null}<WorktreeChoiceFields state={state} projectId={projectId} choice={choice} onChange={setChoice} disabled={creating} />{failed ? <p className="task-status" role="alert">Could not open the chat. Your choices are kept.</p> : null}</div><footer><button type="button" disabled={creating} onClick={close}>Cancel</button><button type="button" className="primary" disabled={creating || !validWorktreeChoice(choice) || state.phase !== "ready"} onClick={() => { void create(); }}>{creating ? "Opening…" : "Open chat"}</button></footer></WorktreePopover> : null}
  </aside>;
}
