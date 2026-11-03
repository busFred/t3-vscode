import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2Icon } from "lucide-react";
import type { PeerLinksState } from "../../shared/peerLinks";
import { clampMenuPosition } from "../../shared/assistantQuoteMenu";
import type { MachineRow } from "../machines";
import { useActions } from "../actions";

/** What each removal does, shown in the menu and on hover; a machine can lose either capability independently. */
export function removalConsequences(machine: Pick<MachineRow, "label">) {
  return {
    conversations: `Stop showing ${machine.label}’s conversations in VS Code and remove it from Run on. Nothing is deleted on that machine, and agents keep any access they have.`,
    agents: `Agents on this computer can no longer launch or drive threads on ${machine.label}. Its conversations stay in VS Code. To end the session there too, revoke “T3 Code · …” in that machine’s Connections.`,
  };
}

/** One remove button per machine; it asks which capability to remove instead of offering two separate removals. */
export function MachineRemoveButton({ machine, peers, removeConversations }: { readonly machine: MachineRow; readonly peers?: PeerLinksState | undefined; readonly removeConversations: () => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const canRemoveAgents = !!machine.agents && !peers?.denial;
  if (!machine.conversations && !canRemoveAgents) return null;
  return <>
    <button className="icon-button danger" title="Remove…" aria-label={`Remove ${machine.label}…`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}><Trash2Icon size={13} /></button>
    {anchor ? <MachineRemoveMenu anchor={anchor} machine={machine} canRemoveAgents={canRemoveAgents} removeConversations={removeConversations} onClose={() => setAnchor(null)} /> : null}
  </>;
}

function MachineRemoveMenu({ anchor, machine, canRemoveAgents, removeConversations, onClose }: { anchor: HTMLButtonElement; machine: MachineRow; canRemoveAgents: boolean; removeConversations: () => void; onClose: () => void }) {
  const run = useActions();
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const text = removalConsequences(machine);
  useLayoutEffect(() => {
    const node = popup.current!; const box = anchor.getBoundingClientRect();
    setPosition(clampMenuPosition({ x: box.right - node.offsetWidth, y: box.bottom + 4 }, { width: node.offsetWidth, height: node.offsetHeight }, { width: innerWidth, height: innerHeight }));
    node.querySelector<HTMLButtonElement>("button")?.focus();
  }, [anchor]);
  // The confirm step replaces the options in place; only move focus into it.
  useLayoutEffect(() => { if (confirming) popup.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [confirming]);
  const busyRef = useRef(false); busyRef.current = busy;
  useEffect(() => {
    // An unlink in flight keeps the menu, so its failure can still be shown.
    const dismiss = () => { if (!busyRef.current) onClose(); };
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", dismiss); window.addEventListener("blur", dismiss);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("blur", dismiss); };
  }, [anchor, onClose]);
  const close = () => { onClose(); anchor.focus(); };
  return createPortal(<div ref={popup} className="selection-context-menu machine-remove-menu" role="menu" aria-label={`Remove ${machine.label}`} style={{ left: position.x, top: position.y }} onKeyDown={event => {
    if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); event.stopPropagation(); if (!busyRef.current) close(); return; }
    const buttons = [...popup.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>
    {confirming ? <div className="machine-remove-confirm">
      <p>{text.agents}</p>
      <div><button role="menuitem" onClick={() => setConfirming(false)}>Cancel</button><button role="menuitem" className="danger" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { if (await run("unlinkPeer", { environmentId: machine.environmentId })) close(); else setError("Could not remove agent access."); }
        catch { setError("Could not remove agent access."); }
        finally { setBusy(false); }
      }}>Remove agent access</button></div>
      {error ? <p role="alert">{error}</p> : null}
    </div> : <>
      {machine.conversations ? <button role="menuitem" title={text.conversations} onClick={() => { close(); removeConversations(); }}><strong>Remove from VS Code</strong><small>{text.conversations}</small></button> : null}
      {canRemoveAgents ? <button role="menuitem" title={text.agents} onClick={() => setConfirming(true)}><strong>Remove agent access</strong><small>{text.agents}</small></button> : null}
    </>}
  </div>, document.body);
}
