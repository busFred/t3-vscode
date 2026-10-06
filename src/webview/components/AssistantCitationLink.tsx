import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssistantCitation } from "@t3tools/contracts";

export function AssistantCitationLink({ citation }: { readonly citation: AssistantCitation }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null); const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPosition(null); trigger.current?.focus(); } };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [position]);
  return <span className="citation-link"><button ref={trigger} className="text-button" title={citation.text} aria-expanded={position !== null} onClick={() => {
    const bounds = trigger.current!.getBoundingClientRect();
    setPosition(position ? null : { left: Math.max(8, Math.min(bounds.left, window.innerWidth - Math.min(352, window.innerWidth - 16) - 8)), top: Math.max(8, Math.min(bounds.bottom + 5, window.innerHeight - Math.min(240, window.innerHeight - 16) - 8)) });
  }}>Assistant quote</button>{position ? createPortal(<div ref={popup} className="citation-preview" role="dialog" aria-label="Saved assistant quote" style={position}>
    <blockquote>{citation.text}</blockquote>{citation.comment ? <p>Comment: {citation.comment}</p> : null}
    <button className="text-button" onClick={() => { setPosition(null); window.dispatchEvent(new CustomEvent("t3-open-citation", { detail: citation })); }}>Open source</button>
  </div>, document.body) : null}</span>;
}
