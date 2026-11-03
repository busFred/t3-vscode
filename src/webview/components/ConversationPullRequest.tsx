import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadSummary } from "../../shared/bridge";
import { conversationPullRequests, currentPullRequest, pullRequestHost, pullRequestLabel, type PullRequestOperation, type PullRequestResponse } from "../../shared/pullRequests";
import { resolvePullRequestDetailChecks } from "@t3tools/client-runtime/pull-request-checks";
import { bridge } from "../bridge-client";
import { PullRequestStateController, type PullRequestState } from "../pullRequestState";
import { WorktreePopover } from "./WorktreePopover";
import { ChatMarkdown } from "./ChatMarkdown";
import "./pullRequests.css";

export function ConversationPullRequest({ thread }: { thread: ThreadSummary }) {
  const [open, setOpen] = useState(false); const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const link = currentPullRequest(thread);
  const label = pullRequestLabel(thread);
  useEffect(() => setOpen(false), [thread.id]);
  if (!link) return null;
  return <><button type="button" ref={anchor} className="worktree-control conversation-pr-control" aria-expanded={open} onClick={() => setOpen(!open)} title={link.snapshot?.title ?? label ?? undefined}>{label}</button>
    {open && anchor.current ? <WorktreePopover anchor={anchor.current} title={pullRequestHost(link.url).changeRequest.singular} onClose={close}><div className="conversation-pr-list">{conversationPullRequests(thread).map(pr => <PullRequestPanel key={`${thread.id}:${pr.url}`} thread={thread} link={pr} />)}</div></WorktreePopover> : null}</>;
}
function PullRequestPanel({ thread, link }: { thread: ThreadSummary; link: NonNullable<ReturnType<typeof currentPullRequest>> }) {
  const [state, setState] = useState<PullRequestState>({ data: {}, errors: {}, loading: {}, needsSignIn: false, signIn: "idle" });
  const controller = useRef<PullRequestStateController | null>(null);
  const definition = pullRequestHost(link.url);
  const app = definition.credentials?.appSignIn;
  const canSignIn = app?.hosts.includes(link.host) ?? false;
  useEffect(() => {
    const request = <K extends PullRequestOperation>(operation: K) => bridge.request<PullRequestResponse<K>>("conversationPullRequest", { threadId: thread.id, operation, number: link.number, url: link.url }, operation === "signInWait" ? 20 * 60_000 : undefined);
    const model = new PullRequestStateController(request, setState); controller.current = model;
    void model.refresh();
    const timer = setInterval(() => {
      if (model.state.data.reviewGuide?.run?._tag === "Running" && !model.state.loading.reviewGuide) void model.load("reviewGuide");
    }, 2000);
    const checksTimer = setInterval(() => { void model.load("summary"); void model.load("checks"); }, 45_000);
    return () => { clearInterval(timer); clearInterval(checksTimer); model.dispose(); controller.current = null; };
  }, [thread.id, link.url, link.number]);
  const detail = resolvePullRequestDetailChecks(state.data.detail ?? null, state.data.checks ?? null, true);
  const summary = state.data.summary;
  const guideResult = state.data.reviewGuide;
  const guide = guideResult?.guide;
  const running = state.loading.generateReviewGuide || guideResult?.run?._tag === "Running";
  const stale = guide && guideResult.currentHeadSha && guide.headSha !== guideResult.currentHeadSha;
  const open = (href: string) => void bridge.request("openLink", { href, threadId: thread.id });
  return <section className="conversation-pr" aria-label={`${definition.changeRequest.singular} #${link.number}`}>
    <header><strong>{definition.changeRequest.shortLabel} #{link.number} · {detail?.state ?? summary?.state ?? link.snapshot?.state ?? "unknown"}{(detail?.isDraft ?? summary?.isDraft ?? link.snapshot?.isDraft) ? " · draft" : ""}</strong><button type="button" onClick={() => open(detail?.url ?? summary?.url ?? link.url)}>Open</button><button type="button" onClick={() => void controller.current?.refresh()}>Refresh</button></header>
    <h3>{detail?.title ?? summary?.title ?? link.snapshot?.title ?? "Loading…"}</h3>
    <p>{detail ? `${detail.checks.length} checks · ${detail.checks.filter(check => check.status === "success").length} passed · ${detail.checks.filter(check => check.status === "failure" || check.status === "cancelled").length} failed · ${detail.checks.filter(check => check.status === "pending" || check.status === "action-required").length} pending` : `Checks ${summary?.checksState ?? link.snapshot?.checksState ?? "unknown"}`}{detail ? ` · ${detail.changedFiles} files · +${detail.additions} −${detail.deletions}` : ""}</p>
    {detail?.checks.map((check, index) => <div key={`${check.name}:${index}`}>{check.name}: {check.status}</div>)}
    {state.data.changeBreakdown ? <dl className="pr-breakdown">{Object.entries(state.data.changeBreakdown).map(([kind, counts]) => counts.additions || counts.deletions ? <div key={kind}><dt>{kind}</dt><dd>+{counts.additions} −{counts.deletions}</dd></div> : null)}</dl> : null}
    {Object.entries(state.errors).map(([operation, message]) => message ? <p role="alert" key={operation}>{operation}: {message}</p> : null)}
    {state.needsSignIn ? canSignIn ? <div><p>Sign in to {definition.label} to read this {definition.changeRequest.singular}.</p><button type="button" disabled={state.signIn === "starting" || state.signIn === "waiting" || state.signIn === "cancelling"} onClick={() => void controller.current?.signIn()}>Sign in</button></div> : <p>Configure credentials for {definition.label} on the conversation’s T3 server, then Refresh.</p> : null}
    {state.signIn === "starting" ? <p role="status">Starting sign-in…</p> : null}
    {state.prompt ? <div role="status"><p>Enter <strong>{state.prompt.userCode}</strong> at <button type="button" onClick={() => open(state.prompt!.verificationUri)}>{state.prompt.verificationUri}</button></p><p>Waiting for sign-in approval…</p></div> : null}
    {state.signIn === "starting" || state.signIn === "waiting" ? <button type="button" onClick={() => void controller.current?.cancelSignIn()}>Cancel sign-in</button> : null}
    {state.data.appAccess?.status === "not-covered" && app ? <p>{app.appName} cannot reach this repository. <button type="button" onClick={() => open(app.installUrl)}>Install app</button></p> : null}
    <h3>Review guide</h3>
    {stale ? <p role="status">This guide describes an earlier revision.</p> : null}
    {guideResult?.run?._tag === "Failed" ? <p role="alert">{guideResult.run.detail}</p> : null}
    {running ? <p role="status">Generating review guide…</p> : null}
    {guide ? guide.stops.map((stop, index) => <section key={index}><h4>{stop.title}</h4><ChatMarkdown text={stop.summary} threadId={thread.id} />{stop.attention ? <ChatMarkdown text={`${stop.attention.kind}: ${stop.attention.note}`} threadId={thread.id} /> : null}{stop.files.map(file => <div key={file.path}><code>{file.path}</code>{file.note ? <ChatMarkdown text={file.note} threadId={thread.id} /> : null}</div>)}{stop.excerpts.map((excerpt, i) => <div key={i}><code>{excerpt.path}:{excerpt.start}–{excerpt.end}</code> ({excerpt.side})<ChatMarkdown text={excerpt.caption} threadId={thread.id} /></div>)}{stop.notes.map((note, i) => <div key={i}><strong>{note.title}</strong> <code>{note.path}:{note.line}</code><ChatMarkdown text={note.body} threadId={thread.id} /></div>)}{stop.questions.map((question, i) => <ChatMarkdown key={i} text={question} threadId={thread.id} />)}</section>) : !running && guideResult ? <p>No review guide yet.</p> : null}
    {guideResult && !running ? <button type="button" onClick={() => void controller.current?.load("generateReviewGuide")}>{guide ? "Regenerate review guide" : "Generate review guide"}</button> : null}
  </section>;
}
