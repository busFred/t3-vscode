import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, GlobeIcon, BotIcon, ArrowLeftIcon, SearchIcon, PlusIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { Composer } from "./Composer";
import { TranscriptView } from "./TranscriptView";
import type { AssistantCitation } from "@t3tools/contracts";
import { withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { readDraft, updateDraft } from "../composerDrafts";
import { insertAssistantQuote } from "../../shared/composerContext";
import type { TextSelection } from "../../shared/composerAttachments";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import { CitationCommentEditor } from "./CitationCommentEditor";
import type { AssistantCitationSourceAnchor } from "./t3/assistantTextSelection";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { SessionFind, type SearchTarget } from "./SessionFind";
import { useSearchPreferences } from "../searchPreferences";

export function ChatView({ state }: { readonly state: HostStateSnapshot }) {
  const [searchPreferences, setSearchPreferences] = useSearchPreferences(state);
  const [findOpen, setFindOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const closeFind = useCallback(() => { setFindOpen(false); setSearchTarget(null); }, []);
  useEffect(() => { setFindOpen(false); setSearchTarget(null); }, [state.activeThreadId]);
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number } | null>(null);
  const closeThreadMenu = useCallback(() => setThreadMenu(null), []);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const composerSelection = useRef<TextSelection | undefined>(undefined);
  const rememberSelection = useCallback((selection: TextSelection) => { composerSelection.current = selection; }, []);
  const [commentTarget, setCommentTarget] = useState<{ citation: AssistantCitation; draftKey: string; index?: number; selection?: TextSelection; anchor?: AssistantCitationSourceAnchor } | null>(null);
  const [citationTarget, setCitationTarget] = useState<AssistantCitation | null>(null);
  useEffect(() => { setCommentTarget(null); setThreadMenu(null); composerSelection.current = undefined; }, [state.activeThreadId]);
  const run = useActions();
  useEffect(() => {
    const open = (event: Event) => {
      const citation = (event as CustomEvent<AssistantCitation>).detail;
      if (citation.environmentId !== state.environment?.environmentId) return;
      setSearchTarget(null);
      setCitationTarget(citation);
      if (citation.threadId !== state.activeThreadId) void run("selectThread", { threadId: citation.threadId }).then((ok) => { if (!ok) setCitationTarget(null); });
    };
    window.addEventListener("t3-open-citation", open); return () => window.removeEventListener("t3-open-citation", open);
  }, [run, state.activeThreadId, state.environment?.environmentId]);
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const parent = thread?.relationshipToParent === "subagent" ? state.threads.find((entry) => entry.id === thread.parentThreadId) : undefined;
  const project = state.projects.find((item) => item.id === thread?.projectId);
  return <div className="chat-view" onKeyDownCapture={(event) => { if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f" && thread) { event.preventDefault(); event.stopPropagation(); setFindOpen(true); } }}>
    <main className="chat-main" data-reading-layout="one" data-thread-id={state.activeThreadId ?? ""} onPointerDown={(event) => { if ((event.target as Element).closest(".composer-box")) setCitationTarget(null); }} onFocusCapture={(event) => { if ((event.target as Element).closest(".composer-box")) setCitationTarget(null); }}>
      <header className="chat-header">
        <div className="chat-heading"><span className="project-label">{project?.title ?? state.draft.workspaceRoot?.split(/[\\/]/).filter(Boolean).at(-1) ?? "No project"}</span><span className="breadcrumb-divider">/</span><strong title={thread ? "Double-click to rename conversation" : undefined} onDoubleClick={thread ? (event) => {
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
          void run("threadAction", { threadId: thread.id, action: "rename" });
        } : undefined}>{thread?.title || "New conversation"}</strong></div>
        {thread ? <button className="icon-button" aria-label="Find in session" title="Find in this session (Ctrl/Cmd+F)" onClick={() => setFindOpen(!findOpen)}><SearchIcon size={15} /></button> : null}
        <button className="icon-button" aria-label="Open New Chat in Editor Tab" title="Open New Chat in Editor Tab" disabled={creating} onClick={() => { setCreating(true); void run("newChatTab").finally(() => setCreating(false)); }}><PlusIcon size={15} /></button>
        <button className="icon-button" aria-label="Open Web UI" title="Open current conversation in your default browser" onClick={() => { void run("openWebUi"); }}><GlobeIcon size={15} /></button>
        {thread ? <button className="icon-button" aria-label="Thread actions" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setThreadMenu(threadMenu ? null : { x: box.right - 190, y: box.bottom + 5 }); }}><ChevronDownIcon size={14} /></button> : null}
      </header>
      {threadMenu && thread ? <ThreadActionsMenu thread={thread} position={threadMenu} onClose={closeThreadMenu} /> : null}
      <div className="chat-reading" data-find-layout={findOpen && thread ? searchPreferences.layout : undefined}>
      {findOpen && thread ? <SessionFind key={`find:${thread.id}`} state={state} preferences={searchPreferences} onPreferences={setSearchPreferences} onClose={closeFind} onSelect={(target) => { setSearchTarget(target); if (target) setCitationTarget(null); }} /> : null}
      <div className="chat-conversation" key="conversation">
      {thread?.relationshipToParent === "subagent" ? <div className="subagent-parent-bar">{parent ? <button className="subagent-parent-link" onClick={() => { void run("selectThread", { threadId: parent.id }); }}><ArrowLeftIcon size={12} /><BotIcon size={12} /><span>Subagent of · {parent.title || "Untitled"}</span></button> : <span>Subagent conversation · parent unavailable in this workspace</span>}</div> : null}
      <TranscriptView state={state} onViewport={setViewport} citationTarget={citationTarget} searchTarget={findOpen ? searchTarget : null} onNavigate={() => { setCitationTarget(null); setSearchTarget(null); }} />
      <AssistantSelectionToolbar viewport={viewport} onCite={(citation, anchor) => {
        const draftKey = state.activeThreadId ?? "new";
        const end = readDraft(draftKey).text.length;
        setCommentTarget({ citation, anchor, draftKey, selection: composerSelection.current ?? { start: end, end } });
      }} />
      <Composer key={state.activeThreadId ?? "draft"} state={state} onSelectionChange={rememberSelection} onUsage={() => { void run("showUsage"); }} onEditCitation={(citation, index) => setCommentTarget({ citation, index, draftKey: state.activeThreadId ?? "new" })} />
      {commentTarget ? <CitationCommentEditor key={`${commentTarget.citation.messageId}:${commentTarget.citation.start}:${commentTarget.index ?? "new"}`} citation={commentTarget.citation} anchor={commentTarget.anchor} onClose={() => setCommentTarget(null)} onSave={(comment) => {
        const context = { type: "assistant" as const, citation: withAssistantCitationComment(commentTarget.citation, comment) };
        let cursor: number | undefined;
        if (commentTarget.index === undefined) {
          const inlineContext = { ...context, contextId: `quote_${crypto.randomUUID()}` };
          updateDraft(commentTarget.draftKey, (draft) => {
            const inserted = insertAssistantQuote(draft.text, inlineContext, commentTarget.selection ?? { start: draft.text.length, end: draft.text.length });
            cursor = inserted.cursor;
            return { ...draft, text: inserted.text, contexts: [...draft.contexts, inlineContext] };
          });
        } else updateDraft(commentTarget.draftKey, (draft) => ({ ...draft, contexts: draft.contexts.map((item, index) => index === commentTarget.index ? { ...item, ...context } : item) }));
        setCommentTarget(null); window.dispatchEvent(new CustomEvent("t3-focus-composer", { detail: { draftKey: commentTarget.draftKey, cursor } }));
      }} /> : null}
      </div></div>
    </main>
  </div>;
}
