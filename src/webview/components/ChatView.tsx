import { useEffect, useState } from "react";
import { PanelLeftIcon, PlusIcon, ChevronDownIcon, PinIcon, ArchiveIcon, PencilIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { Composer } from "./Composer";
import { ThreadList } from "./ThreadList";
import { TranscriptView } from "./TranscriptView";
import { T3Wordmark } from "./t3/T3Wordmark";
import { bridge, Events } from "../bridge-client";

export function ChatView({ state }: { readonly state: HostStateSnapshot }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const run = useActions();
  const isSidebar = document.body.dataset.surface === "sidebar";
  useEffect(() => bridge.on(Events.showNavigation, () => setNavigationOpen((open) => !open)), []);
  useEffect(() => {
    if (!navigationOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setNavigationOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navigationOpen]);
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const project = state.projects.find((item) => item.id === thread?.projectId);
  return <div className={`chat-view${navigationOpen ? " navigation-open" : ""}`}>
    {navigationOpen ? <button className="navigation-backdrop" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} /> : null}
    <ThreadList state={state} onSelect={() => setNavigationOpen(false)} />
    <main className="chat-main">
      {!isSidebar ? <header className="chat-header">
        <button className="icon-button nav-toggle" title="Projects and threads" aria-label="Projects and threads" onClick={() => setNavigationOpen(!navigationOpen)}><PanelLeftIcon size={16} /></button>
        <T3Wordmark className="header-wordmark" aria-label="T3 Code" />
        <div className="chat-heading"><span className="project-label">{project?.title ?? state.environment?.label}</span><strong>{thread?.title || "New conversation"}</strong></div>
        <button className="icon-button" aria-label="New thread" title="New thread" onClick={() => { void run("newThread"); }}><PlusIcon size={16} /></button>
        {thread ? <details className="thread-menu"><summary className="icon-button" aria-label="Thread actions"><ChevronDownIcon size={14} /></summary>
          <div className="menu-popup">
            <button onClick={() => { setTitle(thread.title); setRenaming(true); }}><PencilIcon size={14} /> Rename thread</button>
            <button onClick={() => { void run("threadAction", { threadId: thread.id, action: thread.pinned ? "unpin" : "pin" }); }}><PinIcon size={14} /> {thread.pinned ? "Unpin" : "Pin"} thread</button>
            <button onClick={() => { void run("threadAction", { threadId: thread.id, action: thread.archived ? "unarchive" : "archive" }); }}><ArchiveIcon size={14} /> {thread.archived ? "Restore" : "Archive"} thread</button>
          </div>
        </details> : null}
      </header> : null}
      {renaming && thread ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void run("threadAction", { threadId: thread.id, action: "rename", title }).then((ok) => { if (ok) setRenaming(false); }); }}>
        <input autoFocus aria-label="Thread title" value={title} onChange={(event) => setTitle(event.target.value)} /><button className="btn primary" type="submit">Save</button><button type="button" className="icon-button" aria-label="Cancel rename" onClick={() => setRenaming(false)}><XIcon size={14} /></button>
      </form> : null}
      <TranscriptView state={state} />
      <Composer key={state.activeThreadId ?? "draft"} state={state} />
    </main>
  </div>;
}
