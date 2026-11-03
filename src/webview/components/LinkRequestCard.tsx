import { useState } from "react";
import { EnvironmentId, ThreadId, TurnItemId, type AuthMcpClientAccess } from "@t3tools/contracts";
import { linkRequestAnswerInput, linkRequestDefaultAccess, linkRequestDisplay, linkRequestTargetName } from "@t3tools/client-runtime/link-request";
import type { TranscriptItem, WireTurnItem } from "../../shared/bridge";
import { useActions } from "../actions";
import { TimelineSystemDivider } from "./t3/TimelineSystemDivider";

type LinkItem = Extract<WireTurnItem, { type: "link_request" }>;
const accessLabels: Record<AuthMcpClientAccess, string> = { "read-only": "Read only", "approval-required": "Supervised", "auto-accept-edits": "Auto accept edits", auto: "Auto", "full-access": "Full access" };

export function LinkRequestCard({ item, visibility }: { item: LinkItem; visibility: NonNullable<TranscriptItem["visibility"]> }) {
  const display = linkRequestDisplay(item, visibility, value => accessLabels[value]);
  return display.kind === "pending" ? <PendingLinkRequest key={item.id} item={item} /> : <TimelineSystemDivider label={display.label} />;
}

/** Pairing codes stay in the pending card, which unmounts on resolution, never in drafts or snapshots. */
function PendingLinkRequest({ item }: { item: LinkItem }) {
  const run = useActions();
  const [review, setReview] = useState(false);
  const [address, setAddress] = useState(item.url ?? "");
  const [existing, setExisting] = useState("");
  const [code, setCode] = useState("");
  const [access, setAccess] = useState(() => linkRequestDefaultAccess(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const answer = (decline: boolean) => {
    const input = linkRequestAnswerInput({ id: TurnItemId.make(item.id), threadId: ThreadId.make(item.threadId) }, decline ? { type: "decline" } : existing.trim() ? { type: "use-existing", environmentId: EnvironmentId.make(existing.trim()) } : {
      type: "link", target: item.environmentId ? { environmentId: EnvironmentId.make(item.environmentId), label: item.label?.trim() || linkRequestTargetName(item), urls: [address.trim()] } : { url: address }, pairingCode: code, access,
    });
    if (!input || busy) return;
    setBusy(true); setError(false);
    void run("answerLinkRequest", input).then(ok => { if (ok) { setCode(""); setReview(false); } else setError(true); }).catch(() => setError(true)).finally(() => setBusy(false));
  };
  return <section className="question-card" data-v2-item-type="link_request">
    <strong>Link {linkRequestTargetName(item)} to this environment</strong>
    {item.reason.trim() ? <p className="subtle">{item.reason}</p> : null}
    {item.url ? <p>{item.url}</p> : null}
    {review ? <fieldset disabled={busy}>
      <label>Environment address<input className="question-custom" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://…" /></label>
      <label>Access<select value={access} onChange={event => setAccess(event.target.value as AuthMcpClientAccess)}>{Object.entries(accessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Pairing code<input className="question-custom secret-input" value={code} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" onChange={event => setCode(event.target.value)} /></label>
      <p className="subtle">Get a pairing code from the other machine’s Connections settings or t3 pair.</p>
      <label>Or use an already linked environment ID<input className="question-custom" value={existing} onChange={event => setExisting(event.target.value)} /></label>
    </fieldset> : null}
    {error ? <p role="alert">Could not answer the request. Try again.</p> : null}
    <div className="request-actions"><button className="btn" disabled={busy} onClick={() => answer(true)}>Decline</button>{review ? <><button className="btn" disabled={busy} onClick={() => { setCode(""); setReview(false); }}>Cancel</button><button className="btn primary" disabled={busy || (!existing.trim() && (!address.trim() || !code.trim()))} onClick={() => answer(false)}>{busy ? "Linking…" : existing.trim() ? "Use existing link" : "Link"}</button></> : <button className="btn primary" onClick={() => setReview(true)}>{item.url || item.environmentId ? "Review link…" : "Choose machine…"}</button>}</div>
  </section>;
}
