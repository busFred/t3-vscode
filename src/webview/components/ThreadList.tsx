import { useCallback, useMemo, useState } from "react";
import { ArchiveIcon, CheckIcon, FolderIcon, MessageSquareIcon, PlusIcon, SearchIcon, PinIcon, SettingsIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot, ThreadSearchMatch, ThreadSummary } from "../../shared/bridge";
import { searchThreads } from "../../shared/composerSuggestions";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

export function ThreadList({ state, onSelect, onClose, onAppearance }: { readonly state: HostStateSnapshot; readonly onSelect: () => void; readonly onClose: () => void; readonly onAppearance: () => void }) {
  const [search, setSearch] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [menu, setMenu] = useState<{ threadId: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuThread = state.threads.find((thread) => thread.id === menu?.threadId);
  const run = useActions();
  const query = search.trim();
  const hits = useBridgeQuery<ReadonlyArray<ThreadSearchMatch>>("searchThreads", { query }, query.length >= 2 ? `${state.environment?.environmentId}:${state.archiveLoaded}:${state.workspaceRoots.join("\0")}:${query}` : null);
  const matching = useMemo(() => searchThreads(state.threads, query, new Set(hits.data?.map((hit) => hit.threadId))), [state.threads, query, hits.data]);
  const sort = (threads: ReadonlyArray<ThreadSummary>) => [...threads].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const active = matching.filter((thread) => !thread.archived && !thread.settled);
  const settled = sort(matching.filter((thread) => !thread.archived && thread.settled));
  const archived = sort(matching.filter((thread) => thread.archived));
  const row = (thread: ThreadSummary) => {
    const match = hits.data?.find((hit) => hit.threadId === thread.id);
    return <button key={thread.id} data-thread-id={thread.id} className={`thread${thread.id === state.activeThreadId ? " active" : ""}`} onClick={() => { void run("selectThread", { threadId: thread.id }).then((ok) => { if (ok) onSelect(); }); }} onContextMenu={(event) => { event.preventDefault(); setMenu({ threadId: thread.id, x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ threadId: thread.id, x: box.left + 16, y: box.bottom }); }
    }} aria-current={thread.id === state.activeThreadId ? "page" : undefined}>
      {thread.pinned ? <PinIcon size={12} /> : <MessageSquareIcon size={12} />}
      <span className="thread-text"><span className="thread-title">{thread.title || "Untitled"}</span>{match ? <small className="thread-match">{match.source === "user" ? "You" : "Assistant"}: {match.snippet}</small> : null}</span>
      {["running", "starting", "waiting"].includes(thread.status) ? <span className={`thread-dot ${thread.status}`} title={thread.status} /> : null}
    </button>;
  };
  return <aside className="projects-sidebar" aria-label="History">
    <div className="history-heading"><strong>History</strong><button className="icon-button" aria-label="Close history" onClick={onClose}><XIcon size={15} /></button></div>
    <label className="thread-search"><SearchIcon size={14} /><input placeholder="Search conversations…" aria-label="Search threads" value={search} onChange={(event) => setSearch(event.target.value)} />{search ? <button className="icon-button" aria-label="Clear search" onClick={() => setSearch("")}><XIcon size={13} /></button> : null}</label>
    {hits.pending ? <p className="search-status" role="status">Searching messages…</p> : hits.error ? <p className="search-status turn-error" role="status">{hits.error}</p> : null}
    <nav className="project-groups" aria-label="Active conversations">
      {state.projects.filter((project) => !query || active.some((thread) => thread.projectId === project.id)).map((project) => {
        const threads = sort(active.filter((thread) => thread.projectId === project.id));
        return <section className="project-group" key={project.id}>
          <div className="project-heading"><FolderIcon size={14} /><span title={project.workspaceRoot}>{project.title}</span><button className="icon-button" aria-label={`New thread in ${project.title}`} onClick={() => { void run("newThread", { projectId: project.id }).then((ok) => { if (ok) onSelect(); }); }}><PlusIcon size={13} /></button></div>
          {threads.map(row)}{!threads.length && !query ? <div className="no-project-threads">No active threads</div> : null}
        </section>;
      })}
      {query && !active.length && !settled.length && !archived.length && !hits.pending && !hits.error ? <p className="empty-list">No matching threads.</p> : null}
      {!query && !state.projects.length ? <p className="empty-list">No conversations in this workspace yet.</p> : null}
    </nav>
    <div className="history-shelves">
      <details className="history-shelf" key={`settled:${!!query}`} open={query ? settled.length > 0 : undefined}><summary><CheckIcon size={13} /><span>Settled</span><span className="shelf-count">{settled.length}</span></summary><div>{settled.map(row)}{!settled.length ? <p className="empty-list">No settled threads.</p> : null}</div></details>
      <details className="history-shelf" open={archiveOpen} onToggle={(event) => { const open = event.currentTarget.open; setArchiveOpen(open); if (open && !state.archiveLoaded) void run("loadArchive"); }}><summary><ArchiveIcon size={13} /><span>Archive</span><span className="shelf-count">{state.archiveLoaded ? archived.length : "…"}</span></summary><div>{archived.map(row)}{state.archiveLoaded && !archived.length ? <p className="empty-list">No archived threads.</p> : null}</div></details>
    </div>
    <div className="history-settings"><button className="icon-button" aria-label="T3 Code settings" title="T3 Code settings" onClick={onAppearance}><SettingsIcon size={15} /></button><button className="icon-button" aria-label="Refresh connection" title="Reconnect" onClick={() => { void run("reconnect"); }}><RefreshCwIcon size={14} /></button></div>
    {menu && menuThread ? <ThreadActionsMenu thread={menuThread} position={menu} onClose={closeMenu} /> : null}
  </aside>;
}
