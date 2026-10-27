import { Fragment, type ReactNode } from "react";
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
  return <details className="environments">
    <summary><ChevronDownIcon size={12} /><strong>ENVIRONMENTS</strong><span className="env-summary-dot"><Dot tone={environments.indicator} label={summary} /></span></summary>
    <div className="environments-body">
      {local ? <div className="env-row">
        <LaptopMinimalIcon size={14} />
        <div className="env-name"><span>{local.label}</span><span className="env-chip">This computer</span></div>
        <div className="env-state"><span className="env-resting"><Dot tone="ok" />Connected</span></div>
        <div className="env-meta">{meta(local.host, local.serverVersion)}</div>
      </div> : null}
      {environments.rows.map((row) => <div className={`env-row${row.ignored ? " ignored" : ""}`} key={row.environmentId}>
        <ServerIcon size={14} />
        <div className="env-name"><span title={row.label}>{row.label}</span></div>
        <div className={`env-state ${row.status}`}>{stateOf(row)}</div>
        {/* Error text can be long and technical, so the address stays visible and the reason sits in the tooltip. */}
        <div className="env-meta" title={row.status === "expiring" ? undefined : row.detail}>{meta(row.host, row.serverVersion)}</div>
      </div>)}
      <button className="text-button env-add" onClick={() => act("add")}><PlusIcon size={13} />Add machine…</button>
      {environments.rows.length === 0 ? <p className="env-hint">In T3 Code on the other machine, choose Create link, then paste the link here. Its sessions for this repository appear in Sessions.</p> : null}
    </div>
  </details>;
}
