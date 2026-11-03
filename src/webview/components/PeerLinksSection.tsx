import { useEffect, useRef, useState } from "react";
import type { AuthMcpClientAccess } from "@t3tools/contracts";
import { peerAccessLabels, type PeerLinksState } from "../../shared/peerLinks";
import type { MachineRow } from "../machines";
import { useActions } from "../actions";

export function MachineCapabilities({ machine, peers, pair }: { readonly machine: MachineRow; readonly peers?: PeerLinksState | undefined; readonly pair: () => void }) {
  const run = useActions();
  const [editing, setEditing] = useState(false), [manual, setManual] = useState(false), [code, setCode] = useState("");
  const [address, setAddress] = useState(machine.address ?? ""), [access, setAccess] = useState<AuthMcpClientAccess>("approval-required");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (await run("linkPeer", machine.conversations && !manual ? { environmentId: machine.environmentId, access } : { url: address.trim(), pairingCode: code.trim(), access })) setEditing(false);
      else { setManual(true); setError("Could not enable agent access. Paste a fresh code from that machine instead."); }
    } catch { setManual(true); setError("Could not enable agent access. Paste a fresh code from that machine instead."); }
    finally { setCode(""); setBusy(false); inFlight.current = false; }
  };
  return <div className="env-meta machine-capabilities">
    {machine.conversations ? <span className="env-chip">Conversations</span> : <button className="text-button" onClick={pair}>Pair to see conversations</button>}
    {!machine.local && (machine.agents ? <>
      <span className="env-chip" title={peerHealthLabel(machine.agents.status)}>{agentChipLabel(machine.agents)}</span>
      {machine.agents.status === "expired" && <button className="text-button" disabled={!peers || !!peers.denial || !peers.loaded} title={peers?.denial} onClick={() => setEditing(true)}>Let agents use this…</button>}
    </> : <button className="text-button" disabled={!peers || !!peers.denial || !peers.loaded} title={peers?.denial} onClick={() => setEditing(true)}>Let agents use this…</button>)}
    {editing && <form autoComplete="off" onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={busy}>
      <AccessChoice access={access} setAccess={setAccess} />
      {(!machine.conversations || manual) && <><label>Machine address<input className="question-custom" value={address} onChange={event => setAddress(event.target.value)} /></label><CodeInput code={code} setCode={setCode} /></>}
      <button className="btn" type="button" onClick={() => { setCode(""); setEditing(false); setError(null); }}>Cancel</button>
      <button className="btn primary" disabled={(!machine.conversations || manual) && (!address.trim() || !code.trim())}>Let agents use this</button>
    </fieldset></form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
/** "Agents (Auto)", or "Agents (expired)" once the link needs renewing. */
export function agentChipLabel(agents: { readonly status: string; readonly access: AuthMcpClientAccess }): string {
  return `Agents (${agents.status === "expired" ? "expired" : peerAccessLabels[agents.access]})`;
}
/** Readable agent-link health for the status column and tooltips. */
export function peerHealthLabel(status: string): string {
  return ({ reachable: "Reachable", unreachable: "Unreachable", failing: "Failing", expired: "Expired" } as Record<string, string>)[status] ?? status;
}
function AccessChoice({ access, setAccess }: { access: AuthMcpClientAccess; setAccess: (value: AuthMcpClientAccess) => void }) {
  return <label>Agent access<select value={access} onChange={event => setAccess(event.target.value as AuthMcpClientAccess)}>{Object.entries(peerAccessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}
function CodeInput({ code, setCode }: { code: string; setCode: (value: string) => void }) {
  return <><label>Pairing code<input type="password" className="question-custom secret-input" value={code} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" onChange={event => setCode(event.target.value)} /></label><p className="env-hint">Create a fresh code on that machine: Settings → Connections → Create link, or t3 pair.</p></>;
}
export function AddMachineForm({ peers, machine, close }: { readonly peers?: PeerLinksState | undefined; readonly machine?: MachineRow | undefined; readonly close: () => void }) {
  const run = useActions();
  const [address, setAddress] = useState(machine?.address ?? ""), [next, setNext] = useState(false), [code, setCode] = useState("");
  const [conversations, setConversations] = useState(true), [agents, setAgents] = useState(!machine?.agents && !peers?.denial);
  const [access, setAccess] = useState<AuthMcpClientAccess>("approval-required"), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const inFlight = useRef(false), details = useRef<HTMLDivElement>(null);
  useEffect(() => { if (next) details.current?.scrollIntoView({ block: "nearest" }); }, [next]);
  return <form autoComplete="off" onSubmit={async event => {
    event.preventDefault();
    if (!next) { setNext(true); return; }
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(false);
    try { if (await run("addMachine", { address: address.trim(), code: code.trim(), conversations, agents: agents && !peers?.denial && !machine?.agents, access, environmentId: machine?.environmentId })) close(); else setError(true); }
    catch { setError(true); }
    finally { setCode(""); setBusy(false); inFlight.current = false; }
  }}><fieldset disabled={busy}>
    <label>Machine address<input className="question-custom" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://machine.tailnet.ts.net" required /></label>
    {next && <>
      <label><input type="checkbox" checked={conversations} onChange={event => setConversations(event.target.checked)} />Conversations in VS Code</label>
      <label><input type="checkbox" checked={agents} disabled={!!peers?.denial || !!machine?.agents} onChange={event => setAgents(event.target.checked)} />Let agents use it</label>
      {agents && <AccessChoice access={access} setAccess={setAccess} />}
      <CodeInput code={code} setCode={setCode} />
    </>}
    {peers?.denial && <p className="env-hint">{peers.denial}</p>}
    <div ref={details}><button className="btn" type="button" onClick={close}>Cancel</button>
    <button className="btn primary" disabled={!address.trim() || (next && (!code.trim() || (!conversations && !(agents && !peers?.denial && !machine?.agents))))}>{next ? busy ? "Adding…" : "Add capabilities" : "Next"}</button></div>
    {error && <p role="alert">Could not finish adding capabilities. Conversations already added are kept. Check the address and use a fresh code.</p>}
  </fieldset></form>;
}
