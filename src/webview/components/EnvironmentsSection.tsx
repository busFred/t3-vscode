import { mergeMachines, type MachineRow } from "../machines";
import { AddMachineForm, MachineCapabilities, peerHealthLabel } from "./PeerLinksSection";
import { MachineRemoveButton } from "./MachineRemoveMenu";
import { MachineCloneStatus, MachineProject } from "./MachineProject";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEnvironmentsHeight } from "../environmentsHeight";
import { clampSectionHeight } from "../sectionHeight";
import { BellIcon, BellOffIcon, ChevronDownIcon, InfoIcon, LaptopMinimalIcon, LinkIcon, PlayIcon, PlusIcon, PowerIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { EnvironmentRow } from "../../shared/environmentStatus";
import { environmentRowActions, type EnvironmentActionName, type EnvironmentIconAction } from "../../shared/environmentActions";
import { useActions } from "../actions";

const MACHINES_HELP = "Conversations: the machine's conversations appear in VS Code and new chats can run there. Agents: agents on this computer can launch and drive threads there.";
const meta = (...parts: ReadonlyArray<string | undefined>) => parts.filter(Boolean).join(" · ");

function Dot({ tone, label }: { readonly tone: "ok" | "warn" | "error" | "off"; readonly label?: string }) {
  return <i className={`env-dot ${tone}`} {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })} />;
}

/** The light on a machine's icon: its conversation connection, or for agent-only machines the link's health. */
function machineStatus(machine: MachineRow): { tone: "ok" | "warn" | "error" | "off"; label: string } {
  if (machine.local) return { tone: "ok", label: "Connected" };
  const status = machine.conversation?.status;
  if (status) return { connected: { tone: "ok", label: "Connected" }, connecting: { tone: "warn", label: "Connecting…" }, reconnecting: { tone: "warn", label: "Reconnecting…" },
    expiring: { tone: "warn", label: machine.conversation?.detail ?? "Expiring soon" }, expired: { tone: "error", label: "Pairing expired" }, disabled: { tone: "off", label: "Disabled" } }[status] as { tone: "ok" | "warn" | "error" | "off"; label: string };
  const health = machine.agents?.status;
  return health === "reachable" ? { tone: "ok", label: "Reachable" } : health === "expired" ? { tone: "error", label: "Agent access expired" } : { tone: "error", label: peerHealthLabel(health ?? "unreachable") };
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
    // One remove per machine: it asks whether to remove the VS Code conversations, the agent access, or (in turn) both.
    remove: (row) => { const machine = machines.find((item) => item.environmentId === row.environmentId);
      return machine ? <MachineRemoveButton machine={machine} peers={state.peerLinks} removeConversations={() => act("remove", row.environmentId)} /> : iconButton("Remove", "remove", row, <Trash2Icon size={13} />, true); },
  };
  // Beside the status, each is an icon button like the hover icons; the title and the machine-named label keep it readable.
  const inlineOf = {
    pairAgain: { label: "Pair again", icon: <LinkIcon size={13} /> }, enable: { label: "Enable", icon: <PlayIcon size={13} /> },
    ignore: { label: "Ignore", icon: <BellOffIcon size={13} /> }, unignore: { label: "Unignore", icon: <BellIcon size={13} /> },
  } as const;
  const machines = mergeMachines(environments, state.peerLinks);
  /** Actions sit on the name line, always visible: problem fixes first, then reconnect, disable and remove. */
  const actionsOf = (row: EnvironmentRow): ReactNode => {
    const { text, icons } = environmentRowActions(row);
    return <>{text.map((action) => <Fragment key={action}>{iconButton(inlineOf[action].label, action, row, inlineOf[action].icon)}</Fragment>)}
      {icons.map((action) => <Fragment key={action}>{iconOf[action](row)}</Fragment>)}</>;
  };
  /** Only an unhealthy state is written out; a healthy machine is just its green light. */
  const statusTextOf = (row: EnvironmentRow): ReactNode => ({
    connected: null, connecting: <span className="env-status">Connecting…</span>, reconnecting: <span className="env-status env-warn">Reconnecting…</span>,
    expiring: <span className="env-status env-warn">{row.detail ?? "Expiring soon"}</span>, expired: <span className="env-status env-error">Expired</span>, disabled: <span className="env-status">Disabled</span>,
  })[row.status];
  const local = environments.local;
  return <><details ref={section} className="environments" data-sized={listHeight !== null || undefined} style={listHeight !== null ? { "--env-list-height": `${listHeight}px` } as CSSProperties : undefined} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-description={MACHINES_HELP}><ChevronDownIcon size={12} /><strong>MACHINES</strong><span className="env-info" aria-hidden="true" title={MACHINES_HELP}><InfoIcon size={11} /></span><span className="env-summary-dot"><Dot tone={environments.indicator} label={summary} /></span></summary>
    <div className="environments-body">
      {machines.every((machine) => machine.local) ? <p className="env-hint">{MACHINES_HELP}</p> : null}
      {state.peerLinks?.denial && <p className="env-hint">{state.peerLinks.denial}</p>}
      {state.peerLinks?.error && <p role="alert">{state.peerLinks.error}</p>}
      {machines.map(machine => { const { tone, label } = machineStatus(machine);
        const project = state.projectMachines;
        const missingProject = project && !machine.local && machine.conversation?.status === "connected" && !project.present.includes(machine.environmentId);
        const canAdd = project?.cloneSource && project.targets.some(target => target.environmentId === machine.environmentId && target.available)
          && !project.clones.some(clone => clone.environmentId === machine.environmentId);
        const projectHint = missingProject ? `${project.title} is not on ${machine.label}.${canAdd ? ` Click the Add ${project.title} to ${machine.label} button (folder +) to add it.` : ""}` : undefined;
        const iconLabel = [label, projectHint].filter(Boolean).join(". ");
        const host = machine.local ? meta(local?.host, local?.serverVersion) : meta(machine.conversation?.host, machine.conversation?.serverVersion);
        const managed = machine.conversation?.managedOrganization ?? (machine.local ? state.localManagedPolicy?.organization : undefined);
        const status = machine.conversation ? statusTextOf(machine.conversation) : !machine.local && machine.agents && machine.agents.status !== "reachable" ? <span className="env-status env-error">{peerHealthLabel(machine.agents.status)}</span> : null;
        return <div className={`env-row${machine.conversation?.ignored ? " ignored" : ""}`} key={machine.environmentId}>
        <span className="env-icon" role="img" aria-label={`${machine.local ? "This computer" : "Machine"}: ${iconLabel}`} title={iconLabel}>{machine.local ? <LaptopMinimalIcon size={14} aria-hidden="true" /> : <ServerIcon size={14} aria-hidden="true" />}{projectHint
          ? <svg className="env-project-missing" viewBox="0 0 20 20" aria-hidden="true"><title>{projectHint}</title><path d="M10 1.5 19 18H1Z" fill="currentColor" stroke="var(--sidebar, var(--vscode-sideBar-background))" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 7v5" stroke="#fff" strokeWidth="2" strokeLinecap="round" /><circle cx="10" cy="15" r="1" fill="#fff" /></svg>
          : <Dot tone={tone} />}</span>
        <div className="env-name" title={[machine.label, host, machine.conversation?.detail].filter(Boolean).join(" · ")}><span>{machine.label}</span>{machine.local && <span className="env-chip">This computer</span>}</div>
        <div className="env-actions"><MachineProject state={state} machine={machine} />{machine.conversation ? actionsOf(machine.conversation) : !machine.local && machine.agents ? <MachineRemoveButton machine={machine} peers={state.peerLinks} removeConversations={() => undefined} /> : null}</div>
        <MachineCapabilities machine={machine} peers={state.peerLinks} pair={() => setAdding(machine)} lead={<>{status}{managed ? <span className="env-managed">Managed by {managed}</span> : null}<MachineCloneStatus state={state} machine={machine} /></>} />
      </div>; })}
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
