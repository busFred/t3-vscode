import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { ThreadList } from "./ThreadList";

/** A local selector: opening history never hands navigation to another editor group. */
export function SessionHistory({ state, anchor, onClose }: {
  readonly state: HostStateSnapshot;
  readonly anchor: HTMLButtonElement;
  readonly onClose: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 40, width: 350, maxHeight: 440 });
  const selecting = useRef(false);
  const run = useActions();
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const width = Math.max(0, Math.min(350, window.innerWidth - 16));
      const top = Math.min(bounds.bottom + 5, Math.max(8, window.innerHeight - 100));
      setPosition({ left: Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8)), top, width, maxHeight: Math.max(0, Math.min(440, window.innerHeight - top - 8)) });
    };
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  useEffect(() => {
    popup.current?.querySelector<HTMLInputElement>("input")?.focus();
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [anchor, onClose]);
  return createPortal(<div ref={popup} id="session-history" className="session-history-picker" role="dialog" aria-label="History" style={position} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); return; }
    const input = popup.current?.querySelector<HTMLInputElement>("input");
    const rows = [...(popup.current?.querySelectorAll<HTMLButtonElement>(".thread") ?? [])].filter((row) => row.getClientRects().length > 0);
    if (event.key === "Enter" && event.target === input) { event.preventDefault(); rows[0]?.click(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || ((event.key === "Home" || event.key === "End") && event.target === input)) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : index - 1;
    event.preventDefault(); if (next < 0) input?.focus(); else rows[next]?.focus();
  }}>
    <ThreadList state={state} compact onSelect={(threadId) => {
      if (selecting.current) return;
      selecting.current = true;
      void run("selectThread", { threadId }).then((ok) => {
        selecting.current = false;
        if (ok) { onClose(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("t3-focus-composer", { detail: { draftKey: threadId } }))); }
      });
    }} />
  </div>, document.body);
}
