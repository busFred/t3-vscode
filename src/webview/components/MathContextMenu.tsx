import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActions } from "../actions";

export function MathContextMenu() {
  const run = useActions(); const menu = useRef<HTMLDivElement>(null);
  const [equation, setEquation] = useState<{ latex: string; mathml: string; display: boolean; x: number; y: number } | null>(null);
  useEffect(() => {
    const show = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest(".katex") : null;
      const math = element?.querySelector("math"); const latex = math?.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (!math || latex == null) return;
      event.preventDefault(); event.stopPropagation();
      const copy = math.cloneNode(true) as Element; copy.setAttribute("xmlns", "http://www.w3.org/1998/Math/MathML");
      setEquation({ latex, mathml: copy.outerHTML, display: !!element?.closest(".katex-display"), x: Math.min(event.clientX, Math.max(5, innerWidth - 235)), y: Math.min(event.clientY, Math.max(5, innerHeight - 110)) });
    };
    document.addEventListener("contextmenu", show, true); return () => document.removeEventListener("contextmenu", show, true);
  }, []);
  useEffect(() => {
    if (!equation) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setEquation(null); };
    const blur = () => setEquation(null);
    document.addEventListener("pointerdown", close); window.addEventListener("blur", blur); window.addEventListener("resize", blur);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("blur", blur); window.removeEventListener("resize", blur); };
  }, [equation]);
  if (!equation) return null;
  const choices = [
    { label: "Copy LaTeX", text: equation.latex },
    { label: "Copy LaTeX with delimiters", text: equation.display ? `$$\n${equation.latex}\n$$` : `$${equation.latex}$` },
    { label: "Copy MathML", text: equation.mathml },
  ];
  return createPortal(<div ref={menu} className="math-context-menu" role="menu" aria-label="Equation" style={{ left: equation.x, top: equation.y }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); setEquation(null); return; }
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>{choices.map((choice) => <button key={choice.label} role="menuitem" onClick={() => { void run("copyText", { text: choice.text }); setEquation(null); }}>{choice.label}</button>)}</div>, document.body);
}
