import { useMemo, useState } from "react";
import { ArchiveIcon, FolderIcon, MessageSquareIcon, PlusIcon, SearchIcon, PinIcon, RefreshCwIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { T3Wordmark } from "./t3/T3Wordmark";

export function ThreadList({ state, onSelect }: { readonly state: HostStateSnapshot; readonly onSelect: () => void }) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const run = useActions();
  const groups = useMemo(() => state.projects.map((project) => ({ project,
    threads: state.threads.filter((thread) => thread.projectId === project.id && thread.archived === showArchived && `${thread.title} ${project.title}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
  })).filter(({ project, threads }) => threads.length || !search || project.title.toLowerCase().includes(search.toLowerCase())), [state.projects, state.threads, search, showArchived]);
  return <aside className="projects-sidebar" aria-label="Projects and threads">
    <div className="sidebar-brand"><T3Wordmark className="size-7" /><span>Code</span><button className="icon-button" aria-label="Refresh connection" title="Reconnect" onClick={() => { void run("reconnect"); }}><RefreshCwIcon size={13} /></button></div>
    <button className="new-chat" onClick={() => { void run("newThread").then((ok) => { if (ok) onSelect(); }); }}><PlusIcon size={16} /> New thread</button>
    <label className="thread-search"><SearchIcon size={14} /><input placeholder="Search threads…" aria-label="Search threads" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="sidebar-section"><span>{showArchived ? "Archive" : "Projects"}</span><button className={`icon-button${showArchived ? " selected" : ""}`} aria-label={showArchived ? "Show active threads" : "Show archived threads"} title={showArchived ? "Show active threads" : "Show archived threads"} onClick={() => { if (!showArchived) void run("loadArchive"); setShowArchived(!showArchived); }}><ArchiveIcon size={14} /></button></div>
    <nav className="project-groups">
      {groups.map(({ project, threads }) => <section className="project-group" key={project.id}>
        <div className="project-heading"><FolderIcon size={14} /><span title={project.workspaceRoot}>{project.title}</span><button className="icon-button" aria-label={`New thread in ${project.title}`} onClick={() => { void run("newThread", { projectId: project.id }).then((ok) => { if (ok) onSelect(); }); }}><PlusIcon size={13} /></button></div>
        {threads.map((thread) => <button key={thread.id} className={`thread${thread.id === state.activeThreadId ? " active" : ""}`} onClick={() => { void run("selectThread", { threadId: thread.id }).then((ok) => { if (ok) onSelect(); }); }} aria-current={thread.id === state.activeThreadId ? "page" : undefined}>
          {thread.pinned ? <PinIcon size={12} /> : <MessageSquareIcon size={12} />}
          <span className="thread-title">{thread.title || "Untitled"}</span>
          {thread.status === "running" || thread.status === "starting" || thread.status === "waiting" ? <span className={`thread-dot ${thread.status}`} title={thread.status} /> : null}
        </button>)}
        {threads.length === 0 ? <div className="no-project-threads">{showArchived ? "No archived threads" : "No threads yet"}</div> : null}
      </section>)}
      {groups.length === 0 ? <p className="empty-list">{search ? "No matching threads." : state.workspaceRoots.length ? "No conversations in this workspace yet." : "No conversations yet."}</p> : null}
    </nav>
    <footer className="sidebar-footer"><span className="connection-dot" />{state.environment?.label ?? "T3 Code"}<span className="sidebar-count">{state.threads.length}</span></footer>
  </aside>;
}
