import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "lucide-react";
import { clampMenuPosition } from "../../shared/assistantQuoteMenu";
import type { ThreadSummary } from "../../shared/bridge";

export function SessionTagMenu({ anchor, tags, selected, onChange, environments, onToggle, onClose }: { anchor: HTMLButtonElement; tags: string[]; selected: ReadonlySet<string>; onChange: (tags: ReadonlySet<string>) => void; environments: ThreadSummary[]; onToggle: (threadId: string) => void; onClose: () => void }) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const node = popup.current!; const box = anchor.getBoundingClientRect();
    setPosition(clampMenuPosition({ x: box.right - node.offsetWidth, y: box.bottom + 4 }, { width: node.offsetWidth, height: node.offsetHeight }, { width: innerWidth, height: innerHeight }));
    (node.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? node.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", onClose); window.addEventListener("blur", onClose);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", onClose); window.removeEventListener("blur", onClose); };
  }, [anchor, onClose]);
  return createPortal(<div ref={popup} className="selection-context-menu session-tag-menu" role="menu" aria-label="Filter sessions by tag" style={{ left: position.x, top: position.y }} onKeyDown={event => {
    if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); return; }
    const buttons = [...popup.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>
    {tags.length ? tags.map(tag => <button key={tag} role="menuitemcheckbox" aria-checked={selected.has(tag)} onClick={() => { const next = new Set(selected); if (next.has(tag)) next.delete(tag); else next.add(tag); onChange(next); }}><CheckIcon size={13} style={{ visibility: selected.has(tag) ? "visible" : "hidden" }} />{tag}</button>) : <p className="tag-menu-hint">No tags yet. Add tags from a session's actions menu → Tags.</p>}
    <button role="menuitem" onClick={() => onChange(new Set())}>Clear</button>
    {environments.length ? <div role="separator" className="tag-menu-separator" /> : null}
    {environments.map(thread => <button key={thread.environmentId ?? "local"} role="menuitemcheckbox" aria-checked={thread.hideTaggedThreads ?? false} title={thread.hiddenThreadTags?.join(", ")} onClick={() => onToggle(thread.id)}><CheckIcon size={13} style={{ visibility: thread.hideTaggedThreads ? "visible" : "hidden" }} />Hide tagged threads{thread.environmentLabel ? ` · ${thread.environmentLabel}` : ""}</button>)}
  </div>, document.body);
}
