import { mergeMachines, type MachineRow } from "../machines";
import { AddMachineForm, MachineCapabilities, peerHealthLabel } from "./PeerLinksSection";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEnvironmentsHeight } from "../environmentsHeight";
import { clampSectionHeight } from "../sectionHeight";
import { BellIcon, BellOffIcon, ChevronDownIcon, LaptopMinimalIcon, LinkIcon, PlayIcon, PlusIcon, PowerIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { EnvironmentRow } from "../../shared/environmentStatus";
import { environmentRowActions, type EnvironmentActionName, type EnvironmentIconAction } from "../../shared/environmentActions";
import { useActions } from "../actions";

const meta = (...parts: ReadonlyArray<string | undefined>) => parts.filter(Boolean).join(" · ");

function Dot({ tone, label }: { readonly tone: "ok" | "warn" | "error" | "off"; readonly label?: string }) {
  return <i className={`env-dot ${tone}`} {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })} />;
}

export function EnvironmentsSection({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<MachineRow | true | null>(null);
  const [height, setHeight] = useEnvironmentsHeight();
  const section = useRef<HTMLDetailsElement>(null), drag = useRef<{ y: number; height: number; moved: boolean } | null>(null), dragHeight = useRef<number | null>(null);
  const [live, setLive] = useState<number | null>(null);
  // Leave the Sessions tabs and a few rows below; the list's own title never scrolls (see .environments CSS).
  const maxHeight = () => { const front = section.current?.parentElement; const summary = section.current?.querySelector("summary"); return front ? front.clientHeight - (summary?.offsetHeight ?? 20) - 140 : 600; };
  const listHeight = live ?? (height === null ? null : clampSectionHeight(height, maxHeight()));
  const resize = (next: number) => { const value = clampSectionHeight(next, maxHeight())!; dragHeight.current = value; setLive(value); return value; };
  // A click without movement keeps the automatic height rather than saving one.
  const finishResize = () => { const current = drag.current; if (current) { drag.current = null; if (current.moved) setHeight(dragHeight.current); setLive(null); } };
  /** The list's visible height (not its full content height), so resizing starts from what is on screen. */
  const shownHeight = () => { const element = section.current; if (!element) return 200; const summary = element.querySelector("summary"); return element.getBoundingClientRect().height - (summary?.getBoundingClientRect().height ?? 22) - 1; };
  useEffect(() => { if (open && state.peerLinks && !state.peerLinks.denial) void run("refreshPeerLinks"); }, [open, state.peerLinks?.environmentId, state.peerLinks?.denial, run]);
  const environments = state.environments;
  if (!environments) return null;
  const act = (action: EnvironmentActionName, environmentId?: string) => { void run("environmentAction", { action, environmentId }); };
  const problems = environments.rows.filter((row) => !row.ignored && (row.status === "reconnecting" || row.status === "expiring" || row.status === "expired"));
  const summary = problems.length ? problems.map((row) => `${row.label}: ${row.status}`).join(", ")
    : environments.rows.every((row) => row.status === "connected") ? "All machines connected" : "Nothing needs attention";
  const iconButton = (title: string, action: EnvironmentActionName, row: EnvironmentRow, icon: ReactNode, danger = false) =>
    <button className={`icon-button${danger ? " danger" : ""}`} title={title} aria-label={`${title} ${row.label}`} onClick={() => act(action, row.environmentId)}>{icon}</button>;
  const iconOf: Record<EnvironmentIconAction, (row: EnvironmentRow) => ReactNode> = {
    reconnect: (row) => iconButton("Reconnect", "reconnect", row, <RefreshCwIcon size={13} />),
    disable: (row) => iconButton("Disable", "disable", row, <PowerIcon size={13} />),
    remove: (row) => iconButton("Remove", "remove", row, <Trash2Icon size={13} />, true),
  };
  // Beside the status, each is an icon button like the hover icons; the title and the machine-named label keep it readable.
  const inlineOf = {
    pairAgain: { label: "Pair again", icon: <LinkIcon size={13} /> }, enable: { label: "Enable", icon: <PlayIcon size={13} /> },
    ignore: { label: "Ignore", icon: <BellOffIcon size={13} /> }, unignore: { label: "Unignore", icon: <BellIcon size={13} /> },
  } as const;
  const stateOf = (row: EnvironmentRow): ReactNode => {
    const { text, icons } = environmentRowActions(row);
    const buttons = text.map((action) => <Fragment key={action}>{iconButton(inlineOf[action].label, action, row, inlineOf[action].icon)}</Fragment>);
    const hover = icons.length ? <span className="env-hover-actions">{icons.map((action) => <Fragment key={action}>{iconOf[action](row)}</Fragment>)}</span> : null;
    switch (row.status) {
      case "connected": return <>
        <span className="env-resting"><Dot tone="ok" />Connected</span>
        {hover}
      </>;
      case "connecting": return <span>Connecting…</span>;
      case "reconnecting": return <><span className="env-warn"><Dot tone="warn" />Reconnecting…</span>{hover}{buttons}</>;
      case "expiring": return <><span className="env-warn"><Dot tone="warn" />{row.detail ?? "Expiring soon"}</span>{hover}{buttons}</>;
      case "expired": return <><span className="env-error"><Dot tone="error" />Expired</span>{hover}{buttons}</>;
      case "disabled": return <>
        <span><Dot tone="off" />Disabled</span>{buttons}
        {hover}
      </>;
    }
  };
  const local = environments.local;
  return <><details ref={section} className="environments" data-sized={listHeight !== null || undefined} style={listHeight !== null ? { "--env-list-height": `${listHeight}px` } as CSSProperties : undefined} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronDownIcon size={12} /><strong>MACHINES</strong><span className="env-summary-dot"><Dot tone={environments.indicator} label={summary} /></span></summary>
    <div className="environments-body">
      <p className="env-hint">Conversations appear in VS Code. Agents can use machines to launch and drive threads.</p>
      {state.peerLinks?.denial && <p className="env-hint">{state.peerLinks.denial}</p>}
      {state.peerLinks?.error && <p role="alert">{state.peerLinks.error}</p>}
      {mergeMachines(environments, state.peerLinks).map(machine => <div className={`env-row${machine.conversation?.ignored ? " ignored" : ""}`} key={machine.environmentId}>
        {machine.local ? <LaptopMinimalIcon size={14} /> : <ServerIcon size={14} />}
        <div className="env-name"><span title={machine.label}>{machine.label}</span>{machine.local && <span className="env-chip">This computer</span>}</div>
        <div className={`env-state ${machine.conversation?.status ?? ""}`}>{machine.conversation ? stateOf(machine.conversation) : machine.local ? <span className="env-resting"><Dot tone="ok" />Connected</span> : machine.agents ? peerHealthLabel(machine.agents.status) : null}</div>
        <div className="env-meta" title={machine.conversation?.detail}>{machine.local ? meta(local?.host, local?.serverVersion) : meta(machine.conversation?.host, machine.conversation?.serverVersion)}{(machine.conversation?.managedOrganization ?? (machine.local ? state.localManagedPolicy?.organization : undefined)) && <span className="env-managed">Managed by {machine.conversation?.managedOrganization ?? state.localManagedPolicy?.organization}</span>}</div>
        <MachineCapabilities machine={machine} peers={state.peerLinks} pair={() => setAdding(machine)} />
      </div>)}
      {adding ? <AddMachineForm key={adding === true ? "new" : adding.environmentId} peers={state.peerLinks} machine={adding === true ? undefined : adding} close={() => setAdding(null)} /> : <button className="text-button env-add" onClick={() => setAdding(true)}><PlusIcon size={13} />Add machine…</button>}
    </div>
  </details>
  {open ? <div className="section-resize" role="separator" tabIndex={0} aria-label="Resize machines list" aria-orientation="horizontal" aria-valuemin={60} aria-valuemax={Math.max(60, maxHeight())} {...(listHeight !== null ? { "aria-valuenow": listHeight } : {})} title="Drag or use arrow keys to resize; double-click to fit the list"
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); const start = listHeight ?? shownHeight(); drag.current = { y: event.clientY, height: start, moved: false }; dragHeight.current = start; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { const current = drag.current; if (!current || event.clientY === current.y && !current.moved) return; current.moved = true; resize(current.height + event.clientY - current.y); }}
    onPointerUp={(event) => { finishResize(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finishResize} onLostPointerCapture={finishResize}
    onDoubleClick={() => { setLive(null); setHeight(null); }}
    onKeyDown={(event) => { if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return; event.preventDefault();
      const current = listHeight ?? shownHeight();
      setHeight(resize(event.key === "Home" ? 60 : event.key === "End" ? maxHeight() : current + (event.key === "ArrowDown" ? 20 : -20))); setLive(null); }}><span className="find-grip" /></div> : null}
  </>;
}
