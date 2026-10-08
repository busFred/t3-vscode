import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArchiveIcon, CheckIcon, MessageSquareIcon, PlusIcon, SearchIcon, PinIcon, SettingsIcon, RefreshCwIcon, XIcon, MessageCircleQuestionIcon, CircleDashedIcon, ChevronRightIcon, BotIcon } from "lucide-react";
import type { HostStateSnapshot, ThreadSearchMatch, ThreadSummary } from "../../shared/bridge";
import { searchThreads } from "../../shared/composerSuggestions";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { ScheduledTaskRows } from "./ScheduledTaskList";
import { ProviderIcon } from "./ProviderIcon";
import { providerBrand } from "../../shared/usage";
import { sessionTree, type SessionTreeNode } from "../../shared/sessionTree";
import { sessionActivityLabel } from "../../shared/sessionActivity";

const working = (thread: ThreadSummary) => ["preparing", "running", "starting", "waiting"].includes(thread.status);
function elapsedLabel(start: string | null | undefined, now: number): string {
  if (!start || !Number.isFinite(Date.parse(start))) return "";
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds < 60 ? "<1m" : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}

export function ThreadList({ state, onAppearance, onSelect, compact = false }: {
  readonly state: HostStateSnapshot;
  readonly onAppearance?: () => void;
  readonly onSelect?: (threadId: string) => void;
  readonly compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [menu, setMenu] = useState<{ threadId: string; x: number; y: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuThread = state.threads.find((thread) => thread.id === menu?.threadId);
  const run = useActions();
  const query = search.trim();
  const hits = useBridgeQuery<ReadonlyArray<ThreadSearchMatch>>("searchThreads", { query }, query.length >= 2 ? `${state.environment?.environmentId}:${state.archiveLoaded}:${state.workspaceRoots.join("\0")}:${query}` : null);
  const matching = useMemo(() => searchThreads(state.threads, query, new Set(hits.data?.map((hit) => hit.threadId))), [state.threads, query, hits.data]);
  const activeMatches = matching.filter((thread) => !thread.archived && !thread.settled);
  const settledMatches = matching.filter((thread) => !thread.archived && thread.settled);
  const archiveMatches = matching.filter((thread) => thread.archived);
  const active = useMemo(() => sessionTree(state.threads, matching.filter((thread) => !thread.archived && !thread.settled)), [state.threads, matching]);
  const settled = useMemo(() => sessionTree(state.threads, matching.filter((thread) => !thread.archived && thread.settled)), [state.threads, matching]);
  const archived = useMemo(() => sessionTree(state.threads, matching.filter((thread) => thread.archived)), [state.threads, matching]);
  const row = (thread: ThreadSummary, context = false) => {
    const match = hits.data?.find((hit) => hit.threadId === thread.id);
    const provider = state.providers.find((provider) => provider.instanceId === thread.modelSelection.instanceId);
    const activity = sessionActivityLabel(thread.lastActiveAt, now);
    const exactActivity = activity ? new Date(thread.lastActiveAt!).toLocaleString() : "";
    return <button key={thread.id} data-thread-id={thread.id} data-shelf-context={context || undefined} className={`thread${thread.id === state.activeThreadId ? " active" : ""}`} onClick={() => { if (onSelect) onSelect(thread.id); else void run("selectThread", { threadId: thread.id }).then((ok) => { if (ok) void run("openInTab"); }); }} onContextMenu={compact ? undefined : (event) => { event.preventDefault(); setMenu({ threadId: thread.id, x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => {
      if (!compact && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ threadId: thread.id, x: box.left + 16, y: box.bottom }); }
    }} aria-label={thread.title || "Untitled"} aria-description={thread.pendingRuntimeRequest ? "Input needed" : working(thread) ? "Working" : undefined} aria-current={thread.id === state.activeThreadId ? "page" : undefined}>
      {thread.pinned ? <PinIcon size={12} /> : thread.relationshipToParent === "subagent" ? <BotIcon size={12} /> : <MessageSquareIcon size={12} />}
      <span className="thread-text"><span className="thread-title-line"><span className="thread-title">{thread.title || "Untitled"}</span>{thread.pendingRuntimeRequest ? <span className="thread-input" title={thread.pendingRuntimeRequest.kind === "user_input" ? "Input needed" : "Approval needed"} aria-label="Input needed"><MessageCircleQuestionIcon size={13} /><span>{thread.pendingRuntimeRequest.kind === "user_input" ? "Input" : "Approval"}</span></span> : working(thread) ? <span className="thread-working" aria-label="Working"><CircleDashedIcon size={13} /><span>Working</span><time title={thread.workingStartedAt ?? undefined}>{elapsedLabel(thread.workingStartedAt, now)}</time></span> : null}</span>
      <span className="thread-meta">{match ? <small className="thread-match">{match.source === "user" ? "You" : "Assistant"}: {match.snippet}</small> : <small className="thread-branch">{context ? "Parent session" : thread.branch}</small>}{activity ? <time className="thread-age" dateTime={thread.lastActiveAt!} title={`Last active: ${exactActivity}`} aria-label={`Last active: ${exactActivity}`}>{activity}</time> : null}<ProviderIcon brand={providerBrand(provider?.driver ?? "", provider?.displayName)} /></span></span>
    </button>;
  };
  const treeRow = (node: SessionTreeNode, members: ReadonlyArray<ThreadSummary>, section: string, depth = 0): ReactNode => {
    const expansionKey = `${section}:${node.thread.id}`;
    const open = !!query || expanded.has(expansionKey);
    const tasks = state.scheduledTasks?.tasks.filter((task) => task.originThreadId === node.thread.id && task.projectId === node.thread.projectId) ?? [];
    const group = (name: string, count: number, children: ReactNode) => <details className="session-task-group" open={!!query || !collapsedGroups.has(`${expansionKey}:${name}`)} onToggle={(event) => {
      const isOpen = event.currentTarget.open; setCollapsedGroups((previous) => { const next = new Set(previous); const key = `${expansionKey}:${name}`; if (isOpen) next.delete(key); else next.add(key); return next; });
    }}><summary>{name}<small>{count}</small></summary>{children}</details>;
    return <div className="session-tree-node" key={node.thread.id} data-session-depth={depth}>
      <div className="session-tree-row">{!compact || node.children.length ? <button className="session-tree-toggle icon-button" aria-label={`${open ? "Collapse" : "Expand"} ${compact ? "subagents" : "session"} of ${node.thread.title || "Untitled"}`} aria-expanded={open} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(expansionKey)) next.delete(expansionKey); else next.add(expansionKey); return next; })}><ChevronRightIcon size={12} className={open ? "rotate-90" : ""} /></button> : <span className="session-tree-spacer" />}{row(node.thread, !members.some((entry) => entry.id === node.thread.id))}</div>
      {open ? compact ? node.children.length ? <div className="session-tree-children" aria-label={`Subagents of ${node.thread.title || "Untitled"}`}>{node.children.map((child) => treeRow(child, members, section, depth + 1))}</div> : null
        : <div className="session-expanded-groups">{group("Subagents", node.children.length, <div className="session-tree-children" aria-label={`Subagents of ${node.thread.title || "Untitled"}`}>{node.children.map((child) => treeRow(child, members, section, depth + 1))}{!node.children.length ? <p className="empty-list">No subagents.</p> : null}</div>)}{group("Scheduled tasks", tasks.length, <ScheduledTaskRows state={state} tasks={tasks} />)}</div> : null}
    </div>;
  };
  return <aside className={compact ? "compact-history" : "projects-sidebar dedicated-sessions"} aria-label={compact ? "Conversation history" : "Sessions"}>
    <div className="history-heading"><strong>{compact ? "History" : "SESSIONS"}</strong>{compact ? <span>Current workspace</span> : <button className="icon-button" aria-label="New thread" title="Open New Chat in Editor Tab" onClick={() => { void run("newChatTab"); }}><PlusIcon size={15} /></button>}</div>
    <label className="thread-search"><SearchIcon size={14} /><input placeholder="Search conversations…" aria-label="Search threads" value={search} onChange={(event) => setSearch(event.target.value)} />{search ? <button className="icon-button" aria-label="Clear search" onClick={() => setSearch("")}><XIcon size={13} /></button> : null}</label>
    {hits.pending ? <p className="search-status" role="status">Searching messages…</p> : hits.error ? <p className="search-status turn-error" role="status">{hits.error}</p> : null}
    <div className="thread-sections"><nav className="session-list" aria-label="Active conversations">
      {active.map((node) => treeRow(node, activeMatches, "active"))}
      {query && !active.length && !settled.length && !archived.length && !hits.pending && !hits.error ? <p className="empty-list">No matching threads.</p> : null}
      {!query && !active.length ? <p className="empty-list">No active conversations in this workspace.</p> : null}
    </nav>
    <div className="history-shelves">
      <details className="history-shelf" key={`settled:${!!query}`} open={query ? settled.length > 0 : undefined}><summary><CheckIcon size={13} /><span>Settled</span><span className="shelf-count">{settledMatches.length}</span></summary><div>{settled.map((node) => treeRow(node, settledMatches, "settled"))}{!settled.length ? <p className="empty-list">No settled threads.</p> : null}</div></details>
      <details className="history-shelf" open={archiveOpen} onToggle={(event) => { const open = event.currentTarget.open; setArchiveOpen(open); if (open && !state.archiveLoaded) void run("loadArchive"); }}><summary><ArchiveIcon size={13} /><span>Archive</span><span className="shelf-count">{state.archiveLoaded ? archiveMatches.length : "…"}</span></summary><div>{archived.map((node) => treeRow(node, archiveMatches, "archive"))}{state.archiveLoaded && !archived.length ? <p className="empty-list">No archived threads.</p> : null}</div></details>
    </div></div>
    {compact ? <div className="history-picker-hint">Switch this tab · drafts stay with each conversation</div> : <div className="history-settings"><button className="icon-button" aria-label="T3 VSCode settings" title="T3 VSCode settings" onClick={onAppearance}><SettingsIcon size={15} /></button><span>Current workspace only</span><button className="icon-button" aria-label="Refresh connection" title="Reconnect" onClick={() => { void run("reconnect"); }}><RefreshCwIcon size={14} /></button></div>}
    {menu && menuThread ? <ThreadActionsMenu thread={menuThread} position={menu} onClose={closeMenu} /> : null}
  </aside>;
}
