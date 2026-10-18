import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "lucide-react";
import { SESSION_SORTS, type SessionSort } from "../../shared/sessionSort";
import { clampMenuPosition } from "../../shared/assistantQuoteMenu";

export function SessionSortMenu({ anchor, value, onChange, onClose }: { anchor: HTMLButtonElement; value: SessionSort; onChange: (value: SessionSort) => void; onClose: () => void }) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const node = popup.current!; const box = anchor.getBoundingClientRect();
    setPosition(clampMenuPosition({ x: box.right - node.offsetWidth, y: box.bottom + 4 }, { width: node.offsetWidth, height: node.offsetHeight }, { width: innerWidth, height: innerHeight }));
    node.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", onClose); window.addEventListener("blur", onClose);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", onClose); window.removeEventListener("blur", onClose); };
  }, [anchor, onClose]);
  return createPortal(<div ref={popup} className="selection-context-menu session-sort-menu" role="menu" aria-label="Sort sessions" style={{ left: position.x, top: position.y }} onKeyDown={event => {
    if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); return; }
    const buttons = [...popup.current!.querySelectorAll<HTMLButtonElement>("button")]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>{SESSION_SORTS.map(option => <button key={option.value} role="menuitemradio" aria-checked={value === option.value} onClick={() => { onChange(option.value); onClose(); anchor.focus(); }}><CheckIcon size={13} style={{ visibility: value === option.value ? "visible" : "hidden" }} />{option.label}</button>)}</div>, document.body);
}
