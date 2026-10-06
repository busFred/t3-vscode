import { memo, useCallback, useState, type ReactNode } from "react";
import { LegendList } from "@legendapp/list/react";
import { BrainIcon, CheckIcon, ChevronRightIcon, CopyIcon, FileIcon, GitForkIcon, GlobeIcon, SearchIcon, TerminalIcon, WrenchIcon, BotIcon, ArrowRightLeftIcon, MinusIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot, TranscriptItem, WireTurnItem } from "../../shared/bridge";
import { useActions } from "../actions";
import { getQuestionAnswerText } from "@t3tools/client-runtime/work-log/user-input";
import { ChatMarkdown } from "./ChatMarkdown";
import { WorkLogBlock, WorkLogButton, WorkLogDetails } from "./t3/WorkLog";
import { TimelineSystemDivider } from "./t3/TimelineSystemDivider";
import { T3Wordmark } from "./t3/T3Wordmark";

function CopyButton({ text }: { text: string }) {
  const run = useActions(); const [copied, setCopied] = useState(false);
  return <button className="icon-button copy-button" title="Copy message" aria-label="Copy message" onClick={() => { void run("copyText", { text }).then(setCopied); }}>{copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}</button>;
}
function Disclosure({ label, icon, children, row, threadId }: { label: string; icon: ReactNode; children: ReactNode; row: TranscriptItem; threadId: string }) {
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false);
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
      trailing={<><span className="work-status">{row.item.status === "running" ? "Running" : row.item.status === "failed" ? "Failed" : ""}</span><ChevronRightIcon size={13} className={open ? "rotate-90" : ""} /></>} />
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
const TurnItem = memo(function TurnItem({ row, threadId }: { row: TranscriptItem; threadId: string }) {
  const { item } = row; const run = useActions();
  const markdown = (text: string) => <ChatMarkdown text={text} threadId={threadId} />;
  const openThread = (id: string) => { void run("selectThread", { threadId: id }); };
  switch (item.type) {
    case "user_message": return <article className="message user-message" data-item-type={item.type}><div className="user-bubble">{markdown(item.text)}{item.attachments.length ? <div className="attachments">{item.attachments.map((attachment, index) => <span key={index}><FileIcon size={12} />{attachment.name}</span>)}</div> : null}</div><CopyButton text={item.text} /></article>;
    case "assistant_message": return <article className="message assistant-message" data-item-type={item.type}><div className="message-author"><T3Wordmark className="size-5" /><span>Assistant</span>{item.streaming ? <span className="streaming-label">Writing…</span> : null}</div>{markdown(item.text)}{!item.streaming ? <CopyButton text={item.text} /> : null}</article>;
    case "reasoning": return <Disclosure label={item.streaming ? "Thinking…" : "Thought process"} icon={<BrainIcon size={14} />} row={row} threadId={threadId}>{markdown(item.text)}</Disclosure>;
    case "proposed_plan": return <section className="plan-card"><header><span className="plan-badge">Plan</span><strong>Proposed plan</strong><CopyButton text={item.markdown} /></header>{markdown(item.markdown)}</section>;
    case "todo_list": return <section className="todo-card">{item.explanation ? <p>{item.explanation}</p> : null}{item.steps.map((step, index) => <div key={index} className={`todo-step ${step.status}`}><span>{step.status === "completed" ? "✓" : step.status === "running" ? "◉" : "○"}</span><span>{step.text}</span></div>)}</section>;
    case "command_execution": return <Disclosure label={item.title ?? item.input.split("\n")[0] ?? "Command"} icon={<TerminalIcon size={14} />} row={row} threadId={threadId}><pre className="command-input">{item.input}</pre>{row.output ? <pre className="tool-output">{row.output}</pre> : <span className="subtle">{row.needsDetail ? "Expand again to retry loading output." : "No output."}</span>}{item.exitCode !== undefined ? <span className="subtle">Exit code {item.exitCode}</span> : null}</Disclosure>;
    case "dynamic_tool": return <Disclosure label={row.toolLabel ?? item.title ?? item.toolName ?? "Tool"} icon={<WrenchIcon size={14} />} row={row} threadId={threadId}><pre className="command-input">{typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2)}</pre>{row.output ? <pre className="tool-output">{row.output}</pre> : <span className="subtle">{row.needsDetail ? "Expand again to retry loading output." : "No output."}</span>}</Disclosure>;
    case "file_change": return <Disclosure label={item.title ?? `Edited ${item.fileName}`} icon={<FileIcon size={14} />} row={row} threadId={threadId}><FileChange item={item} threadId={threadId} /></Disclosure>;
    case "file_search": return <Disclosure label={item.title ?? `Searched files${item.pattern ? `: ${item.pattern}` : ""}`} icon={<SearchIcon size={14} />} row={row} threadId={threadId}>{item.results?.map((result, index) => <div className="search-result" key={index}><button className="text-button" onClick={() => { void run("openLink", { href: `${result.fileName}${result.line ? `:${result.line}` : ""}`, threadId }); }}>{result.fileName}{result.line ? `:${result.line}` : ""}</button>{result.preview ? <pre>{result.preview}</pre> : null}</div>)}</Disclosure>;
    case "web_search": return <Disclosure label={item.title ?? `Searched the web${item.patterns?.length ? `: ${item.patterns.join(", ")}` : ""}`} icon={<GlobeIcon size={14} />} row={row} threadId={threadId}>{item.results?.map((result, index) => <div className="search-result" key={index}><button className="text-button" onClick={() => { if (result.url) void run("openLink", { href: result.url }); }}>{result.title ?? result.url ?? "Search result"}</button>{result.snippet ? <p>{result.snippet}</p> : null}</div>)}</Disclosure>;
    case "approval_request": return <TimelineSystemDivider label={item.status === "waiting" || item.status === "pending" ? "Approval requested" : "Approval handled"} detail={item.prompt} />;
    case "user_input_request": return <section className="question-history">{item.questions.map((question) => <div key={question.id}><strong>{question.question}</strong>{item.questionAnswer?.answers[question.id] !== undefined ? <p>{getQuestionAnswerText(item.questionAnswer.answers[question.id])}</p> : <p className="subtle">{item.status === "pending" || item.status === "waiting" ? "Answer below to continue." : item.status}</p>}</div>)}</section>;
    case "checkpoint": return item.files.length ? <details className="checkpoint"><summary><FileIcon size={13} />{item.files.length} changed {item.files.length === 1 ? "file" : "files"}</summary>{item.files.map((file) => <button className="text-button" key={file.path} onClick={() => { void run("openLink", { href: file.path, threadId }); }}>{file.path}<span className="addition">+{file.additions}</span><span className="deletion">−{file.deletions}</span></button>)}</details> : null;
    case "run_interrupt_request": return <TimelineSystemDivider label="Interrupt requested" detail={item.message} tone="danger" icon={XIcon} />;
    case "run_interrupt_result": return <TimelineSystemDivider label="Run interrupted" detail={item.message} tone="danger" icon={XIcon} />;
    case "system_notice": return <TimelineSystemDivider label={item.message} />;
    case "error": return <div className="turn-error" role="status">{item.failure.message}</div>;
    case "compaction": return <TimelineSystemDivider label={item.status === "running" ? "Compacting context" : "Context compacted"} detail={item.summary} icon={MinusIcon} />;
    case "handoff": return <TimelineSystemDivider label="Context handoff" detail={item.summary ?? item.toProviderInstanceId} icon={ArrowRightLeftIcon} />;
    case "fork": return <TimelineSystemDivider label="Conversation fork" icon={GitForkIcon} actionLabel="Open related thread" onAction={() => openThread(item.source.type === "run" ? item.source.threadId : item.targetThreadId)} />;
    case "thread_created": return <TimelineSystemDivider label={item.title ?? "Created thread"} actionLabel="Open thread" onAction={() => openThread(item.targetThreadId)} />;
    case "subagent": return <Disclosure label={item.title ?? `Agent · ${item.providerInstanceId}`} icon={<BotIcon size={14} />} row={row} threadId={threadId}>{markdown(item.result ?? item.progress ?? item.prompt)}{item.childThreadId ? <button className="text-button" onClick={() => openThread(item.childThreadId!)}>Open agent conversation</button> : null}</Disclosure>;
    case "notification": return <section className="notification">{markdown(item.detail ? `${item.summary}\n\n${item.detail}` : item.summary)}</section>;
  }
});

export function TranscriptView({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions();
  const id = state.activeThreadId;
  const renderItem = useCallback(({ item }: { item: TranscriptItem }) => <div className="timeline-row"><TurnItem row={item} threadId={id ?? ""} /></div>, [id]);
  if (!id || (!state.transcript.length && !state.threadLoading)) return <div className="chat-empty"><T3Wordmark className="empty-wordmark" /><h1>What would you like to build?</h1><p>Start a conversation with an agent, or open a thread from your projects.</p></div>;
  if (state.threadLoading && !state.transcript.length) return <div className="chat-empty"><p>Loading conversation…</p></div>;
  return <div className="transcript-container" aria-label="Conversation">
    <LegendList key={id} data={state.transcript} keyExtractor={(row) => row.key} renderItem={renderItem} estimatedItemSize={100}
      initialScrollAtEnd maintainScrollAtEnd maintainScrollAtEndThreshold={0.15} maintainVisibleContentPosition
      className="transcript-list" style={{ height: "100%" }}
      ListHeaderComponent={<div className="timeline-header">{state.history.hasMore || state.history.error ? <button className="btn" disabled={state.history.loading} onClick={() => { void run("loadHistory", { threadId: id }); }}>{state.history.loading ? "Loading…" : state.history.error ? "Retry loading earlier messages" : "Load earlier messages"}</button> : null}{state.history.error ? <p className="turn-error">{state.history.error}</p> : null}</div>}
      ListFooterComponent={<div className="timeline-footer" />}
    />
  </div>;
}
