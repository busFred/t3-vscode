import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArchiveIcon, PencilIcon, PinIcon, Trash2Icon } from "lucide-react";
import type { ThreadSummary } from "../../shared/bridge";
import { useActions } from "../actions";

/** The same actions are available from a history row and an editor header. */
export function ThreadActionsMenu({ thread, position, onClose }: { readonly thread: ThreadSummary; readonly position: { x: number; y: number }; readonly onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [location, setLocation] = useState(position);
  const run = useActions();
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const element = menu.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setLocation({ x: Math.max(6, Math.min(position.x, innerWidth - box.width - 6)), y: Math.max(6, Math.min(position.y, innerHeight - box.height - 6)) });
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => { if ((document.activeElement === document.body || element.contains(document.activeElement)) && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [position]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", dismiss); window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("resize", close); };
  }, [onClose]);
  const choose = (action: string) => { onClose(); void run("threadAction", { threadId: thread.id, action }); };
  return createPortal(<div ref={menu} className="thread-actions-popup" role="menu" aria-label={`Actions for ${thread.title}`} style={{ left: location.x, top: location.y }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
    if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
  }}>
    <button role="menuitem" onClick={() => choose("rename")}><PencilIcon size={14} />Rename thread</button>
    <button role="menuitem" onClick={() => choose(thread.pinned ? "unpin" : "pin")}><PinIcon size={14} />{thread.pinned ? "Unpin" : "Pin"} thread</button>
    <button role="menuitem" disabled={!thread.archived && Boolean(thread.activeRunId)} onClick={() => choose(thread.archived ? "unarchive" : "archive")}><ArchiveIcon size={14} />{thread.archived ? "Restore" : "Archive"} thread</button>
    <hr /><button role="menuitem" className="danger" onClick={() => choose("delete")}><Trash2Icon size={14} />Delete thread</button>
  </div>, document.body);
}
