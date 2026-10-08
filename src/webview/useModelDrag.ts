import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

type Drag = { instanceId: string; model: string; label: string; order: string[]; x: number; y: number; startX: number; startY: number;
  active: boolean; valid: boolean; before: string | null; line: number; left: number; width: number; pointer: number };

/** A grip-only pointer drag, including touch, with cancellation and scroll-edge movement. */
export function useModelDrag(popup: RefObject<HTMLDivElement | null>, signature: string,
  save: (instanceId: string, model: string, before: string | null, order: string[]) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = useRef<Drag | null>(null);
  const saveRef = useRef(save); saveRef.current = save;
  const cancel = () => { current.current = null; setDrag(null); };
  useEffect(() => { cancel(); }, [signature]);
  useEffect(() => {
    let frame = 0;
    const locate = (d: Drag): Drag => {
      const group = [...(popup.current?.querySelectorAll<HTMLElement>("[data-model-provider]") ?? [])].find((node) => node.dataset.modelProvider === d.instanceId);
      const list = popup.current?.querySelector<HTMLElement>(".model-options");
      if (!group || !list) return { ...d, valid: false };
      const bounds = group.getBoundingClientRect(), viewport = list.getBoundingClientRect();
      const rows = [...group.querySelectorAll<HTMLElement>("[data-model-slug]")].filter((row) => row.dataset.modelSlug !== d.model);
      const next = rows.find((row) => { const rect = row.getBoundingClientRect(); return d.y < rect.top + rect.height / 2; });
      const line = next?.getBoundingClientRect().top ?? rows.at(-1)?.getBoundingClientRect().bottom ?? bounds.top;
      return { ...d, before: next?.dataset.modelSlug ?? null, line, left: bounds.left, width: bounds.width,
        valid: d.x >= viewport.left && d.x <= viewport.right && d.y >= viewport.top && d.y <= viewport.bottom && d.y >= bounds.top && d.y <= bounds.bottom };
    };
    const scroll = () => {
      const d = current.current, list = popup.current?.querySelector<HTMLElement>(".model-options");
      if (d?.active && list) {
        const box = list.getBoundingClientRect();
        if (d.x >= box.left && d.x <= box.right && d.y >= box.top && d.y <= box.bottom) {
          const amount = d.y < box.top + 32 ? -8 : d.y > box.bottom - 32 ? 8 : 0;
          if (amount) { list.scrollTop += amount; current.current = locate(d); setDrag(current.current); }
        }
      }
      if (current.current) frame = requestAnimationFrame(scroll); else frame = 0;
    };
    const move = (event: PointerEvent) => {
      const d = current.current;
      if (!d || d.pointer !== event.pointerId) return;
      event.preventDefault();
      current.current = locate({ ...d, x: event.clientX, y: event.clientY,
        active: d.active || Math.hypot(event.clientX - d.startX, event.clientY - d.startY) >= 4 });
      setDrag(current.current);
      if (!frame) frame = requestAnimationFrame(scroll);
    };
    const end = (event: PointerEvent) => {
      const d = current.current;
      if (!d || d.pointer !== event.pointerId) return;
      const drop = locate({ ...d, x: event.clientX, y: event.clientY });
      cancel(); cancelAnimationFrame(frame); frame = 0;
      if (event.type === "pointerup" && drop.active && drop.valid) saveRef.current(d.instanceId, d.model, drop.before, d.order);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && current.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } };
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end); window.addEventListener("blur", cancel); window.addEventListener("keydown", escape, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); };
  }, [popup]);
  return { drag, start: (event: ReactPointerEvent<HTMLButtonElement>, instanceId: string, model: string, label: string, order: string[]) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    current.current = { instanceId, model, label, order, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      active: false, valid: false, before: null, line: 0, left: 0, width: 0, pointer: event.pointerId };
  } };
}
