import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LegendList, type LegendListRef, type OnViewableItemsChangedInfo } from "@legendapp/list/react";
import type { AssistantCitation } from "@t3tools/contracts";
import { BrainIcon, CheckIcon, ChevronRightIcon, CopyIcon, FileIcon, GitForkIcon, GlobeIcon, SearchIcon, TerminalIcon, WrenchIcon, ArrowRightLeftIcon, MinusIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot, TranscriptItem, WireTurnItem } from "../../shared/bridge";
import { useActions } from "../actions";
import { getQuestionAnswerText } from "@t3tools/client-runtime/work-log/user-input";
import { ChatMarkdown } from "./ChatMarkdown";
import { WorkLogBlock, WorkLogButton, WorkLogDetails } from "./t3/WorkLog";
import { TimelineSystemDivider } from "./t3/TimelineSystemDivider";
import { T3Wordmark } from "./t3/T3Wordmark";
import { T3VSCodeIcon } from "./T3VSCodeIcon";
import { findAssistantCitationSourceAnchor } from "./t3/assistantTextSelection";
import { TurnChanges } from "./TurnChanges";
import { MessageNavigator } from "./MessageNavigator";
import { messageExchanges } from "../../shared/messageNavigation";
import { transcriptRows, workSummary, workElapsed, responseBoundaries, isWorkItem, type DisplayRow } from "../../shared/transcriptRows";
import { htmlVisual } from "../../shared/chatVisuals";
import { HtmlVisual } from "./HtmlVisual";
import { ChatMedia } from "./ChatMedia";
import { SubagentCard, SubagentState } from "./SubagentCard";
import { useContext } from "react";
import { SearchTargetContext, type SearchTarget } from "./SessionFind";
import { highlightSearchResult } from "../searchHighlight";

function CopyButton({ text }: { text: string }) {
  const run = useActions(); const [copied, setCopied] = useState(false);
  return <button className="icon-button copy-button" title="Copy message" aria-label="Copy message" onClick={() => { void run("copyText", { text }).then(setCopied); }}>{copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}</button>;
}
function ForkButton({ row, threadId }: { row: TranscriptItem; threadId: string }) {
  const run = useActions(); const [busy, setBusy] = useState(false);
  if (!row.canFork) return null;
  return <button className="icon-button fork-button" title="Fork from this response" aria-label="Fork from this response" disabled={busy} onClick={() => {
    setBusy(true); void run("forkFromResponse", { threadId, sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? row.item.id }).finally(() => setBusy(false));
  }}><GitForkIcon size={13} /></button>;
}
function Disclosure({ label, icon, children, row, threadId }: { label: string; icon: ReactNode; children: ReactNode; row: TranscriptItem; threadId: string }) {
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false);
  const target = useContext(SearchTargetContext);
  useEffect(() => { if (target?.rowKey === row.key) setOpen(true); }, [target, row.key]);
  const run = useActions();
  const toggle = () => {
    setOpen(!open);
    if (!open && row.needsDetail && !loading) {
      setLoading(true);
      void run("loadItemDetail", { threadId, sourceThreadId: row.sourceThreadId, itemId: row.item.id }).finally(() => setLoading(false));
    }
  };
  return <WorkLogBlock><div className={`work-entry ${row.item.status}`}>
    <WorkLogButton icon={icon} label={label} aria-expanded={open} onClick={toggle}
      trailing={<><span className="work-status">{row.item.status === "running" ? "Running" : row.item.status === "failed" ? "Failed" : row.item.status === "cancelled" || row.item.status === "interrupted" ? "Stopped" : row.item.status === "completed" ? "Completed" : ""}</span><ChevronRightIcon size={13} className={open ? "rotate-90" : ""} /></>} />
    {open ? <WorkLogDetails>{loading ? <span>Loading details…</span> : children}</WorkLogDetails> : null}
  </div></WorkLogBlock>;
}
function Diff({ text }: { text: string }) {
  return <pre className="diff"><code>{text.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : line.startsWith("@@") ? "diff-hunk" : ""}>{line}{"\n"}</span>)}</code></pre>;
}
function FileChange({ item, threadId }: { item: Extract<WireTurnItem, { type: "file_change" }>; threadId: string }) {
  const run = useActions();
  return <div className="file-change"><div className="file-change-heading"><FileIcon size={13} /><button className="text-button" onClick={() => { void run("openLink", { href: item.fileName, threadId }); }}>{item.fileName}</button>
    <span className="file-counts"><span className="addition">+{item.additions ?? 0}</span><span className="deletion">−{item.deletions ?? 0}</span></span></div>
    {item.diffStr ? <Diff text={item.diffStr} /> : item.oldStr !== undefined || item.newStr !== undefined ? <Diff text={[...(item.oldStr?.split("\n").map((line) => `-${line}`) ?? []), ...(item.newStr?.split("\n").map((line) => `+${line}`) ?? [])].join("\n")} /> : <p className="subtle">File change recorded.</p>}
  </div>;
}
function DynamicTool({ row, threadId }: { row: TranscriptItem; threadId: string }) {
  const run = useActions(); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setBusy(true); setFailed(false);
    void run("loadItemDetail", { threadId, sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? row.item.id }).then((ok) => setFailed(!ok)).finally(() => setBusy(false));
  }, [run, threadId, row.sourceThreadId, row.sourceItemId, row.item.id]);
  const knownVisual = row.item.type === "dynamic_tool" && row.item.status === "completed" && /(?:^|[._])html_render$/.test(row.item.toolName ?? "");
  useEffect(() => { if (knownVisual && row.needsDetail) load(); }, [knownVisual, row.needsDetail, load]);
  if (row.item.type !== "dynamic_tool") return null;
  const visual = htmlVisual(row.item);
  if (visual) return <HtmlVisual visual={visual} threadId={threadId} source={{ sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? row.item.id }} />;
  if (knownVisual && row.needsDetail) return <div className="visual-loading" role="status">{busy ? "Loading visualization…" : "Visualization is unavailable."}{!busy ? <button className="text-button" onClick={load}>{failed ? "Retry" : "Load visualization"}</button> : null}</div>;
  if (row.item.viewedImagePath) return <ChatMedia src={row.item.viewedImagePath} alt="Viewed image" threadId={threadId} source={{ sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? row.item.id }} />;
  return <Disclosure label={row.toolLabel ?? row.item.title ?? row.item.toolName ?? "Tool"} icon={<WrenchIcon size={14} />} row={row} threadId={threadId}><pre className="command-input">{typeof row.item.input === "string" ? row.item.input : JSON.stringify(row.item.input, null, 2)}</pre>{row.output ? <pre className="tool-output">{row.output}</pre> : <span className="subtle">{row.needsDetail ? "Expand again to retry loading output." : "No output."}</span>}</Disclosure>;
}
function WorkGroup({ rows, threadId, environmentId }: { rows: ReadonlyArray<TranscriptItem>; threadId: string; environmentId: string }) {
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now);
  const running = rows.filter(row => row.item.status === "running" || row.item.status === "pending").length;
  useEffect(() => { if (!running) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [running]);
  const label = workElapsed(rows, now), description = workSummary(rows);
  const target = useContext(SearchTargetContext);
  useEffect(() => { if (target && rows.some((row) => row.key === target.rowKey)) setOpen(true); }, [target, rows]);
  const failures = rows.filter((row) => row.item.status === "failed").length;
  return <section className="work-group"><button className="work-group-toggle" aria-label={`${label} · ${description}`} title={description} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronRightIcon size={13} className={open ? "rotate-90" : ""} /><span>{label}</span>{running ? <span className="work-running">{running} running</span> : null}{failures ? <span className="work-group-failures">{failures} failed</span> : null}</button>
    {open ? <div className="work-group-items">{rows.map((row) => <TurnItem key={row.key} row={row} threadId={threadId} environmentId={environmentId} />)}</div> : null}
  </section>;
}
const TurnItem = memo(function TurnItem(props: { row: TranscriptItem; threadId: string; environmentId: string }) {
  const target = useContext(SearchTargetContext);
  return <div data-search-row={props.row.key} className={target?.rowKey === props.row.key ? "session-match-row" : undefined}><TurnContent {...props} /></div>;
});
const TurnContent = memo(function TurnContent({ row, threadId, environmentId }: { row: TranscriptItem; threadId: string; environmentId: string }) {
  const { item } = row; const run = useActions();
  const assetSource = { sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? row.item.id };
  const markdown = (text: string) => <ChatMarkdown text={text} threadId={threadId} assetSource={assetSource} {...(item.type === "user_message" ? { context: item.context, attachments: item.attachments } : {})} />;
  const openThread = (id: string) => { void run("selectThread", { threadId: id }); };
  switch (item.type) {
    case "user_message": return <article className="message user-message" data-item-type={item.type}><div className="user-bubble">{item.inputIntent === "steer" ? <span className="steer-label">↪ Steer</span> : null}{item.attachments.length ? <div className="attachments">{item.attachments.map((attachment, index) => /^(image|video|audio)\//.test(attachment.mimeType) ? <div className="attachment-thumbnail" key={attachment.id}><ChatMedia src={attachment.name} alt={attachment.name} threadId={threadId} source={assetSource} attachmentId={attachment.id} kind={attachment.mimeType.startsWith("video/") ? "video" : attachment.mimeType.startsWith("audio/") ? "audio" : "image"} /><span>{attachment.name}</span></div> : <span key={index}><FileIcon size={12} />{attachment.name}</span>)}</div> : null}{markdown(item.text)}</div><CopyButton text={item.text} /></article>;
    case "assistant_message": return <article className="message assistant-message" data-item-type={item.type}>
      {!item.runId ? <AssistantHeader /> : null}
      {!row.canFork ? <div className="response-actions message-copy"><CopyButton text={item.text} /></div> : null}
      <ChatMarkdown text={item.text} threadId={threadId} source={{ environmentId, threadId: row.sourceThreadId, messageId: item.messageId }} assetSource={assetSource} streaming={item.streaming} />
    </article>;
    case "reasoning": return <Disclosure label={item.streaming ? "Thinking…" : "Thought process"} icon={<BrainIcon size={14} />} row={row} threadId={threadId}>{markdown(item.text)}</Disclosure>;
    case "proposed_plan": return <section className="plan-card"><header><span className="plan-badge">Plan</span><strong>Proposed plan</strong><CopyButton text={item.markdown} /></header>{markdown(item.markdown)}</section>;
    case "todo_list": return <section className="todo-card">{item.explanation ? <p>{item.explanation}</p> : null}{item.steps.map((step, index) => <div key={index} className={`todo-step ${step.status}`}><span>{step.status === "completed" ? "✓" : step.status === "running" ? "◉" : "○"}</span><span>{step.text}</span></div>)}</section>;
    case "command_execution": return <Disclosure label={item.title ?? item.input.split("\n")[0] ?? "Command"} icon={<TerminalIcon size={14} />} row={row} threadId={threadId}><pre className="command-input">{item.input}</pre>{row.output ? <pre className="tool-output">{row.output}</pre> : <span className="subtle">{row.needsDetail ? "Expand again to retry loading output." : "No output."}</span>}{item.exitCode !== undefined ? <span className="subtle">Exit code {item.exitCode}</span> : null}</Disclosure>;
    case "dynamic_tool": return <DynamicTool row={row} threadId={threadId} />;
    case "file_change": return <Disclosure label={item.title ?? `Edited ${item.fileName}`} icon={<FileIcon size={14} />} row={row} threadId={threadId}><FileChange item={item} threadId={threadId} /></Disclosure>;
    case "file_search": return <Disclosure label={item.title ?? `Searched files${item.pattern ? `: ${item.pattern}` : ""}`} icon={<SearchIcon size={14} />} row={row} threadId={threadId}>{item.results?.map((result, index) => <div className="search-result" key={index}><button className="text-button" onClick={() => { void run("openLink", { href: `${result.fileName}${result.line ? `:${result.line}` : ""}`, threadId }); }}>{result.fileName}{result.line ? `:${result.line}` : ""}</button>{result.preview ? <pre>{result.preview}</pre> : null}</div>)}</Disclosure>;
    case "web_search": return <Disclosure label={item.title ?? `Searched the web${item.patterns?.length ? `: ${item.patterns.join(", ")}` : ""}`} icon={<GlobeIcon size={14} />} row={row} threadId={threadId}>{item.results?.map((result, index) => <div className="search-result" key={index}><button className="text-button" onClick={() => { if (result.url) void run("openLink", { href: result.url }); }}>{result.title ?? result.url ?? "Search result"}</button>{result.snippet ? <p>{result.snippet}</p> : null}</div>)}</Disclosure>;
    case "approval_request": return <TimelineSystemDivider label={item.status === "waiting" || item.status === "pending" ? "Approval requested" : "Approval handled"} detail={item.prompt} />;
    case "user_input_request": return <section className="question-history">{item.questions.map((question) => <div key={question.id}><strong>{question.question}</strong>{item.questionAnswer?.answers[question.id] !== undefined ? <p>{getQuestionAnswerText(item.questionAnswer.answers[question.id])}</p> : <p className="subtle">{item.status === "pending" || item.status === "waiting" ? "Answer below to continue." : item.status}</p>}</div>)}</section>;
    case "checkpoint": return <TurnChanges row={row} threadId={threadId} />;
    case "run_interrupt_request": return <TimelineSystemDivider label="Interrupt requested" detail={item.message} tone="danger" icon={XIcon} />;
    case "run_interrupt_result": return <TimelineSystemDivider label="Run interrupted" detail={item.message} tone="danger" icon={XIcon} />;
    case "system_notice": return <TimelineSystemDivider label={item.message} />;
    case "error": return <div className="turn-error" role="status">{item.failure.message}</div>;
    case "compaction": return <TimelineSystemDivider label={item.status === "running" ? "Compacting context" : "Context compacted"} detail={item.summary} icon={MinusIcon} />;
    case "handoff": return <TimelineSystemDivider label="Context handoff" detail={item.summary ?? item.toProviderInstanceId} icon={ArrowRightLeftIcon} />;
    case "fork": return <TimelineSystemDivider label="Conversation fork" icon={GitForkIcon} actionLabel="Open related thread" onAction={() => openThread(item.source.type === "run" ? item.source.threadId : item.targetThreadId)} />;
    case "thread_created": return <TimelineSystemDivider label={item.title ?? "Created thread"} actionLabel="Open thread" onAction={() => openThread(item.targetThreadId)} />;
    case "subagent": return <SubagentCard row={{ ...row, item }} />;
    case "notification": return <section className="notification">{markdown(item.detail ? `${item.summary}\n\n${item.detail}` : item.summary)}</section>;
  }
});

function AssistantHeader({ working = false, headerKey }: { working?: boolean; headerKey?: string }) {
  return <div className="message-author response-header" data-run-header={headerKey}><T3Wordmark className="size-5" /><span>Assistant</span>{working ? <span className="working-label" role="status">· Working</span> : null}</div>;
}

export function TranscriptView({ state, onViewport, citationTarget, searchTarget, onNavigate }: { readonly state: HostStateSnapshot; readonly onViewport?: (element: HTMLDivElement | null) => void; readonly citationTarget?: AssistantCitation | null; readonly searchTarget?: SearchTarget | null; readonly onNavigate?: () => void }) {
  const run = useActions();
  const id = state.activeThreadId;
  const list = useRef<LegendListRef>(null);
  const rows = useMemo(() => transcriptRows(state.transcript), [state.transcript]);
  const boundaries = useMemo(() => responseBoundaries(state.transcript), [state.transcript]);
  const thread = state.threads.find(thread => thread.id === id);
  const activeRun = thread?.activeRunId ?? state.queue?.activeRunId ?? (state.acknowledgedWorking ? state.transcript.find(row => row.item.type === "user_message" && row.item.messageId === state.acknowledgedWorking?.messageId)?.item.runId : null);
  const working = !!(activeRun || state.acknowledgedWorking);
  const activeHeader = activeRun ? boundaries.get(`${id}:${activeRun}`)?.first : undefined;
  const container = useRef<HTMLDivElement | null>(null), firstVisible = useRef(0);
  const [sticky, setSticky] = useState(false);
  const updateSticky = useCallback(() => {
    const viewport = container.current;
    if (!working || !activeHeader || !viewport) { setSticky(false); return; }
    const heading = viewport.querySelector<HTMLElement>(`[data-run-header="${CSS.escape(activeHeader)}"]`);
    setSticky(heading ? heading.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().top : rows.findIndex(row => row.rows.some(item => item.key === activeHeader)) < firstVisible.current);
  }, [working, activeHeader, rows]);
  useEffect(() => { const frame = requestAnimationFrame(updateSticky); return () => cancelAnimationFrame(frame); }, [updateSticky]);
  const exchanges = useMemo(() => messageExchanges(state.transcript), [state.transcript]);
  const [viewedKey, setViewedKey] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(true); const [followEnd, setFollowEnd] = useState(true);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const visible = useCallback((info: OnViewableItemsChangedInfo<DisplayRow>) => {
    const first = info.viewableItems.reduce<DisplayRow | null>((first, entry) => !first || entry.item.firstIndex < first.firstIndex ? entry.item : first, null);
    if (first) { setViewedKey(first.key); firstVisible.current = rows.findIndex(row => row.key === first.key); }
    requestAnimationFrame(updateSticky);
  }, [rows, updateSticky]);
  useEffect(() => { setViewedKey(null); setAtEnd(true); setFollowEnd(true); setNavigationNotice(null); }, [id]);
  const jump = useCallback((key: string) => {
    const index = rows.findIndex((row) => row.key === key); if (index < 0) return;
    onNavigate?.(); setFollowEnd(false); setNavigationNotice(null); setViewedKey(key);
    void list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.08 }).catch(() => setNavigationNotice("Could not jump to this message. Try again."));
  }, [rows, onNavigate]);
  const latest = () => {
    onNavigate?.(); setFollowEnd(true); setNavigationNotice(null);
    const current = list.current;
    void current?.scrollToEnd({ animated: false }).then(() => {
      if (current !== list.current) return;
      // Rich rows can finish measuring after the virtual list chose its target.
      // Finish at the actual DOM bottom instead of an earlier estimated offset.
      const node: unknown = current.getScrollableNode();
      if (node instanceof HTMLElement) node.scrollTop = node.scrollHeight;
    }).catch(() => setNavigationNotice("Could not jump to the latest message. Try again."));
  };
  const attempts = useRef<{ target: AssistantCitation | null; pages: number }>({ target: null, pages: 0 });
  const [citationNotice, setCitationNotice] = useState<string | null>(null);
  const sourceIndex = citationTarget ? rows.findIndex((group) => group.rows.some((row) => row.sourceThreadId === citationTarget.threadId && row.item.type === "assistant_message" && row.item.messageId === citationTarget.messageId)) : -1;
  const matchIndex = searchTarget && searchTarget.threadId === id ? rows.findIndex((group) => group.rows.some((row) => row.key === searchTarget.rowKey)) : -1;
  useEffect(() => {
    CSS.highlights?.delete("t3-session-match");
    if (!searchTarget || searchTarget.threadId !== id || matchIndex < 0) return;
    setFollowEnd(false); setNavigationNotice(null); setViewedKey(rows[matchIndex]!.key);
    let stopped = false, frame = 0, attempts = 0;
    void list.current?.scrollToIndex({ index: matchIndex, animated: false, viewPosition: 0.3 }).catch(() => { if (!stopped) setNavigationNotice("Could not open the search result. Select it again to retry."); });
    const show = () => {
      if (stopped) return;
      const element = document.querySelector<HTMLElement>(`[data-search-row="${CSS.escape(searchTarget.rowKey)}"]`);
      if (element && highlightSearchResult(element, searchTarget)) return;
      if (++attempts < 25) frame = requestAnimationFrame(show);
      else if (element) { element.scrollIntoView({ block: "center" }); setNavigationNotice("Match found in recorded text or source; see the search result for the exact text."); }
    };
    frame = requestAnimationFrame(show);
    return () => { stopped = true; cancelAnimationFrame(frame); CSS.highlights?.delete("t3-session-match"); };
  }, [searchTarget, id, matchIndex]);
  useEffect(() => {
    if (!citationTarget || citationTarget.threadId !== id) return;
    if (attempts.current.target !== citationTarget) { attempts.current = { target: citationTarget, pages: 0 }; setCitationNotice(null); }
    if (sourceIndex < 0) {
      if (state.threadLoading) return;
      if (state.history.hasMore && attempts.current.pages < 20) {
        if (!state.history.loading) { attempts.current.pages += 1; void run("loadHistory", { threadId: id }); }
      } else setCitationNotice("The source response is unavailable. Your saved quote is unchanged.");
      return;
    }
    setCitationNotice(null);
    let stopped = false; let frame = 0;
    // A new list's initial scroll can supersede scrollToIndex's completion.
    // Source matching uses its rendered DOM instead of waiting on that promise.
    void list.current?.scrollToIndex({ index: sourceIndex, animated: false, viewPosition: 0.25 }).catch(() => { if (!stopped) setCitationNotice("Could not open the source response. Your saved quote is unchanged."); });
    let checks = 0;
    const show = () => {
      if (stopped) return;
      const anchor = findAssistantCitationSourceAnchor(document, citationTarget);
      if (!anchor && ++checks < 20) { frame = requestAnimationFrame(show); return; }
      if (anchor) {
        anchor.range.startContainer.parentElement?.scrollIntoView({ block: "center" });
        if (typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.set("t3-assistant-citation", new Highlight(anchor.range));
      } else setCitationNotice("The quoted text has changed. Your saved quote is unchanged.");
    };
    frame = requestAnimationFrame(show);
    return () => { stopped = true; cancelAnimationFrame(frame); CSS.highlights?.delete("t3-assistant-citation"); };
  }, [citationTarget, id, sourceIndex, state.threadLoading, state.history.hasMore, state.history.loading, state.transcript.length, run]);
  const viewportRef = useCallback((element: HTMLDivElement | null) => { container.current = element; onViewport?.(element); }, [onViewport]);
  const renderItem = useCallback(({ item }: { item: DisplayRow }) => {
    const first = item.rows[0]!, last = item.rows.at(-1)!;
    const boundary = first.item.runId ? boundaries.get(`${first.sourceThreadId}:${first.item.runId}`) : undefined;
    const finalAnswer = boundary?.last === last.key && boundary.answer?.canFork ? boundary.answer : undefined;
    return <div data-message-key={item.key} className={`timeline-row${first.item.type === "checkpoint" ? " checkpoint-row" : ""}`}>
      {boundary?.first === first.key ? <AssistantHeader working={working && first.item.runId === activeRun} headerKey={first.key} /> : null}
      {isWorkItem(first) ? <WorkGroup rows={item.rows} threadId={id ?? ""} environmentId={state.environment?.environmentId ?? ""} /> : <TurnItem row={first} threadId={id ?? ""} environmentId={state.environment?.environmentId ?? ""} />}
      {finalAnswer?.item.type === "assistant_message" ? <div className="response-actions response-end"><CopyButton text={finalAnswer.item.text} /><ForkButton row={finalAnswer} threadId={id ?? ""} /></div> : null}
    </div>;
  }, [id, state.environment?.environmentId, boundaries, working, activeRun]);
  const header = <div className="timeline-header">{state.history.hasMore || state.history.error ? <button className="btn" disabled={state.history.loading} onClick={() => { void run("loadHistory", { threadId: id }); }}>{state.history.loading ? "Loading…" : state.history.error ? "Retry loading earlier messages" : "Load earlier messages"}</button> : null}{state.history.error ? <p className="turn-error">{state.history.error}</p> : null}</div>;
  if (!state.transcript.length && citationTarget && citationTarget.threadId === id) return <div className="chat-empty"><p role="status">{citationNotice ?? "Opening the source response…"}</p></div>;
  if (!id || (!state.transcript.length && !state.threadLoading && !working)) return <div className="chat-empty"><T3VSCodeIcon className="empty-wordmark" /><h1>What would you like to build?</h1><p>Start a conversation with an agent, or open a thread from your projects.</p></div>;
  if (state.threadLoading && !state.transcript.length && !working) return <div className="chat-empty"><p>Loading conversation…</p></div>;
  return <SearchTargetContext.Provider value={searchTarget ?? null}><SubagentState value={state}><div ref={viewportRef} className="transcript-container" data-message-navigation={exchanges.length >= 2 ? state.messageNavigation ?? "left" : "off"} data-assistant-citation-viewport="" aria-label="Conversation">
    {citationTarget && citationTarget.threadId === id && citationNotice ? <div className="citation-source-notice" role="status">{citationNotice}</div> : null}
    {navigationNotice ? <div className="citation-source-notice" role="status">{navigationNotice}</div> : null}
    {sticky && working ? <div className="sticky-working"><AssistantHeader working /></div> : null}
    <MessageNavigator key={`nav:${id}`} exchanges={exchanges} currentRow={rows.find((row) => row.key === viewedKey)?.firstIndex ?? state.transcript.length - 1} placement={state.messageNavigation ?? "left"} atEnd={atEnd} history={state.history} onJump={jump} onLatest={latest} onEarlier={() => { void run("loadHistory", { threadId: id }); }} />
    <LegendList ref={list} key={id} data={rows} keyExtractor={(row) => row.key} renderItem={renderItem} estimatedItemSize={100}
      {...(sourceIndex >= 0 || matchIndex >= 0 ? { alwaysRender: { keys: [...new Set([sourceIndex, matchIndex].filter((index) => index >= 0).map((index) => rows[index]!.key))] } } : {})}
      initialScrollAtEnd={!searchTarget && followEnd && (!citationTarget || citationTarget.threadId !== id)} {...(!followEnd && viewedKey ? { initialScrollIndex: Math.max(0, rows.findIndex((row) => row.key === viewedKey)) } : {})} maintainScrollAtEnd={!searchTarget && followEnd && (!citationTarget || citationTarget.threadId !== id) ? { animated: false } : false} maintainScrollAtEndThreshold={0.15} maintainVisibleContentPosition
      className="transcript-list" style={{ height: "100%" }} onViewableItemsChanged={visible} viewabilityConfig={{ itemVisiblePercentThreshold: 0 }}
      onScroll={(event) => { updateSticky(); const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; const node: unknown = list.current?.getScrollableNode(); const distance = node instanceof HTMLElement ? node.scrollHeight - node.scrollTop - node.clientHeight : contentSize.height - contentOffset.y - layoutMeasurement.height; const end = distance < 40; setAtEnd(end); if (end) setFollowEnd(true); }}
      ListHeaderComponent={header}
      ListFooterComponent={<div className="timeline-footer">{working && !activeHeader ? <div className="timeline-row"><AssistantHeader working /></div> : null}</div>}
    />
  </div></SubagentState></SearchTargetContext.Provider>;
}
