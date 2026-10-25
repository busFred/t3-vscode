import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronRightIcon, GitBranchIcon, LoaderCircleIcon, MonitorIcon, PlusIcon, ServerIcon, CircleXIcon } from "lucide-react";
import type { AddMachineTarget, HostStateSnapshot, MachineChoice } from "../../shared/bridge";
import { updateDraft } from "../composerDrafts";
import { useActions } from "../actions";
import { useBridgeQuery } from "../useBridgeQuery";
import { WorktreePopover } from "./WorktreePopover";

const STATUS: Record<MachineChoice["status"], string> = { connected: "", expiring: "", connecting: "connecting…", reconnecting: "reconnecting…", expired: "pairing expired", disabled: "disabled" };
const available = (machine: MachineChoice) => machine.status === "connected" || machine.status === "expiring";
const icon = (machine: { readonly local: boolean }) => machine.local ? <MonitorIcon size={12} /> : <ServerIcon size={12} />;

/**
 * After a new chat moves to another machine, attachments uploaded to the previous one are uploaded again from their kept
 * copies; marking them pending makes the draft fetch the re-uploaded files, and send waits for them. The host moves a new
 * editor tab's draft from its placeholder thread to the new-chat key, so only that key is marked.
 */
function rehomeAttachments(environmentId: string): void {
  updateDraft("new", (draft) => draft.attachments ? { ...draft, attachments: draft.attachments.map((file) => file.attachment && file.environmentId !== environmentId ? { ...file, pending: true } : file) } : draft);
}
function choosing(state: HostStateSnapshot): boolean {
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  return !thread || thread.canChooseWorkspace === true;
}
/** The machine a new conversation's draft targets, unless it has disconnected; send waits for it. */
export function draftMachineAway(state: HostStateSnapshot): MachineChoice | undefined {
  if (!choosing(state)) return undefined;
  const machine = state.draft.machines?.find((item) => item.environmentId === state.draft.environmentId);
  return machine && !machine.local && !available(machine) ? machine : undefined;
}
/** Why a new chat cannot be sent yet: its machine is away, or the clone it waits for is not ready. */
export function draftSendBlock(state: HostStateSnapshot): string | undefined {
  if (!choosing(state)) return undefined;
  if (draftMachineAway(state)) return "Send when it reconnects";
  const clone = state.draft.clone;
  if (!clone) return undefined;
  if (clone.phase === "running") return "Cloning repository";
  if (clone.phase !== "done") return "Repository not cloned";
  return clone.copy?.phase === "pending" || clone.copy?.phase === "copying" ? "Copying files" : undefined;
}

/** Confirms cloning this repository onto a machine that lacks it, as T3 Code's "Add to another machine" does. */
function ClonePopover({ state, target, anchor, onClose }: { readonly state: HostStateSnapshot; readonly target: AddMachineTarget; readonly anchor: HTMLButtonElement; readonly onClose: () => void }) {
  const source = state.draft.cloneSource;
  const [destination, setDestination] = useState(target.defaultDestination);
  const [protocol, setProtocol] = useState<"ssh" | "https">(source?.protocol ?? (source?.sshUrl ? "ssh" : "https"));
  const files = useBridgeQuery<ReadonlyArray<{ readonly path: string; readonly checked: boolean }>>("listCopyableFiles", {}, "copyable");
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const checked = chosen ?? new Set(files.data?.filter((file) => file.checked).map((file) => file.path));
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false); const run = useActions();
  const submit = async () => {
    if (busy || !destination.trim()) return;
    setBusy(true); setFailed(false);
    const ok = await run("startClone", { environmentId: target.environmentId, destinationPath: destination.trim(), protocol, files: [...checked] });
    setBusy(false);
    if (ok === false) { setFailed(true); return; }
    rehomeAttachments(target.environmentId); close();
  };
  const close = () => { onClose(); anchor.focus(); };
  return <WorktreePopover anchor={anchor} title={`Add ${source?.title ?? "this repository"} to ${target.label}`} onClose={close}>
    <div className="task-editor-fields"><fieldset disabled={busy}>
      <label>Destination folder<input aria-label="Destination folder" value={destination} onChange={(event) => setDestination(event.target.value)} />
        <small>That machine's folder for new projects, plus the repository name.</small></label>
      <label>Clone over<select aria-label="Clone protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as "ssh" | "https")}>
        {source?.sshUrl ? <option value="ssh">SSH · {source.sshUrl}</option> : null}{source?.httpsUrl ? <option value="https">HTTPS · {source.httpsUrl}</option> : null}
      </select><small>Use HTTPS if that machine only has an HTTPS credential helper.</small></label>
      <div className="clone-files" role="group" aria-label="Ignored files to copy"><span>Copy ignored files from this computer</span>
        {files.pending ? <small>Looking for ignored files…</small> : files.error ? <small role="alert">{files.error}</small> : !files.data?.length ? <small>No ignored files to copy.</small>
          : <div className="clone-file-list">{files.data.map((file) => <label key={file.path} className="task-enabled"><input type="checkbox" checked={checked.has(file.path)}
            onChange={(event) => { const next = new Set(checked); if (event.target.checked) next.add(file.path); else next.delete(file.path); setChosen(next); }} /><code>{file.path}</code></label>)}</div>}
        <small>Env files are checked by default; nothing else is copied. Text files under 1 MB only.</small></div>
      {failed ? <p className="task-status" role="alert">Could not start the clone. Your choices are kept.</p> : null}
    </fieldset></div>
    <footer><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="button" className="primary" disabled={busy || !destination.trim() || state.phase !== "ready"} onClick={() => { void submit(); }}>{busy ? "Starting…" : `Clone to ${target.label}`}</button></footer>
  </WorktreePopover>;
}

/** Progress of the clone a new chat waits for, with its actions; failures stay until retried or removed. */
function CloneBanner({ state }: { readonly state: HostStateSnapshot }) {
  const clone = state.draft.clone; const run = useActions(); const [busy, setBusy] = useState(false);
  if (!clone || !choosing(state)) return null;
  const act = (action: string) => {
    setBusy(true);
    // Remove returns the chat to this computer, so its attachments follow it back.
    void run("cloneAction", { action }).then((ok) => { if (ok !== false && action === "remove" && state.environment) rehomeAttachments(state.environment.environmentId); }).finally(() => setBusy(false));
  };
  const action = (label: string, name: string) => <button type="button" className="text-button" disabled={busy} onClick={() => act(name)}>{label}</button>;
  if (clone.phase === "running") return <div className="machine-clone-banner" role="status"><LoaderCircleIcon size={12} /><span className="machine-clone-text">Cloning {clone.name} on {clone.label}</span>
    {clone.percent !== null ? <span className="machine-clone-bar" aria-hidden="true"><i style={{ width: `${clone.percent}%` }} /></span> : null}
    <small>{clone.percent !== null ? `${clone.percent}% · ` : ""}{clone.stage}</small>{action("Cancel", "cancel")}</div>;
  if (clone.phase !== "done") return <div className="machine-clone-banner failed" role="alert"><CircleXIcon size={12} /><span className="machine-clone-text">{clone.phase === "cancelled" ? `Clone cancelled on ${clone.label}.` : `Clone failed on ${clone.label}: ${clone.error ?? "unknown error"}`}</span>
    {action("Retry", "retry")}<span aria-hidden="true">·</span>{action("Remove", "remove")}</div>;
  if (clone.copy?.phase === "failed") return <div className="machine-clone-banner failed" role="alert"><CircleXIcon size={12} /><span className="machine-clone-text">Couldn't copy files to {clone.label}: {clone.copy.error}</span>{action("Retry", "retry")}</div>;
  return <div className="machine-clone-banner" role="status"><LoaderCircleIcon size={12} /><span className="machine-clone-text">Copying files to {clone.label}…</span></div>;
}

/**
 * Where a conversation runs, above the message box. A new conversation chooses among this computer and paired
 * machines with the same repository, or clones it onto one that lacks it; once it has started it stays there,
 * so the chip becomes a plain label.
 */
export function MachineChip({ state, disabled }: { readonly state: HostStateSnapshot; readonly disabled: boolean }) {
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const newChat = choosing(state) && (!!state.draft.machines?.length || !!state.draft.addTargets?.length || !!state.draft.clone);
  const anchor = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [location, setLocation] = useState<{ left: number; bottom: number } | null>(null);
  const [adding, setAdding] = useState(false), [cloneTarget, setCloneTarget] = useState<AddMachineTarget | null>(null);
  const close = useCallback(() => { setOpen(false); setAdding(false); }, []); const run = useActions();
  useLayoutEffect(() => {
    if (!open || !anchor.current) { setLocation(null); return; }
    const box = anchor.current.getBoundingClientRect();
    setLocation({ left: Math.max(6, Math.min(box.left, innerWidth - (menu.current?.offsetWidth ?? 220) - 6)), bottom: innerHeight - box.top + 4 });
  }, [open]);
  // A hidden menu cannot take focus, so it moves in once the menu is placed.
  useLayoutEffect(() => { if (location) menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button:not(:disabled)')?.focus(); }, [location]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", dismiss); window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("resize", close); };
  }, [open, close]);

  if (!newChat) {
    // A started conversation keeps its machine; say where only when there is more than one to tell apart.
    if (!thread || (!state.remoteSession && !state.environments?.rows.length)) return null;
    const label = state.remoteSession?.label ?? state.environment?.label;
    if (!label) return null;
    return <div className="composer-machine"><span className="machine-label" title={state.remoteSession ? `Runs on ${label}. Checkout, worktree and saved-turn diff actions run on that machine and are unavailable here.` : `Runs on ${label}`}>
      {icon({ local: !state.remoteSession })}<span>Runs on {label}</span>{state.remoteSession && thread.branch ? <><span aria-hidden="true">·</span><GitBranchIcon size={11} /><span>{thread.branch}</span></> : null}
    </span></div>;
  }
  const localMachine: MachineChoice = { environmentId: state.environment?.environmentId ?? "local", label: state.environment?.label ?? "This computer", local: true, status: "connected" };
  const machines = state.draft.machines ?? [localMachine];
  const clone = state.draft.clone;
  const current = machines.find((item) => item.environmentId === state.draft.environmentId) ?? (clone ? { environmentId: clone.environmentId, label: clone.label, local: false, status: "connected" as const } : machines[0]!);
  const away = !available(current), cloneFailed = !!clone && clone.phase !== "done" && clone.phase !== "running";
  const status = away ? STATUS[current.status] : clone?.phase === "running" ? "cloning…" : cloneFailed ? "clone failed" : clone?.copy?.phase === "copying" ? "copying files…" : "";
  const choose = (machine: MachineChoice) => {
    close(); anchor.current?.focus();
    if (machine.environmentId === current.environmentId) return;
    void run("chooseMachine", { environmentId: machine.environmentId }).then((ok) => { if (ok !== false) rehomeAttachments(machine.environmentId); });
  };
  const targets = state.draft.addTargets ?? [];
  return <div className="composer-machine">
    <CloneBanner state={state} />
    <button ref={anchor} type="button" className={`composer-chip machine-chip${away || cloneFailed ? " away" : clone?.phase === "running" ? " busy" : ""}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
      aria-label={`Run on: ${current.label}${status ? `, ${status}` : ""}`} title={away ? `${current.label} is ${STATUS[current.status]} Your draft is kept; send it once it is back.` : `This new chat runs on ${current.label}`}
      onClick={() => setOpen(!open)}>
      {icon(current)}<span>{current.label}</span>{status ? <span className="machine-status">· {status}</span> : null}<ChevronDownIcon size={11} />
    </button>
    {open ? createPortal(<div ref={menu} className="thread-actions-popup machine-menu" role="menu" aria-label="Run on" style={location ? { left: location.left, bottom: location.bottom } : { visibility: "hidden" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); anchor.current?.focus(); return; }
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : null;
        if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
      <p className="machine-menu-heading">Run on</p>
      {/* Unavailable machines stay focusable, so a screen reader announces why they cannot be chosen. */}
      {machines.map((machine) => <button key={machine.environmentId} role="menuitemradio" aria-checked={machine.environmentId === current.environmentId} aria-disabled={!available(machine)} className={available(machine) ? undefined : "unavailable"} onClick={() => { if (available(machine)) choose(machine); }}>
        {icon(machine)}<span>{machine.label}</span><span className="menu-detail">{machine.local ? "this computer" : STATUS[machine.status]}</span>
      </button>)}
      {targets.length ? <>
        <hr />
        <button role="menuitem" aria-haspopup="menu" aria-expanded={adding} aria-controls="machine-add-menu" onClick={() => setAdding(!adding)} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); setAdding(true); } }}>
          <PlusIcon size={12} /><span>Add to another machine</span><ChevronRightIcon className="menu-chevron" size={12} />
        </button>
        {adding ? <div id="machine-add-menu" className="thread-actions-inline" role="menu" aria-label="Add to another machine" onKeyDown={(event) => {
          if (event.key !== "ArrowLeft") return;
          event.preventDefault(); event.stopPropagation(); setAdding(false); menu.current?.querySelector<HTMLButtonElement>('[aria-controls="machine-add-menu"]')?.focus();
        }}>{targets.map((target) => <button key={target.environmentId} role="menuitem" aria-disabled={!target.available} className={target.available ? undefined : "unavailable"}
          title={target.reason ? `${target.label}: ${target.reason}` : `Clone this repository onto ${target.label}`}
          onClick={() => { if (!target.available) return; setOpen(false); setAdding(false); setCloneTarget(target); }}>
          <ServerIcon size={12} /><span>{target.label}</span>{target.reason ? <span className="menu-detail">{target.reason}</span> : null}
        </button>)}</div> : null}
      </> : null}
    </div>, document.body) : null}
    {cloneTarget && anchor.current ? <ClonePopover state={state} target={cloneTarget} anchor={anchor.current} onClose={() => setCloneTarget(null)} /> : null}
  </div>;
}
