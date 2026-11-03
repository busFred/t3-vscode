import { useRef, useState } from "react";
import { FolderPlusIcon, FolderXIcon, LoaderCircleIcon } from "lucide-react";
import type { HostStateSnapshot, MachineClone } from "../../shared/bridge";
import type { MachineRow } from "../machines";
import { useActions } from "../actions";
import { ClonePopover } from "./MachineChip";

const cloneOf = (state: HostStateSnapshot, machine: MachineRow): MachineClone | undefined => state.projectMachines?.clones.find((item) => item.environmentId === machine.environmentId);

/**
 * Offer to add this window's project when it is missing; hide the project action once it is there.
 * Keep the clone's existing progress and failure indicators while it runs.
 */
export function MachineProject({ state, machine }: { readonly state: HostStateSnapshot; readonly machine: MachineRow }) {
  const info = state.projectMachines;
  const anchor = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  if (!info || !machine.conversations) return null;
  const title = info.title;
  if (machine.local || info.present.includes(machine.environmentId)) return null;
  const clone = cloneOf(state, machine);
  if (clone) {
    const failed = clone.phase === "failed" || clone.phase === "cancelled" || clone.copy?.phase === "failed";
    const label = `${failed ? "Could not add" : "Adding"} ${title} to ${machine.label}`;
    return <span className="env-project" role="img" aria-label={label} title={label}>{failed ? <FolderXIcon size={13} aria-hidden="true" /> : <LoaderCircleIcon size={13} className="animate-spin" aria-hidden="true" />}</span>;
  }
  const target = info.targets.find((item) => item.environmentId === machine.environmentId);
  if (!target || !info.cloneSource) return null;
  if (!target.available) {
    const reason = `Can’t add ${title} to ${machine.label}: ${target.reason}`;
    return <button type="button" className="icon-button env-project-add" aria-disabled="true" aria-label={reason} title={reason}><FolderXIcon size={13} aria-hidden="true" /></button>;
  }
  const closed = () => {
    setAdding(false);
    // A started clone replaces this button with its progress, so focus moves to that row's controls.
    requestAnimationFrame(() => { if (!anchor.current?.isConnected) document.querySelector<HTMLElement>(`[data-machine-clone="${CSS.escape(machine.environmentId)}"] button`)?.focus(); });
  };
  return <>
    <button ref={anchor} type="button" className="icon-button env-project-add" aria-label={`Add ${title} to ${machine.label}…`} title={`Add ${title} to ${machine.label}`} onClick={() => setAdding(true)}><FolderPlusIcon size={13} aria-hidden="true" /></button>
    {adding && anchor.current ? <ClonePopover state={state} target={target} anchor={anchor.current} source={info.cloneSource} forNewChat={false} onClose={closed} /> : null}
  </>;
}

/** A clone started from the Machines list: progress, then Cancel, or Retry and Remove after a failure. */
export function MachineCloneStatus({ state, machine }: { readonly state: HostStateSnapshot; readonly machine: MachineRow }) {
  const run = useActions(), clone = cloneOf(state, machine), title = state.projectMachines?.title;
  if (!clone || !title) return null;
  const copying = clone.phase === "done" && clone.copy;
  const failed = clone.phase === "failed" || clone.phase === "cancelled" || copying && clone.copy?.phase === "failed";
  const text = failed ? `Adding ${title} failed${clone.error ?? clone.copy?.error ? `: ${clone.error ?? clone.copy?.error}` : ""}`
    : copying ? `Copying files to ${machine.label}…` : `Adding ${title} · ${clone.stage}${clone.percent !== null ? ` ${clone.percent}%` : ""}`;
  // Only the outcome is announced, not every percent; the buttons name the machine for screen readers.
  const act = (action: string, label: string) => <button className="text-button" aria-label={`${label} adding ${title} to ${machine.label}`} onClick={() => { void run("machineCloneAction", { environmentId: machine.environmentId, action }); }}>{label}</button>;
  return <span className={`env-project-clone${failed ? " failed" : ""}`} data-machine-clone={machine.environmentId}>
    <span title={text} {...(failed ? { role: "alert" } : {})}>{text}</span>
    {failed ? <>{act("retry", "Retry")}{act("remove", "Remove")}</> : clone.phase === "running" ? act("cancel", "Cancel") : null}</span>;
}
