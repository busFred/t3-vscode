import { useEffect, useRef, useState } from "react";
import type { AuthMcpClientAccess } from "@t3tools/contracts";
import { peerAccessLabels, type PeerLinksState } from "../../shared/peerLinks";
import { useActions } from "../actions";

export function PeerLinksSection({ peers }: { readonly peers: PeerLinksState }) {
  const run = useActions();
  const [editing, setEditing] = useState(false), [address, setAddress] = useState(""), [code, setCode] = useState("");
  const [access, setAccess] = useState<AuthMcpClientAccess>("approval-required");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [forget, setForget] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { setEditing(false); setCode(""); setForget(null); if (!peers.denial) void run("refreshPeerLinks"); }, [peers.environmentId, peers.denial, run]);
  const submit = async () => {
    if (inFlight.current || peers.denial || !address.trim() || !code.trim()) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { if (await run("linkPeer", { url: address.trim(), pairingCode: code.trim(), access })) { setEditing(false); setAddress(""); } else setError("Could not link the machine. Check its address and pairing code."); }
    catch { setError("Could not link the machine. Check its address and pairing code."); }
    finally { setCode(""); setBusy(false); inFlight.current = false; }
  };
  return <section aria-label="Linked environments" className="peer-links">
    <strong>Linked environments · T3 server</strong>
    <p className="env-hint">Link another machine running T3 Code, such as a VPS, so agents here can launch and drive threads there.</p>
    {peers.denial ? <p className="env-hint">{peers.denial}</p> : <>
      <button className="text-button" disabled={busy} onClick={() => void run("refreshPeerLinks")}>Refresh links</button>
      {peers.error ? <p role="alert">{peers.error}</p> : !peers.loaded ? <p role="status">Loading linked environments…</p> : peers.links.length === 0 ? <p className="env-hint">No linked environments</p> : null}
      {peers.links.map(link => <div className="env-row" key={link.environmentId}>
        <div className="env-name"><span>{link.label}</span>{link.paired ? <span className="env-chip">Also paired in VS Code</span> : null}</div>
        <div className="env-meta">{link.status} · {peerAccessLabels[link.access]}</div>
        {forget === link.environmentId ? <div>
          <p className="env-hint">Agents here stop working there. Revoke “T3 Code · …” in {link.label}’s Connections to end the session there too.</p>
          <button className="btn" disabled={busy} onClick={() => setForget(null)}>Cancel</button>
          <button className="btn danger" disabled={busy} onClick={() => {
            if (inFlight.current) return;
            inFlight.current = true; setBusy(true); setError(null);
            void run("unlinkPeer", { environmentId: link.environmentId }).then(ok => { if (ok) setForget(null); else setError("Could not unlink the machine."); }).catch(() => setError("Could not unlink the machine.")).finally(() => { setBusy(false); inFlight.current = false; });
          }}>Confirm unlink</button>
        </div> : <button className="text-button danger" disabled={busy} onClick={() => setForget(link.environmentId)}>Unlink</button>}
      </div>)}
      {editing ? <form autoComplete="off" onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={busy}>
        <label>Machine address<input className="question-custom" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://machine.tailnet.ts.net" /></label>
        <label>Pairing code<input type="password" className="question-custom secret-input" value={code} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" onChange={event => setCode(event.target.value)} /></label>
        <p className="env-hint">Create a link on the other machine: Settings → Connections → Create link, or t3 pair.</p>
        <label>Access<select value={access} onChange={event => setAccess(event.target.value as AuthMcpClientAccess)}>{Object.entries(peerAccessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="btn" type="button" onClick={() => { setCode(""); setEditing(false); setError(null); }}>Cancel</button>
        <button className="btn primary" disabled={!address.trim() || !code.trim()}>{busy ? "Linking…" : "Link"}</button>
      </fieldset></form> : <button className="text-button env-add" onClick={() => setEditing(true)}>Link a machine…</button>}
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </section>;
}
