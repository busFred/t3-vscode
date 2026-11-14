import { useRef, useState } from "react";

/** Grows with the text up to this when the user has not chosen a height. */
export const AUTO_COMPOSER_CEILING = 220;
export const MIN_COMPOSER_HEIGHT = 47;
/** Never let the message box push the transcript off a short panel. */
export const maxComposerHeight = () => Math.max(120, Math.round(window.innerHeight * 0.7));
export const clampComposerHeight = (value: number) => Math.round(Math.min(maxComposerHeight(), Math.max(MIN_COMPOSER_HEIGHT, value)));

/**
 * The grip on the composer's top edge, the same separator the sidebar's machine list uses. Dragging
 * up gives the message box a fixed height, kept per view; double-click returns it to growing with
 * the text. It only sets a size, so typing, paste and undo in the textarea are unaffected.
 */
export function ComposerResize({ height, measure, onLive, onCommit }: {
  readonly height: number | null;
  /** The message box's current rendered height, where a drag from automatic sizing starts. */
  readonly measure: () => number;
  readonly onLive: (height: number | null) => void;
  readonly onCommit: (height: number | null) => void;
}) {
  const drag = useRef<{ y: number; height: number; current: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const finish = () => { const current = drag.current; if (!current) return; drag.current = null; setDragging(false); onCommit(current.current); };
  return <div className="composer-resize" role="separator" tabIndex={0} aria-label="Resize message box" aria-orientation="horizontal"
    aria-valuemin={MIN_COMPOSER_HEIGHT} aria-valuemax={maxComposerHeight()} {...(height !== null ? { "aria-valuenow": height } : {})} data-dragging={dragging || undefined}
    title="Drag or use arrow keys to resize; double-click to size to the text"
    onPointerDown={(event) => {
      if (event.button !== 0) return; event.preventDefault();
      const start = height ?? measure(); drag.current = { y: event.clientY, height: start, current: start }; setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    // The grip is on the top edge, so dragging up makes the box taller.
    onPointerMove={(event) => { const current = drag.current; if (!current) return; current.current = clampComposerHeight(current.height - (event.clientY - current.y)); onLive(current.current); }}
    onPointerUp={(event) => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => { onLive(null); onCommit(null); }}
    onKeyDown={(event) => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return; event.preventDefault();
      const current = height ?? measure();
      const next = clampComposerHeight(event.key === "Home" ? MIN_COMPOSER_HEIGHT : event.key === "End" ? maxComposerHeight() : current + (event.key === "ArrowUp" ? 20 : -20));
      onLive(next); onCommit(next);
    }}><span className="find-grip" /></div>;
}
