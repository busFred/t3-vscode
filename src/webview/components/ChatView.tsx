import { useCallback, useEffect, useState } from "react";
import { HistoryIcon, PlusIcon, ChevronDownIcon, SettingsIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { Composer } from "./Composer";
import { ThreadList } from "./ThreadList";
import { TranscriptView } from "./TranscriptView";
import { T3Wordmark } from "./t3/T3Wordmark";
import { bridge, Events } from "../bridge-client";
import type { AssistantCitation } from "@t3tools/contracts";
import { withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { addDraftContext, updateDraft } from "../composerDrafts";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import { CitationCommentEditor } from "./CitationCommentEditor";
import type { AssistantCitationSourceAnchor } from "./t3/assistantTextSelection";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

export function ChatView({ state, onAppearance }: { readonly state: HostStateSnapshot; readonly onAppearance: () => void }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number } | null>(null);
  const closeThreadMenu = useCallback(() => setThreadMenu(null), []);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [commentTarget, setCommentTarget] = useState<{ citation: AssistantCitation; draftKey: string; index?: number; anchor?: AssistantCitationSourceAnchor } | null>(null);
  const [citationTarget, setCitationTarget] = useState<AssistantCitation | null>(null);
  useEffect(() => { setCommentTarget(null); setThreadMenu(null); }, [state.activeThreadId]);
  const run = useActions();
  useEffect(() => {
    const open = (event: Event) => {
      const citation = (event as CustomEvent<AssistantCitation>).detail;
      if (citation.environmentId !== state.environment?.environmentId) return;
      setCitationTarget(citation);
      if (citation.threadId !== state.activeThreadId) void run("selectThread", { threadId: citation.threadId }).then((ok) => { if (!ok) setCitationTarget(null); });
    };
    window.addEventListener("t3-open-citation", open); return () => window.removeEventListener("t3-open-citation", open);
  }, [run, state.activeThreadId, state.environment?.environmentId]);
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
    <main className="chat-main" data-thread-id={state.activeThreadId ?? ""} onPointerDown={(event) => { if ((event.target as Element).closest(".composer-box")) setCitationTarget(null); }} onFocusCapture={(event) => { if ((event.target as Element).closest(".composer-box")) setCitationTarget(null); }}>
      {!isSidebar ? <header className="chat-header">
        <button className="icon-button nav-toggle" title="History" aria-label="History" onClick={() => setNavigationOpen(!navigationOpen)}><HistoryIcon size={16} /></button>
        <T3Wordmark className="header-wordmark" aria-label="T3 Code" />
        <div className="chat-heading"><span className="project-label">{project?.title ?? state.environment?.label}</span><strong>{thread?.title || "New conversation"}</strong></div>
        <button className="icon-button" aria-label="T3 Code settings" title="T3 Code settings" onClick={onAppearance}><SettingsIcon size={15} /></button>
        <button className="icon-button" aria-label="New thread" title="New thread" onClick={() => { void run("newThread"); }}><PlusIcon size={16} /></button>
        {thread ? <button className="icon-button" aria-label="Thread actions" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setThreadMenu(threadMenu ? null : { x: box.right - 190, y: box.bottom + 5 }); }}><ChevronDownIcon size={14} /></button> : null}
      </header> : null}
      {threadMenu && thread ? <ThreadActionsMenu thread={thread} position={threadMenu} onClose={closeThreadMenu} /> : null}
      <TranscriptView state={state} onViewport={setViewport} citationTarget={citationTarget} />
      <AssistantSelectionToolbar viewport={viewport} onCite={(citation, anchor) => setCommentTarget({ citation, anchor, draftKey: state.activeThreadId ?? "new" })} />
      <Composer key={state.activeThreadId ?? "draft"} state={state} onEditCitation={(citation, index) => setCommentTarget({ citation, index, draftKey: state.activeThreadId ?? "new" })} />
      {commentTarget ? <CitationCommentEditor key={`${commentTarget.citation.messageId}:${commentTarget.citation.start}:${commentTarget.index ?? "new"}`} citation={commentTarget.citation} anchor={commentTarget.anchor} onClose={() => setCommentTarget(null)} onSave={(comment) => {
        const context = { type: "assistant" as const, citation: withAssistantCitationComment(commentTarget.citation, comment) };
        if (commentTarget.index === undefined) addDraftContext(commentTarget.draftKey, context);
        else updateDraft(commentTarget.draftKey, (draft) => ({ ...draft, contexts: draft.contexts.map((item, index) => index === commentTarget.index ? context : item) }));
        setCommentTarget(null); window.dispatchEvent(new CustomEvent("t3-focus-composer"));
      }} /> : null}
    </main>
  </div>;
}
