import { useLinkRequestPeers } from "../peerLinks";
import { peerChoiceAnswer, peerAccessLabels } from "../../shared/peerLinks";
import { useEffect, useRef, useState } from "react";
import { EnvironmentId, ThreadId, TurnItemId, type AuthMcpClientAccess } from "@t3tools/contracts";
import { linkRequestInitialMachine, rankMachinesByHint, linkRequestAnswerInput, linkRequestDefaultAccess, linkRequestDisplay, linkRequestTargetName } from "@t3tools/client-runtime/link-request";
import type { TranscriptItem, WireTurnItem } from "../../shared/bridge";
import { useActions } from "../actions";
import { TimelineSystemDivider } from "./t3/TimelineSystemDivider";

type LinkItem = Extract<WireTurnItem, { type: "link_request" }>;
const accessLabels = peerAccessLabels;

export function LinkRequestCard({ item, visibility }: { item: LinkItem; visibility: NonNullable<TranscriptItem["visibility"]> }) {
  const display = linkRequestDisplay(item, visibility, value => accessLabels[value]);
  return display.kind === "pending" ? <PendingLinkRequest key={item.id} item={item} /> : <TimelineSystemDivider label={display.label} />;
}

/** Pairing codes stay in the pending card, which unmounts on resolution, never in drafts or snapshots. */
function PendingLinkRequest({ item }: { item: LinkItem }) {
  const run = useActions();
  const [review, setReview] = useState(false);
  const [address, setAddress] = useState(item.url ?? "");
  const peers = useLinkRequestPeers();
  const machines = rankMachinesByHint(peers?.machines ?? [], item.hint);
  const [manualExisting, setManualExisting] = useState("");
  const picksMachine = item.environmentId === undefined && item.url === undefined;
  const [choice, setChoice] = useState<string | null>(null);
  const initial = linkRequestInitialMachine({ ...(item.environmentId ? { environmentId: EnvironmentId.make(item.environmentId) } : {}), ...(item.hint ? { hint: item.hint } : {}) }, machines.map(machine => ({ ...machine, environmentId: EnvironmentId.make(machine.environmentId), machine: "desktop" as const, connected: false, connectOnly: false })));
  const selected = choice ?? initial ?? "";
  const machine = machines.find(machine => machine.environmentId === selected);
  const existing = machine?.linked ? machine.environmentId : !selected ? manualExisting.trim() : "";
  const inFlight = useRef(false);
  useEffect(() => { if (review) void run("refreshPeerLinks", { threadId: item.threadId }); }, [review, run, item.threadId, peers?.denial]);
  useEffect(() => { setCode(""); setReview(false); setChoice(null); setManualExisting(""); }, [peers?.environmentId, peers?.denial]);
  const [code, setCode] = useState("");
  const [access, setAccess] = useState(() => linkRequestDefaultAccess(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const answer = (decline: boolean) => {
    if (inFlight.current || peers?.denial) return;
    const base = { id: TurnItemId.make(item.id), threadId: ThreadId.make(item.threadId), ...(item.environmentId ? { environmentId: EnvironmentId.make(item.environmentId) } : {}), ...(item.label ? { label: item.label } : {}), ...(item.url ? { url: item.url } : {}) };
    const input = decline ? linkRequestAnswerInput(base, { type: "decline" }) : existing ? linkRequestAnswerInput(base, { type: "use-existing", environmentId: EnvironmentId.make(existing) }) : peerChoiceAnswer(choice === "" ? { id: base.id, threadId: base.threadId } : base, machine, address, code, access);
    if (!input || busy) return;
    inFlight.current = true; setBusy(true); setError(false);
    void run("answerLinkRequest", input).then(ok => { if (ok) { setCode(""); setReview(false); } else setError(true); }).catch(() => setError(true)).finally(() => { setCode(""); setBusy(false); inFlight.current = false; });
  };
  return <section className="question-card" data-v2-item-type="link_request">
    <strong>Link {linkRequestTargetName(item)} to this environment</strong>
    {item.reason.trim() ? <p className="subtle">{item.reason}</p> : null}
    {item.url ? <p>{item.url}</p> : null}
    {review ? <fieldset disabled={busy || !!peers?.denial}>
      {picksMachine ? <label>Machine<select value={selected} onChange={event => { setChoice(event.target.value); setCode(""); }}>
        <option value="">Another address…</option>
        {machines.map(machine => <option key={machine.environmentId} value={machine.environmentId}>{machine.label}{machine.linked ? " · Already linked" : " · Paired in VS Code"}</option>)}
      </select></label> : null}
      {peers?.error ? <p role="alert">{peers.error}</p> : null}
      {machine?.linked ? <p className="subtle">This environment is already linked to {machine?.label}. The agent can use that link as it is; change its access in Settings → Connections.</p> : <>
      {!machine?.urls.length ? <label>Environment address<input className="question-custom" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://…" /></label> : null}
      <label>Access<select value={access} onChange={event => setAccess(event.target.value as AuthMcpClientAccess)}>{Object.entries(accessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Pairing code<input type="password" className="question-custom secret-input" value={code} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" onChange={event => setCode(event.target.value)} /></label>
      <p className="subtle">Get a pairing code from the other machine’s Connections settings or t3 pair.</p>
      {!selected ? <label>Or use an already linked environment ID<input className="question-custom" value={manualExisting} onChange={event => setManualExisting(event.target.value)} /></label> : null}
      </>}
    </fieldset> : null}
    {peers?.denial ? <p className="subtle">{peers.denial}</p> : null}
    {error ? <p role="alert">Could not answer the request. Try again.</p> : null}
    <div className="request-actions" aria-disabled={!!peers?.denial}><button className="btn" disabled={busy || !!peers?.denial} onClick={() => answer(true)}>Decline</button>{review ? <><button className="btn" disabled={busy || !!peers?.denial} onClick={() => { setCode(""); setReview(false); }}>Cancel</button><button className="btn primary" disabled={busy || !!peers?.denial || (!existing && ((!machine?.urls.length && !address.trim()) || !code.trim()))} onClick={() => answer(false)}>{busy ? "Linking…" : existing.trim() ? "Use existing link" : "Link"}</button></> : <button className="btn primary" disabled={!!peers?.denial} onClick={() => setReview(true)}>{item.url || item.environmentId ? "Review link…" : "Choose machine…"}</button>}</div>
  </section>;
}
