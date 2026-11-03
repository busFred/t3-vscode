import { useRef, useState } from "react";
import { CheckIcon, FolderPlusIcon, LoaderCircleIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { MachineRow } from "../machines";
import { useActions } from "../actions";
import { ClonePopover } from "./MachineChip";

/** Whether this window's project is on a machine; offers to add it (clone) when it is not, and shows that clone's progress. */
export function MachineProject({ state, machine }: { readonly state: HostStateSnapshot; readonly machine: MachineRow }) {
  const info = state.projectMachines, run = useActions();
  const anchor = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  if (!info || !machine.conversations) return null;
  const title = info.title;
  if (machine.local || info.present.includes(machine.environmentId))
    return <span className="env-chip env-project" title={`${title} is on ${machine.label}`}><CheckIcon size={10} />{title}</span>;
  const clone = info.clones.find((item) => item.environmentId === machine.environmentId);
  if (clone) {
    const copying = clone.phase === "done" && clone.copy;
    const failed = clone.phase === "failed" || clone.phase === "cancelled" || copying && clone.copy?.phase === "failed";
    const text = failed ? `Adding ${title} failed${clone.error ?? clone.copy?.error ? `: ${clone.error ?? clone.copy?.error}` : ""}`
      : copying ? `Copying files to ${machine.label}…` : `Adding ${title} · ${clone.stage}${clone.percent !== null ? ` ${clone.percent}%` : ""}`;
    // Only the outcome is announced, not every percent; the buttons name the machine for screen readers.
    const act = (action: string, label: string) => <button className="text-button" aria-label={`${label} adding ${title} to ${machine.label}`} onClick={() => { void run("machineCloneAction", { environmentId: machine.environmentId, action }); }}>{label}</button>;
    return <span className={`env-project-clone${failed ? " failed" : ""}`} data-machine-clone={machine.environmentId}>{failed ? null : <LoaderCircleIcon size={11} className="animate-spin" aria-hidden="true" />}
      <span title={text} {...(failed ? { role: "alert" } : {})}>{text}</span>
      {failed ? <>{act("retry", "Retry")}{act("remove", "Remove")}</> : clone.phase === "running" ? act("cancel", "Cancel") : null}</span>;
  }
  const target = info.targets.find((item) => item.environmentId === machine.environmentId);
  if (!target || !info.cloneSource) return null;
  // Unavailable machines say why in plain text rather than only in a tooltip.
  if (!target.available) return <span className="env-project-unavailable">Can’t add {title}: {target.reason}</span>;
  const closed = () => {
    setAdding(false);
    // A started clone replaces this button with its progress, so focus moves to that row's controls.
    requestAnimationFrame(() => { if (!anchor.current?.isConnected) document.querySelector<HTMLElement>(`[data-machine-clone="${CSS.escape(machine.environmentId)}"] button`)?.focus(); });
  };
  return <>
    <button ref={anchor} className="text-button env-project-add" title={`Clone ${title} onto ${machine.label}`} onClick={() => setAdding(true)}><FolderPlusIcon size={11} aria-hidden="true" />Add {title}…</button>
    {adding && anchor.current ? <ClonePopover state={state} target={target} anchor={anchor.current} source={info.cloneSource} forNewChat={false} onClose={closed} /> : null}
  </>;
}
