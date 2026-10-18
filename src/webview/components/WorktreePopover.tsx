import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import "./worktrees.css";

/** Uses the same anchored dialog placement and field styling as the existing model/task editors. */
export function WorktreePopover({ anchor, title, onClose, children }: { readonly anchor: HTMLButtonElement; readonly title: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.getBoundingClientRect(), width = Math.min(400, innerWidth - 16);
      const above = box.top - 14, below = innerHeight - box.bottom - 14;
      setPosition({ left: Math.max(8, Math.min(box.left, innerWidth - width - 8)), width, maxHeight: Math.max(100, Math.max(above, below)), ...(above > below ? { bottom: innerHeight - box.top + 6 } : { top: box.bottom + 6 }) });
    };
    place(); window.addEventListener("resize", place); return () => window.removeEventListener("resize", place);
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      // The model picker is a second portal owned by a field in this dialog.
      if (!popup.current?.contains(target) && !anchor.contains(target) && !target.closest(".model-picker")) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [anchor, onClose]);
  useEffect(() => { popup.current?.querySelector<HTMLElement>("button, input, select")?.focus(); }, []);
  return createPortal(<div ref={popup} className="worktree-popover scheduled-task-editor" role="dialog" aria-label={title} style={position} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); } }}>
    <header className="worktree-popover-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={() => { onClose(); anchor.focus(); }}><XIcon size={14} /></button></header>{children}
  </div>, document.body);
}
