import type { ReactNode } from "react";
import { ChevronDownIcon, LaptopMinimalIcon, PlusIcon, PowerIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { EnvironmentRow } from "../../shared/environmentStatus";
import { useActions } from "../actions";

type EnvironmentActionName = "add" | "pairAgain" | "enable" | "disable" | "reconnect" | "remove" | "ignore";

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
  const textButton = (label: string, action: EnvironmentActionName, row: EnvironmentRow) =>
    <button className="text-button" aria-label={`${label} ${row.label}`} onClick={() => act(action, row.environmentId)}>{label}</button>;
  const ignore = (row: EnvironmentRow) => row.ignored ? <span className="env-ignored">Ignored</span> : textButton("Ignore", "ignore", row);
  const iconButton = (title: string, action: EnvironmentActionName, row: EnvironmentRow, icon: ReactNode, danger = false) =>
    <button className={`icon-button${danger ? " danger" : ""}`} title={title} aria-label={`${title} ${row.label}`} onClick={() => act(action, row.environmentId)}>{icon}</button>;
  const stateOf = (row: EnvironmentRow): ReactNode => {
    switch (row.status) {
      case "connected": return <>
        <span className="env-resting"><Dot tone="ok" />Connected</span>
        <span className="env-hover-actions">{iconButton("Reconnect", "reconnect", row, <RefreshCwIcon size={13} />)}{iconButton("Disable", "disable", row, <PowerIcon size={13} />)}{iconButton("Remove", "remove", row, <Trash2Icon size={13} />, true)}</span>
      </>;
      case "connecting": return <span>Connecting…</span>;
      case "reconnecting": return <><span className="env-warn"><Dot tone="warn" />Reconnecting…</span>{ignore(row)}</>;
      case "expiring": return <><span className="env-warn"><Dot tone="warn" />{row.detail ?? "Expiring soon"}</span>{textButton("Pair again", "pairAgain", row)}{ignore(row)}</>;
      case "expired": return <><span className="env-error"><Dot tone="error" />Expired</span>{textButton("Pair again", "pairAgain", row)}{ignore(row)}</>;
      case "disabled": return <>
        <span><Dot tone="off" />Disabled</span>{textButton("Enable", "enable", row)}
        <span className="env-hover-actions">{iconButton("Remove", "remove", row, <Trash2Icon size={13} />, true)}</span>
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
