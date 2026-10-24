import { useDateTimeFormat } from "../timeFormat";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArchiveIcon, CheckIcon, MessageSquareIcon, PlusIcon, SearchIcon, PinIcon, SettingsIcon, RefreshCwIcon, XIcon, MessageCircleQuestionIcon, CircleDashedIcon, HourglassIcon, LoaderCircleIcon, ChevronRightIcon, CircleXIcon, CircleStopIcon, BotIcon, ArrowDownUpIcon, ServerIcon } from "lucide-react";
import type { HostStateSnapshot, ThreadSearchMatch, ThreadSummary } from "../../shared/bridge";
import { searchThreads } from "../../shared/composerSuggestions";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { ScheduledTaskRows } from "./ScheduledTaskList";
import { SessionSortMenu } from "./SessionSortMenu";
import { useSessionSort } from "../sessionSortPreference";
import { SESSION_SORTS } from "../../shared/sessionSort";
import { ProviderIcon } from "./ProviderIcon";
import { providerBrand } from "../../shared/usage";
import { sessionShelves, threadIsWorking as working, threadIsWaiting as waiting, waitingSummary, type SessionTreeNode } from "../../shared/sessionTree";
import { sessionActivityLabel } from "../../shared/sessionActivity";

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
  const { dateTime } = useDateTimeFormat();
  const [sort, setSort] = useSessionSort();
  const [sortOpen, setSortOpen] = useState(false);
  const sortAnchor = useRef<HTMLButtonElement>(null);
  const closeSort = useCallback(() => setSortOpen(false), []);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [openedGroups, setOpenedGroups] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Only expanded sessions that have subagents need their transcript loaded for live subagent status.
  const watchedKey = useMemo(() => {
    const parents = new Set(state.threads.flatMap((thread) => thread.relationshipToParent === "subagent" && thread.parentThreadId ? [thread.parentThreadId] : []));
    return [...new Set([...expanded].map((key) => key.slice(key.indexOf(":") + 1)))].filter((id) => parents.has(id)).slice(0, 50).join("\n");
  }, [expanded, state.threads]);
  const watchedSent = useRef<string | null>(null);
  const run = useActions();
  useEffect(() => {
    if (watchedSent.current === watchedKey) return;
    watchedSent.current = watchedKey;
    void run("watchSessions", { threadIds: watchedKey ? watchedKey.split("\n") : [] });
  }, [watchedKey, run]);
  // The chat tab's history popover unmounts when closed; its watched sessions must not stay subscribed.
  useEffect(() => () => { watchedSent.current = null; void run("watchSessions", { threadIds: [] }); }, [run]);
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
  const query = search.trim();
  const hits = useBridgeQuery<ReadonlyArray<ThreadSearchMatch>>("searchThreads", { query }, query.length >= 2 ? `${state.environment?.environmentId}:${state.archiveLoaded}:${state.workspaceRoots.join("\0")}:${query}` : null);
  const matching = useMemo(() => searchThreads(state.threads, query, new Set(hits.data?.map((hit) => hit.threadId))), [state.threads, query, hits.data]);
  const { active, settled, archived } = useMemo(() => sessionShelves(state.threads, matching, sort), [state.threads, matching, sort]);
  const row = (thread: ThreadSummary) => {
    const match = hits.data?.find((hit) => hit.threadId === thread.id);
    const provider = state.providers.find((provider) => provider.instanceId === thread.modelSelection.instanceId);
    const activity = sessionActivityLabel(thread.lastActiveAt, now, dateTime);
    const exactActivity = activity ? dateTime(new Date(thread.lastActiveAt!)) : "";
    const isWorking = working(thread);
    const isWaiting = !isWorking && waiting(thread);
    const elapsedStart = thread.backgroundWork?.startedAt ?? thread.workingStartedAt;
    return <button key={thread.id} data-thread-id={thread.id} className={`thread${thread.id === state.activeThreadId ? " active" : ""}`} onClick={(event) => { if (onSelect) onSelect(thread.id); else void run("openSessionTab", { threadId: thread.id, preview: event.detail < 2 }); }} onDoubleClick={onSelect ? undefined : () => { void run("openSessionTab", { threadId: thread.id, preview: false }); }} onContextMenu={compact ? undefined : (event) => { event.preventDefault(); setMenu({ threadId: thread.id, x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => {
      if (!compact && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ threadId: thread.id, x: box.left + 16, y: box.bottom }); }
    }} aria-label={thread.title || "Untitled"} aria-description={thread.pendingRuntimeRequest ? "Input needed" : isWorking ? "Working" : isWaiting ? waitingSummary(thread) : thread.subagentOutcome === "failed" ? "Subagent failed" : thread.subagentOutcome === "stopped" ? "Subagent stopped" : undefined} aria-current={thread.id === state.activeThreadId ? "page" : undefined}>
      <span className="thread-title-line"><span className="thread-title" title={thread.title || "Untitled"}>{thread.title || "Untitled"}</span></span>
      <span className="thread-meta">{thread.pendingRuntimeRequest ? <span className="thread-input" title={thread.pendingRuntimeRequest.kind === "user_input" ? "Input needed" : "Approval needed"} aria-label="Input needed"><MessageCircleQuestionIcon size={13} /><span>{thread.pendingRuntimeRequest.kind === "user_input" ? "Input" : "Approval"}</span></span> : isWorking ? <span className="thread-working" aria-label="Working"><CircleDashedIcon size={13} /><span>Working</span><time title={thread.workingStartedAt ?? undefined}>{elapsedLabel(thread.workingStartedAt, now)}</time></span> : isWaiting ? <span className="thread-waiting" title={waitingSummary(thread)} aria-label={waitingSummary(thread)}><HourglassIcon size={13} /><span>Waiting</span><time title={elapsedStart ?? undefined}>{elapsedLabel(elapsedStart, now)}</time></span> : thread.subagentOutcome === "failed" ? <span className="thread-outcome failed" title="Subagent failed" aria-label="Subagent failed"><CircleXIcon size={13} /><span>Failed</span></span> : thread.subagentOutcome === "stopped" ? <span className="thread-outcome stopped" title="Subagent stopped" aria-label="Subagent stopped"><CircleStopIcon size={13} /><span>Stopped</span></span> : null}{thread.environmentLabel ? <span className="thread-machine" title={`Runs on ${thread.environmentLabel}`}><ServerIcon size={12} /><span>{thread.environmentLabel}</span></span> : null}{match ? <small className="thread-match">{match.source === "user" ? "You" : "Assistant"}: {match.snippet}</small> : <small className="thread-branch">{thread.branch}</small>}{activity ? <time className="thread-age" dateTime={thread.lastActiveAt!} title={`Last active: ${exactActivity}`} aria-label={`Last active: ${exactActivity}`}>{activity}</time> : null}{thread.pinned ? <PinIcon size={12} /> : thread.relationshipToParent === "subagent" ? <BotIcon size={12} /> : <MessageSquareIcon size={12} />}<ProviderIcon brand={providerBrand(provider?.driver ?? "", provider?.displayName)} /></span>
    </button>;
  };
  const treeRow = (node: SessionTreeNode, section: string, depth = 0): ReactNode => {
    const expansionKey = `${section}:${node.thread.id}`;
    const open = !!query || expanded.has(expansionKey);
    const tasks = state.scheduledTasks?.tasks.filter((task) => task.originThreadId === node.thread.id && task.projectId === node.thread.projectId) ?? [];
    const group = (name: string, count: number, children: ReactNode, nested = false, defaultOpen = true) => <details className={`session-task-group${nested ? " nested" : ""}`} open={!!query || (defaultOpen ? !collapsedGroups.has(`${expansionKey}:${name}`) : openedGroups.has(`${expansionKey}:${name}`))} onToggle={(event) => {
      const isOpen = event.currentTarget.open; const key = `${expansionKey}:${name}`;
      if (defaultOpen) setCollapsedGroups((previous) => { if (previous.has(key) === !isOpen) return previous; const next = new Set(previous); if (isOpen) next.delete(key); else next.add(key); return next; });
      else setOpenedGroups((previous) => { if (previous.has(key) === isOpen) return previous; const next = new Set(previous); if (isOpen) next.add(key); else next.delete(key); return next; });
    }}><summary>{name}<small>{count}</small></summary>{children}</details>;
    const subagentLabel = `Subagents of ${node.thread.title || "Untitled"}`;
    const isRunning = (child: SessionTreeNode) => working(child.thread) || waiting(child.thread) || !!child.thread.pendingRuntimeRequest;
    const runningChildren = compact ? [] : node.children.filter(isRunning);
    const pastChildren = compact ? [] : node.children.filter((child) => !isRunning(child));
    const subagentRows = runningChildren.length && pastChildren.length
      ? <div className="session-tree-children" aria-label={subagentLabel}>{group("Running", runningChildren.length, <div className="session-tree-children">{runningChildren.map((child) => treeRow(child, section, depth + 1))}</div>, true)}{group("Past", pastChildren.length, <div className="session-tree-children">{pastChildren.map((child) => treeRow(child, section, depth + 1))}</div>, true, false)}</div>
      : <div className="session-tree-children" aria-label={subagentLabel}>{node.children.map((child) => treeRow(child, section, depth + 1))}{!node.children.length ? <p className="empty-list">No subagents.</p> : null}</div>;
    return <div className="session-tree-node" key={node.thread.id} data-session-depth={depth}>
      <div className="session-tree-row">{!compact || node.children.length || !state.archiveLoaded ? <button className="session-tree-toggle icon-button" aria-label={`${open ? "Collapse" : "Expand"} ${compact ? "subagents" : "session"} of ${node.thread.title || "Untitled"}`} aria-expanded={open} onClick={() => { if (!open && !state.archiveLoaded) void run("loadArchive"); setExpanded((previous) => { const next = new Set(previous); if (next.has(expansionKey)) next.delete(expansionKey); else next.add(expansionKey); return next; }); }}><ChevronRightIcon size={12} className={open ? "rotate-90" : ""} /></button> : <span className="session-tree-spacer" />}{row(node.thread)}</div>
      {open ? compact ? node.children.length ? <div className="session-tree-children" aria-label={`Subagents of ${node.thread.title || "Untitled"}`}>{node.children.map((child) => treeRow(child, section, depth + 1))}</div> : null
        : <div className="session-expanded-groups">{group("Subagents", node.children.length, subagentRows)}{group("Scheduled tasks", tasks.length, <ScheduledTaskRows state={state} tasks={tasks} />)}</div> : null}
    </div>;
  };
  return <aside className={compact ? "compact-history" : "projects-sidebar dedicated-sessions"} aria-label={compact ? "Conversation history" : "Sessions"}>
    {compact ? <div className="history-heading"><strong>History</strong><span>Current workspace</span></div> : null}
    <div className="sidebar-search-row"><label className="thread-search thread-search-with-clear"><SearchIcon size={14} /><input placeholder="Search conversations…" aria-label="Search threads" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="icon-button thread-search-clear" aria-label="Clear search" disabled={!search} style={{ visibility: search ? "visible" : "hidden" }} onClick={() => setSearch("")}><XIcon size={13} /></button></label>
      {compact ? null : <button ref={sortAnchor} className="icon-button sidebar-search-add" aria-label="Sort sessions" aria-haspopup="menu" aria-expanded={sortOpen} title={`Sort sessions: ${SESSION_SORTS.find(option => option.value === sort)!.label} (date uses last activity)`} onClick={() => { setSortOpen(!sortOpen); setMenu(null); }}><ArrowDownUpIcon size={15} /></button>}
      {/* Each tab renders its own +, so the name follows the visible list instead of a shared button mutating behind it. */}
      {compact ? null : <button className="icon-button sidebar-search-add" aria-label="New thread" title="Open New Chat in Editor Tab" onClick={() => { void run("newChatTab"); }}><PlusIcon size={15} /></button>}</div>
    {hits.pending ? <p className="search-status" role="status">Searching messages…</p> : hits.error ? <p className="search-status turn-error" role="status">{hits.error}</p> : null}
    <div className="thread-sections"><nav className="session-list" aria-label="Active conversations">
      {active.map((node) => treeRow(node, "active"))}
      {query && !active.length && !settled.length && !archived.length && !hits.pending && !hits.error ? <p className="empty-list">No matching threads.</p> : null}
      {!query && !active.length ? <p className="empty-list">No active conversations in this workspace.</p> : null}
    </nav>
    <div className="history-shelves">
      <details className="history-shelf" key={`settled:${!!query}`} open={query ? settled.length > 0 : undefined}><summary><CheckIcon size={13} /><span>Settled</span><span className="shelf-count">{settled.length}</span></summary><div>{settled.map((node) => treeRow(node, "settled"))}{!settled.length ? <p className="empty-list">No settled threads.</p> : null}</div></details>
      <details className="history-shelf" open={archiveOpen} onToggle={(event) => { const open = event.currentTarget.open; setArchiveOpen(open); if (open && !state.archiveLoaded) void run("loadArchive"); }}><summary><ArchiveIcon size={13} /><span>Archive</span><span className="shelf-count">{state.archiveLoading ? <LoaderCircleIcon size={12} className="animate-spin" aria-label="Loading archive" /> : state.archiveLoaded ? archived.length : null}</span></summary><div>{state.archiveError ? <p className="empty-list" role="status">Could not load archive. <button className="text-button" onClick={() => { void run("loadArchive"); }}>Retry</button></p> : null}{archived.map((node) => treeRow(node, "archive"))}{state.archiveLoaded && !state.archiveLoading && !state.archiveError && !archived.length ? <p className="empty-list">No archived threads.</p> : null}</div></details>
    </div></div>
    {compact ? <div className="history-picker-hint">Switch this tab · drafts stay with each conversation</div> : <div className="history-settings"><button className="icon-button" aria-label="T3 VSCode settings" title="T3 VSCode settings" onClick={onAppearance}><SettingsIcon size={15} /></button><span>Current workspace only</span><button className="icon-button" aria-label="Refresh connection" title="Reconnect" onClick={() => { void run("reconnect"); }}><RefreshCwIcon size={14} /></button></div>}
    {sortOpen && sortAnchor.current ? <SessionSortMenu anchor={sortAnchor.current} value={sort} onChange={setSort} onClose={closeSort} /> : null}
    {menu && menuThread ? <ThreadActionsMenu thread={menuThread} position={menu} onClose={closeMenu} /> : null}
  </aside>;
}
