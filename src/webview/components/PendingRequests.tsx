import { secretRequestPrivacyNote } from "@t3tools/client-runtime/secret-request";
import { seedUserInputDraftAnswers } from "@t3tools/client-runtime/state/thread-requests";
import { resolvePendingUserInputAnswer, setPendingUserInputCustomAnswer, togglePendingUserInputOptionSelection, isPendingUserInputOptionSelected, type PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
/** T3's docked approval/question flow, with responses sent through the host. */
import { type ComponentProps, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThreadPendingApproval, ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ChildRequestSummary, HostStateSnapshot, PendingSecretRequest } from "../../shared/bridge";
import { parseSideChatCommand } from "../../shared/sideChats";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { ComposerPendingApprovalPanel } from "./t3/ComposerPendingApprovalPanel";
import { carryUnsentAnswersToDraft, forgetQuestionAnswers, noteUnansweredQuestions, pruneQuestionAnswers, recalledQuestionAnswers, rememberQuestionAnswers, restoreUnsentAnswers } from "../questionAnswers";

/** Grows with the answer like the composer, then scrolls; Enter submits and Shift+Enter inserts a newline. */
function CustomAnswer(props: ComponentProps<"textarea">) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!field.current) return;
    field.current.style.height = "auto";
    field.current.style.height = `${Math.min(field.current.scrollHeight, 220)}px`;
  }, [props.value]);
  return <textarea ref={field} rows={1} className="question-custom" onKeyDown={(event) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }} {...props} />;
}

const clip = (text: string) => text.length > 60 ? `${text.slice(0, 59)}…` : text;

/** Collapsed summary: the question header, plus how many choices it offers. */
function questionSummary(question: ThreadPendingUserInput["questions"][number] | undefined) {
  if (!question) return "Input needed";
  const label = question.header || clip(question.question);
  return question.options.length ? `${label} · ${question.options.length} option${question.options.length === 1 ? "" : "s"}` : label;
}

/** Collapsed summary: the first non-empty line of the approval's command or prompt. */
function approvalSummary(approval: ThreadPendingApproval) {
  const line = approval.detail?.split("\n").find((text) => text.trim());
  return line ? clip(line.trim()) : "Approval needed";
}

/** The card's heading doubles as its collapse toggle; when collapsed it is the only row left. */
function RequestHeading({ open, summary, onToggle }: { open: boolean; summary: string; onToggle: () => void }) {
  return <button type="button" className="request-heading" aria-expanded={open} title={open ? "Collapse" : "Expand"} onClick={onToggle}>
    {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
    <span>Agent needs your input</span>
    {open ? null : <span className="request-summary">{summary}</span>}
  </button>;
}

/** Escape collapses an open card and moves focus to its heading so focus is not lost with the hidden controls. */
function collapseOnEscape(event: KeyboardEvent<HTMLElement>, open: boolean, onToggle: () => void) {
  if (event.key !== "Escape" || event.nativeEvent.isComposing || !open) return;
  event.stopPropagation();
  event.currentTarget.querySelector<HTMLElement>(".request-heading")?.focus();
  onToggle();
}

function UserInput({ prompt, threadId, sideChatAvailable, open, onToggle }: { prompt: ThreadPendingUserInput; threadId: string; sideChatAvailable: boolean; open: boolean; onToggle: () => void }) {
  const run = useActions();
  const card = useRef<HTMLFormElement>(null);
  const wasOpen = useRef(open);
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>(() => recalledQuestionAnswers(threadId, prompt.requestId) ?? seedUserInputDraftAnswers(prompt.questions, {}));
  // Mirrored outside the card: if Stop or a provider timeout closes the question, the typed text goes to the composer.
  useEffect(() => { rememberQuestionAnswers(threadId, prompt.requestId, drafts); }, [threadId, prompt.requestId, drafts]);
  const [busy, setBusy] = useState(false);
  const disabled = busy || prompt.responseCapability === "not_resumable";
  // The question card has its own input. Unavailable side-chat commands remain literal answers.
  const sideQuestion = sideChatAvailable ? prompt.questions.find(question => parseSideChatCommand(drafts[question.id]?.customAnswer ?? "")) : undefined;
  const valid = !!sideQuestion || prompt.questions.every(question => question.required === false || resolvePendingUserInputAnswer(question, drafts[question.id]) !== null);
  const submit = () => {
    if (!valid || disabled) return;
    setBusy(true);
    if (sideQuestion) {
      void run("sendMessage", { threadId, text: drafts[sideQuestion.id]?.customAnswer, fromQuestion: true }).then(ok => {
        if (ok) setDrafts(previous => ({ ...previous, [sideQuestion.id]: setPendingUserInputCustomAnswer(sideQuestion, previous[sideQuestion.id], "") }));
      }).finally(() => setBusy(false));
      return;
    }
    // Forgotten before sending, so a Stop that lands while the answer is in flight cannot also copy it into the composer;
    // remembered again if the send fails, since the answer is then still the person's only copy.
    forgetQuestionAnswers(threadId, prompt.requestId);
    void run("respondToRequest", { threadId, requestId: prompt.requestId, answers: Object.fromEntries(prompt.questions.map(question => [question.id, resolvePendingUserInputAnswer(question, drafts[question.id]) ?? ""])) }).then((ok) => { if (!ok) restoreUnsentAnswers(threadId, prompt.requestId, drafts); }).finally(() => setBusy(false));
  };
  useLayoutEffect(() => {
    // Only re-expanding moves focus into the card; the first render keeps focus where it was.
    if (open && !wasOpen.current) card.current?.querySelector<HTMLElement>(".question-option input, .question-custom")?.focus();
    wasOpen.current = open;
  }, [open]);
  return <form ref={card} className={open ? "question-card" : "question-card collapsed"} onKeyDown={(event) => collapseOnEscape(event, open, onToggle)} onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <RequestHeading open={open} summary={questionSummary(prompt.questions[0])} onToggle={onToggle} />
    {open ? <>{prompt.questions.map((question) => <fieldset key={question.id} disabled={disabled}><legend>{question.question}</legend>
      <div className="question-options">{question.options.map((option) => {
        const value = option.value ?? option.label;
        const selected = isPendingUserInputOptionSelected(question, drafts[question.id], value);
        return <label className={selected ? "question-option selected" : "question-option"} key={value}>
          <input type={question.multiSelect ? "checkbox" : "radio"} name={question.id} checked={selected} onChange={() => {
            setDrafts(previous => ({ ...previous, [question.id]: togglePendingUserInputOptionSelection(question, previous[question.id], value) }));
          }} /><span><strong>{option.label}</strong><small>{option.description}</small>{option.preview ? <pre className="whitespace-pre-wrap">{option.preview}</pre> : null}</span>
        </label>;
      })}</div>
      {question.allowCustomAnswer !== false || !question.options.length ? <CustomAnswer aria-label={`Answer: ${question.header}`} placeholder={question.options.length ? "Or write your own answer…" : "Your answer…"} value={drafts[question.id]?.customAnswer ?? ""} onChange={(event) => {
        setDrafts(previous => ({ ...previous, [question.id]: setPendingUserInputCustomAnswer(question, previous[question.id], event.target.value) }));
      }} /> : null}
    </fieldset>)}
    {prompt.responseCapability === "not_resumable" ? <p className="subtle">The provider process has ended. Restart the turn to respond.</p> : null}
    <div className="request-actions">{prompt.dismissible ? <button type="button" className="btn" disabled={busy} onClick={() => { setBusy(true); void run("dismissRequest", { threadId, requestId: prompt.requestId }).finally(() => setBusy(false)); }}>Dismiss</button> : null}<button type="submit" className="btn primary" disabled={disabled || !valid}>{busy ? "Sending…" : "Submit answers"}</button></div>
    </> : null}
  </form>;
}

function ApprovalCard({ approval, pendingCount, threadId, open, onToggle }: { approval: ThreadPendingApproval; pendingCount: number; threadId: string; open: boolean; onToggle: () => void }) {
  const run = useActions(); const [responding, setResponding] = useState(false); const [feedback, setFeedback] = useState("");
  return <div className={open ? "approval-card" : "approval-card collapsed"} onKeyDown={(event) => collapseOnEscape(event, open, onToggle)}>
    <RequestHeading open={open} summary={approvalSummary(approval)} onToggle={onToggle} />
    {open ? <>
      <ComposerPendingApprovalPanel approval={approval} pendingCount={pendingCount} />
      {approval.supportsFeedback ? <CustomAnswer aria-label="Optional decline feedback" placeholder="Optional feedback when declining…" value={feedback} disabled={responding} onChange={event => setFeedback(event.target.value)} /> : null}
      <div className="request-actions">{(approval.options ?? [
        { decision: "decline", label: "Decline" }, { decision: "acceptForSession", label: "Allow this session" }, { decision: "accept", label: "Approve" },
      ]).map((option) => <button className={option.decision === "accept" ? "btn primary" : "btn"} key={option.decision} title={"warning" in option ? option.warning : undefined} disabled={responding || approval.responseCapability !== "live"} onClick={() => {
        setResponding(true);
        void run("respondToRequest", { threadId, requestId: approval.requestId, decision: option.decision, ...(option.decision === "decline" && approval.supportsFeedback ? { feedback } : {}) }).finally(() => setResponding(false));
      }}>{option.label}</button>)}</div>
    </> : null}
  </div>;
}

/**
 * Private entry for an agent's `request_secret`. The secret lives only in this component's state: it is never
 * drafted, persisted, logged or echoed, and is cleared after a successful save and on unmount. The field is a
 * text input masked with `-webkit-text-security` (as T3's web UI does; VS Code webviews are Chromium) rather than
 * `type="password"`, so password managers and "save password" prompts leave it alone.
 */
function SecretRequestCard({ request, threadId, open, onToggle }: { request: PendingSecretRequest; threadId: string; open: boolean; onToggle: () => void }) {
  const run = useActions();
  const card = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(open);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = secret.trim();
  useEffect(() => () => { setSecret(""); if (field.current) field.current.value = ""; }, []);
  const answer = (value: { type: "save"; secret: string } | { type: "decline" }) => {
    setBusy(true); setFailed(false);
    void run("answerSecretRequest", { threadId, turnItemId: request.turnItemId, answer: value }).then((ok) => {
      if (ok) setSecret(""); else setFailed(true);
    }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  // The fieldset is disabled while saving, which drops focus; give it back once a failed save re-enables the field.
  useEffect(() => { if (failed && !busy) field.current?.focus(); }, [failed, busy]);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) field.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const errorId = `secret-error-${request.turnItemId}`;
  return <form ref={card} data-v2-item-type="secret_request" className={open ? "question-card secret-card" : "question-card secret-card collapsed"} onKeyDown={(event) => collapseOnEscape(event, open, onToggle)} onSubmit={(event) => { event.preventDefault(); if (trimmed && !busy) answer({ type: "save", secret: trimmed }); }}>
    <RequestHeading open={open} summary={request.label} onToggle={onToggle} />
    {open ? <>
      <fieldset disabled={busy}>
        <legend>{request.label}</legend>
        {request.reason.trim() ? <p className="subtle secret-reason">{request.reason}</p> : null}
        {request.delivery === "file" ? <p className="subtle">{secretRequestPrivacyNote(request)}</p> : null}
        <input ref={field} className="question-custom secret-input" type="text" value={secret} placeholder={request.placeholder ?? "Paste the secret"} aria-label={request.label} aria-invalid={failed || undefined} aria-describedby={failed ? errorId : undefined}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-bwignore onChange={(event) => { setSecret(event.target.value); setFailed(false); }} />
        {failed ? <p id={errorId} className="secret-error" role="alert">Could not answer the request. Try again.</p> : null}
      </fieldset>
      <div className="request-actions"><button type="button" className="btn" disabled={busy} onClick={() => answer({ type: "decline" })}>Decline</button><button type="submit" className="btn primary" disabled={busy || !trimmed}>{busy ? "Saving…" : "Save"}</button></div>
    </> : null}
  </form>;
}

/**
 * An approval held by a descendant conversation, answerable here (T3 0.1.7).
 *
 * Only accept/decline is offered: the child's own tab carries the full request detail, and this
 * exists so a parent is not blocked waiting on a child the reader has not opened.
 */
function ChildApprovalCard({ request }: { readonly request: ChildRequestSummary }) {
  const run = useActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What is actually being approved. Fetched only when the reader asks to see it: the parent does
  // not subscribe to the child, so this costs a round trip per card, and a conversation can hold
  // several. Nothing is fetched while the card merely sits on screen.
  const [revealed, setRevealed] = useState(false);
  const detail = useBridgeQuery<{ requestKind: string; detail?: string; reason?: string }>(
    "childRequestDetail", { threadId: request.threadId, requestId: request.requestId },
    revealed ? `${request.threadId}:${request.requestId}` : null);
  const respond = (decision: "accept" | "decline") => {
    setBusy(true); setError(null);
    void run("respondToRequest", { threadId: request.threadId, requestId: request.requestId, decision })
      .then((ok) => { if (!ok) setError("This request could not be answered. Open the conversation to respond."); })
      .finally(() => setBusy(false));
  };
  return <section className="pending-request child-approval" aria-label={`Approval for ${request.title}`}>
    <header><span className="child-approval-kind">{request.kind.replace(/[-_]/g, " ")}</span><strong title={request.title}>{request.title}</strong></header>
    {detail.data?.detail ? <pre className="child-approval-detail">{detail.data.detail}</pre>
      : detail.error ? <p className="subtle">Could not read what this conversation is asking for. Open it to respond.</p>
      : revealed ? <p className="subtle">Reading what this conversation is asking for…</p>
      : <p className="subtle">A delegated conversation is waiting for approval.</p>}
    {detail.data?.reason ? <p className="subtle">{detail.data.reason}</p> : null}
    <div className="child-approval-actions">
      <button type="button" className="btn" disabled={busy} onClick={() => respond("decline")}>Decline</button>
      {/* Approving blind is the risk here, so Approve stays out of reach until the request is shown. */}
      {detail.data?.detail
        ? <button type="button" className="btn primary" disabled={busy} onClick={() => respond("accept")}>Approve</button>
        : <button type="button" className="btn" disabled={busy || revealed} onClick={() => setRevealed(true)}>{revealed ? "Reading…" : "Show request"}</button>}
      <button type="button" className="text-button" disabled={busy} onClick={() => { void run("selectThread", { threadId: request.threadId }); }}>Open conversation</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

export function PendingRequests({ state }: { state: HostStateSnapshot }) {
  // Keyed by requestId so each request keeps its own collapsed state; unseen requests start expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const threadId = state.activeThreadId;
  // A question that closed unanswered (Stop, provider timeout) returns what was typed in it to this conversation's draft.
  const unanswered = state.pending.unansweredUserInputIds?.join("\n") ?? "";
  useEffect(() => {
    if (!threadId) return;
    noteUnansweredQuestions(threadId, unanswered ? unanswered.split("\n") : []);
    if (unanswered) carryUnsentAnswersToDraft(threadId, unanswered.split("\n"));
  }, [threadId, unanswered]);
  const openQuestions = state.pending.userInputs.map((input) => input.requestId).join("\n");
  useEffect(() => {
    if (threadId) pruneQuestionAnswers(threadId, new Set([...openQuestions.split("\n"), ...unanswered.split("\n")].filter(Boolean)));
  }, [threadId, openQuestions, unanswered]);
  if (!threadId) return null;
  const approval = state.pending.approvals[0];
  const prompt = state.pending.userInputs[0];
  const secret = state.pending.secrets[0];
  const toggle = (requestId: string) => setCollapsed((previous) => ({ ...previous, [requestId]: !previous[requestId] }));
  return <div className="pending-requests">
    {approval ? <ApprovalCard key={approval.requestId} approval={approval} pendingCount={state.pending.approvals.length} threadId={threadId} open={!collapsed[approval.requestId]} onToggle={() => toggle(approval.requestId)} /> : null}
    {prompt ? <UserInput key={prompt.requestId} prompt={prompt} threadId={threadId} sideChatAvailable={state.threads.find(thread => thread.id === threadId)?.sideChatBlock === undefined} open={!collapsed[prompt.requestId]} onToggle={() => toggle(prompt.requestId)} /> : null}
    {secret ? <SecretRequestCard key={secret.turnItemId} request={secret} threadId={threadId} open={!collapsed[secret.turnItemId]} onToggle={() => toggle(secret.turnItemId)} /> : null}
    {/* The conversation's own requests come first; a child's approval is someone else's turn. */}
    {(state.childRequests ?? []).map((request) => <ChildApprovalCard key={`${request.threadId}:${request.requestId}`} request={request} />)}
  </div>;
}
