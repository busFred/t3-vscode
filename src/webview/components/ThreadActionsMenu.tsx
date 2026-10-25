import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlarmClockIcon, ArchiveIcon, CheckIcon, ChevronRightIcon, CopyIcon, CopyPlusIcon, MailIcon, PencilIcon, PinIcon, RotateCcwIcon, TimerIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import type { ThreadSummary } from "../../shared/bridge";
import { useActions } from "../actions";
import { useTimeFormat } from "../timeFormat";

type MenuItem =
  | { readonly kind: "action"; readonly key: string; readonly label: string; readonly icon?: ReactNode; readonly run: () => void; readonly disabled?: boolean; readonly title?: string | undefined; readonly danger?: boolean; readonly checked?: boolean; readonly detail?: string }
  | { readonly kind: "submenu"; readonly key: string; readonly label: string; readonly icon: ReactNode; readonly items: ReadonlyArray<MenuItem>; readonly disabled?: boolean; readonly title?: string | undefined }
  | { readonly kind: "separator"; readonly key: string };

const ICON = 14;
/** Enabled items of one menu level, not of the submenus inside it. */
const levelButtons = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLButtonElement>(":scope > .menu-entry > button:not(:disabled)") ?? [])];

/** The same actions are available from a history row and an editor header. */
export function ThreadActionsMenu({ thread, workspaceRoot, position, onClose }: { readonly thread: ThreadSummary; readonly workspaceRoot?: string | undefined; readonly position: { x: number; y: number }; readonly onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null), submenu = useRef<HTMLDivElement>(null);
  const [location, setLocation] = useState(position);
  const [open, setOpen] = useState<{ key: string; anchor: HTMLElement; focus: boolean } | null>(null);
  /** Beside the menu where it fits; a sidebar too narrow for both expands it inline under its item instead. */
  const [subLocation, setSubLocation] = useState<{ x: number; y: number } | "inline" | null>(null);
  const run = useActions(), timeOptions = useTimeFormat();
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const element = menu.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => { if ((document.activeElement === document.body || element.contains(document.activeElement) || submenu.current?.contains(document.activeElement)) && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [position]);
  // Kept on screen, including when an inline submenu makes it taller.
  const inline = subLocation === "inline";
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (box) setLocation({ x: Math.max(6, Math.min(position.x, innerWidth - box.width - 6)), y: Math.max(6, Math.min(position.y, innerHeight - box.height - 6)) });
  }, [position, inline]);
  // A submenu opens beside its item, on whichever side fits.
  useLayoutEffect(() => {
    if (!open) { setSubLocation(null); return; }
    const element = submenu.current;
    if (!element || subLocation) return;
    const anchor = open.anchor.getBoundingClientRect(), box = element.getBoundingClientRect();
    const right = anchor.right + 2, left = anchor.left - box.width - 2;
    const x = right + box.width <= innerWidth - 6 ? right : left >= 6 ? left : null;
    setSubLocation(x === null ? "inline" : { x, y: Math.max(6, Math.min(anchor.top - 4, innerHeight - box.height - 6)) });
  }, [open, subLocation]);
  // A hidden submenu cannot take focus, so keyboard opening focuses it once it is placed.
  useLayoutEffect(() => {
    if (open?.focus && subLocation) submenu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, subLocation]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !submenu.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", dismiss); window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("resize", close); };
  }, [onClose]);

  const choose = (action: string, value?: string) => { onClose(); void run("threadAction", { threadId: thread.id, action, ...(value === undefined ? {} : { value }) }); };
  const copy = (text: string) => { onClose(); void run("copyText", { text }); };
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...timeOptions });
  const snoozeItems: MenuItem[] = [...resolveSnoozePresets(new Date()).map((preset): MenuItem => ({ kind: "action", key: preset.id, label: preset.label,
    detail: preset.id === "next-week" ? `${new Date(preset.snoozedUntil).toLocaleDateString(undefined, { weekday: "short" })} ${time(preset.snoozedUntil)}` : time(preset.snoozedUntil), run: () => choose("snooze", preset.snoozedUntil) })),
    { kind: "separator", key: "custom-separator" }, { kind: "action", key: "custom", label: "Custom…", run: () => choose("snooze") }];
  const copyItems: MenuItem[] = [
    ...(thread.worktreePath ?? workspaceRoot ? [{ kind: "action" as const, key: "path", label: "Path", run: () => copy((thread.worktreePath ?? workspaceRoot)!) }] : []),
    ...(thread.branch ? [{ kind: "action" as const, key: "branch", label: "Branch", run: () => copy(thread.branch!) }] : []),
    { kind: "action", key: "id", label: "Thread ID", run: () => copy(thread.id) },
  ];
  const items: MenuItem[] = [
    { kind: "action", key: "pin", label: `${thread.pinned ? "Unpin" : "Pin"} thread`, icon: <PinIcon size={ICON} />, run: () => choose(thread.pinned ? "unpin" : "pin") },
    ...(!thread.archived ? [{ kind: "action" as const, key: "settle", label: `${thread.settled ? "Un-settle" : "Settle"} thread`, icon: thread.settled ? <RotateCcwIcon size={ICON} /> : <CheckIcon size={ICON} />, disabled: !thread.settled && Boolean(thread.activeRunId), run: () => choose(thread.settled ? "unsettle" : "settle") }] : []),
    ...(thread.canSnooze === undefined || thread.archived || thread.settled ? []
      : thread.snoozedUntil ? [{ kind: "action" as const, key: "wake", label: "Wake thread", icon: <AlarmClockIcon size={ICON} />, run: () => choose("unsnooze") }]
      : [{ kind: "submenu" as const, key: "snooze", label: "Snooze", icon: <AlarmClockIcon size={ICON} />, disabled: !thread.canSnooze, title: thread.canSnooze ? undefined : "This thread is waiting for you", items: snoozeItems }]),
    { kind: "separator", key: "edit-separator" },
    { kind: "action", key: "rename", label: "Rename thread", icon: <PencilIcon size={ICON} />, run: () => choose("rename") },
    ...(thread.canRegenerateTitle ? [{ kind: "action" as const, key: "title", label: thread.titleRegenerating ? "Stop regenerating title" : "Regenerate title", icon: <WandSparklesIcon size={ICON} />, run: () => choose(thread.titleRegenerating ? "stop-title-regeneration" : "regenerate-title") }] : []),
    ...(!thread.providerNativeSubagent ? [{ kind: "action" as const, key: "duplicate", label: "Duplicate thread", icon: <CopyPlusIcon size={ICON} />, disabled: Boolean(thread.activeRunId), title: thread.activeRunId ? "Wait for the current response to finish" : undefined, run: () => choose("duplicate") }] : []),
    ...(thread.canMarkUnread ? [{ kind: "action" as const, key: "unread", label: "Mark unread", icon: <MailIcon size={ICON} />, run: () => choose("mark-unread") }] : []),
    ...(thread.autoSettle !== undefined ? [{ kind: "submenu" as const, key: "auto-settle", label: "Auto-settle", icon: <TimerIcon size={ICON} />, items: [
      { kind: "action" as const, key: "on", label: "Enabled", checked: thread.autoSettle, run: () => choose("auto-settle-on") },
      { kind: "action" as const, key: "off", label: "Disabled", checked: !thread.autoSettle, run: () => choose("auto-settle-off") },
    ] }] : []),
    { kind: "separator", key: "copy-separator" },
    { kind: "submenu", key: "copy", label: "Copy", icon: <CopyIcon size={ICON} />, items: copyItems },
    { kind: "separator", key: "archive-separator" },
    { kind: "action", key: "archive", label: `${thread.archived ? "Restore" : "Archive"} thread`, icon: <ArchiveIcon size={ICON} />, disabled: !thread.archived && Boolean(thread.activeRunId), run: () => choose(thread.archived ? "unarchive" : "archive") },
    { kind: "action", key: "delete", label: "Delete thread", icon: <Trash2Icon size={ICON} />, danger: true, run: () => choose("delete") },
  ];
  // Each submenu is placed afresh; once the view proved too narrow, the next one expands inline too.
  const openSubmenu = (key: string, anchor: HTMLElement, focus: boolean) => {
    if (open?.key === key && open.focus === focus) return;
    setOpen({ key, anchor, focus }); setSubLocation((current) => current === "inline" ? current : null);
  };
  const openItem = open ? items.find((item) => item.kind === "submenu" && item.key === open.key) : undefined;

  const navigate = (event: KeyboardEvent<HTMLDivElement>, level: HTMLElement | null, nested: boolean) => {
    if (event.key === "Escape" || (nested && event.key === "ArrowLeft")) {
      event.preventDefault(); event.stopPropagation();
      if (nested && open) { const anchor = open.anchor; setOpen(null); anchor.focus(); } else onClose();
      return;
    }
    const buttons = levelButtons(level);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
    if (next !== null) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
  };
  const entry = (item: MenuItem, nested: boolean) => {
    if (item.kind === "separator") return <hr key={item.key} />;
    if (item.kind === "submenu") return <div className="menu-entry" key={item.key} onPointerEnter={(event) => { if (!item.disabled) openSubmenu(item.key, event.currentTarget.firstElementChild as HTMLElement, false); }}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={open?.key === item.key} disabled={item.disabled} title={item.title}
        onClick={(event) => openSubmenu(item.key, event.currentTarget, true)}
        onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openSubmenu(item.key, event.currentTarget, true); } }}>
        {item.icon}{item.label}<ChevronRightIcon className="menu-chevron" size={13} />
      </button>
      {inline && open?.key === item.key ? <div ref={submenu} className="thread-actions-inline" role="menu" aria-label={item.label} onKeyDown={(event) => navigate(event, submenu.current, true)}>
        {item.items.map((child) => entry(child, true))}
      </div> : null}
    </div>;
    return <div className="menu-entry" key={item.key} onPointerEnter={nested ? undefined : () => setOpen(null)}>
      <button role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked} className={item.danger ? "danger" : undefined} disabled={item.disabled} title={item.title} onClick={item.run}>
        {item.checked !== undefined ? <span className="menu-check">{item.checked ? <CheckIcon size={13} /> : null}</span> : item.icon}{item.label}{item.detail ? <span className="menu-detail">{item.detail}</span> : null}
      </button>
    </div>;
  };
  return createPortal(<>
    <div ref={menu} className="thread-actions-popup" role="menu" aria-label={`Actions for ${thread.title}`} style={{ left: location.x, top: location.y }} onKeyDown={(event) => navigate(event, menu.current, false)}>
      {items.map((item) => entry(item, false))}
    </div>
    {openItem?.kind === "submenu" && !inline ? <div ref={submenu} className="thread-actions-popup thread-actions-submenu" role="menu" aria-label={openItem.label}
      style={typeof subLocation === "object" && subLocation ? { left: subLocation.x, top: subLocation.y } : { left: 0, top: 0, visibility: "hidden" }} onKeyDown={(event) => navigate(event, submenu.current, true)}>
      {openItem.items.map((item) => entry(item, true))}
    </div> : null}
  </>, document.body);
}
