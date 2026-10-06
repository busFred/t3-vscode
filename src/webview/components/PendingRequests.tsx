/** T3's docked approval/question flow, with responses sent through the host. */
import { useState } from "react";
import type { ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { ComposerPendingApprovalPanel } from "./t3/ComposerPendingApprovalPanel";

function UserInput({ prompt, threadId }: { prompt: ThreadPendingUserInput; threadId: string }) {
  const run = useActions();
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
  return <form className="question-card" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <div className="request-heading">Agent needs your input</div>
    {prompt.questions.map((question) => <fieldset key={question.id} disabled={disabled}><legend>{question.question}</legend>
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
      {question.allowCustomAnswer !== false || !question.options.length ? <input className="question-custom" aria-label={`Answer: ${question.header}`} placeholder={question.options.length ? "Or write your own answer…" : "Your answer…"} value={custom[question.id] ?? ""} onChange={(event) => {
        setCustom((previous) => ({ ...previous, [question.id]: event.target.value }));
        if (!question.multiSelect) setAnswers((previous) => ({ ...previous, [question.id]: [] }));
      }} /> : null}
    </fieldset>)}
    {prompt.responseCapability === "not_resumable" ? <p className="subtle">The provider process has ended. Restart the turn to respond.</p> : null}
    <div className="request-actions">{prompt.dismissible ? <button type="button" className="btn" disabled={busy} onClick={() => { setBusy(true); void run("dismissRequest", { threadId, requestId: prompt.requestId }).finally(() => setBusy(false)); }}>Dismiss</button> : null}<button type="submit" className="btn primary" disabled={disabled || !valid}>{busy ? "Sending…" : "Submit answers"}</button></div>
  </form>;
}
export function PendingRequests({ state }: { state: HostStateSnapshot }) {
  const run = useActions(); const [responding, setResponding] = useState<string | null>(null);
  const threadId = state.activeThreadId;
  if (!threadId) return null;
  const approval = state.pending.approvals[0];
  const prompt = state.pending.userInputs[0];
  return <div className="pending-requests">
    {approval ? <div className="approval-card"><ComposerPendingApprovalPanel approval={approval} pendingCount={state.pending.approvals.length} />
      <div className="request-actions">{(approval.options ?? [
        { decision: "decline", label: "Decline" }, { decision: "acceptForSession", label: "Allow this session" }, { decision: "accept", label: "Approve" },
      ]).map((option) => <button className={option.decision === "accept" ? "btn primary" : "btn"} key={option.decision} title={"warning" in option ? option.warning : undefined} disabled={responding === approval.requestId || approval.responseCapability !== "live"} onClick={() => {
        setResponding(approval.requestId);
        void run("respondToRequest", { threadId, requestId: approval.requestId, decision: option.decision }).finally(() => setResponding(null));
      }}>{option.label}</button>)}</div>
    </div> : null}
    {prompt ? <UserInput key={prompt.requestId} prompt={prompt} threadId={threadId} /> : null}
  </div>;
}
