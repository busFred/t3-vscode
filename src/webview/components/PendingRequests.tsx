/** T3's docked approval/question flow, with responses sent through the host. */
import { type ComponentProps, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThreadPendingApproval, ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { HostStateSnapshot, PendingSecretRequest } from "../../shared/bridge";
import { useActions } from "../actions";
import { ComposerPendingApprovalPanel } from "./t3/ComposerPendingApprovalPanel";

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

function UserInput({ prompt, threadId, open, onToggle }: { prompt: ThreadPendingUserInput; threadId: string; open: boolean; onToggle: () => void }) {
  const run = useActions();
  const card = useRef<HTMLFormElement>(null);
  const wasOpen = useRef(open);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const disabled = busy || prompt.responseCapability === "not_resumable";
  const values = (id: string) => [...(answers[id] ?? []), ...(custom[id]?.trim() ? [custom[id]!.trim()] : [])];
  const valid = prompt.questions.every((question) => question.required === false || values(question.id).length > 0);
  const submit = () => {
    if (!valid || disabled) return;
    setBusy(true);
    void run("respondToRequest", { threadId, requestId: prompt.requestId, answers: Object.fromEntries(prompt.questions.map((question) => [question.id, question.multiSelect ? values(question.id) : values(question.id)[0] ?? ""])) }).finally(() => setBusy(false));
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
        const selected = answers[question.id]?.includes(value) ?? false;
        return <label className={selected ? "question-option selected" : "question-option"} key={value}>
          <input type={question.multiSelect ? "checkbox" : "radio"} name={question.id} checked={selected} onChange={() => {
            setAnswers((previous) => ({ ...previous, [question.id]: question.multiSelect ? selected ? (previous[question.id] ?? []).filter((item) => item !== value) : [...(previous[question.id] ?? []), value] : [value] }));
            if (!question.multiSelect) setCustom((previous) => ({ ...previous, [question.id]: "" }));
          }} /><span><strong>{option.label}</strong><small>{option.description}</small></span>
        </label>;
      })}</div>
      {question.allowCustomAnswer !== false || !question.options.length ? <CustomAnswer aria-label={`Answer: ${question.header}`} placeholder={question.options.length ? "Or write your own answer…" : "Your answer…"} value={custom[question.id] ?? ""} onChange={(event) => {
        setCustom((previous) => ({ ...previous, [question.id]: event.target.value }));
        if (!question.multiSelect) setAnswers((previous) => ({ ...previous, [question.id]: [] }));
      }} /> : null}
    </fieldset>)}
    {prompt.responseCapability === "not_resumable" ? <p className="subtle">The provider process has ended. Restart the turn to respond.</p> : null}
    <div className="request-actions">{prompt.dismissible ? <button type="button" className="btn" disabled={busy} onClick={() => { setBusy(true); void run("dismissRequest", { threadId, requestId: prompt.requestId }).finally(() => setBusy(false)); }}>Dismiss</button> : null}<button type="submit" className="btn primary" disabled={disabled || !valid}>{busy ? "Sending…" : "Submit answers"}</button></div>
    </> : null}
  </form>;
}

function ApprovalCard({ approval, pendingCount, threadId, open, onToggle }: { approval: ThreadPendingApproval; pendingCount: number; threadId: string; open: boolean; onToggle: () => void }) {
  const run = useActions(); const [responding, setResponding] = useState(false);
  return <div className={open ? "approval-card" : "approval-card collapsed"} onKeyDown={(event) => collapseOnEscape(event, open, onToggle)}>
    <RequestHeading open={open} summary={approvalSummary(approval)} onToggle={onToggle} />
    {open ? <>
      <ComposerPendingApprovalPanel approval={approval} pendingCount={pendingCount} />
      <div className="request-actions">{(approval.options ?? [
        { decision: "decline", label: "Decline" }, { decision: "acceptForSession", label: "Allow this session" }, { decision: "accept", label: "Approve" },
      ]).map((option) => <button className={option.decision === "accept" ? "btn primary" : "btn"} key={option.decision} title={"warning" in option ? option.warning : undefined} disabled={responding || approval.responseCapability !== "live"} onClick={() => {
        setResponding(true);
        void run("respondToRequest", { threadId, requestId: approval.requestId, decision: option.decision }).finally(() => setResponding(false));
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
        <input ref={field} className="question-custom secret-input" type="text" value={secret} placeholder={request.placeholder ?? "Paste the secret"} aria-label={request.label} aria-invalid={failed || undefined} aria-describedby={failed ? errorId : undefined}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-bwignore onChange={(event) => { setSecret(event.target.value); setFailed(false); }} />
        {failed ? <p id={errorId} className="secret-error" role="alert">Could not answer the request. Try again.</p> : null}
      </fieldset>
      <div className="request-actions"><button type="button" className="btn" disabled={busy} onClick={() => answer({ type: "decline" })}>Decline</button><button type="submit" className="btn primary" disabled={busy || !trimmed}>{busy ? "Saving…" : "Save"}</button></div>
    </> : null}
  </form>;
}

export function PendingRequests({ state }: { state: HostStateSnapshot }) {
  // Keyed by requestId so each request keeps its own collapsed state; unseen requests start expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const threadId = state.activeThreadId;
  if (!threadId) return null;
  const approval = state.pending.approvals[0];
  const prompt = state.pending.userInputs[0];
  const secret = state.pending.secrets[0];
  const toggle = (requestId: string) => setCollapsed((previous) => ({ ...previous, [requestId]: !previous[requestId] }));
  return <div className="pending-requests">
    {approval ? <ApprovalCard key={approval.requestId} approval={approval} pendingCount={state.pending.approvals.length} threadId={threadId} open={!collapsed[approval.requestId]} onToggle={() => toggle(approval.requestId)} /> : null}
    {prompt ? <UserInput key={prompt.requestId} prompt={prompt} threadId={threadId} open={!collapsed[prompt.requestId]} onToggle={() => toggle(prompt.requestId)} /> : null}
    {secret ? <SecretRequestCard key={secret.turnItemId} request={secret} threadId={threadId} open={!collapsed[secret.turnItemId]} onToggle={() => toggle(secret.turnItemId)} /> : null}
  </div>;
}
