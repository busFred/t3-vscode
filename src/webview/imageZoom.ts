export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
/** `zoom` is absolute (1 = natural pixels) and null while fitting; `pan` is the image centre's offset from the viewport centre. */
export interface ZoomState { zoom: number | null; pan: Point }

export const ZOOM_STEP = 1.25; export const MAX_ZOOM = 16;
export const FIT: ZoomState = { zoom: null, pan: { x: 0, y: 0 } };

/** Largest scale that shows the whole image; small images stay at natural size instead of blowing up. */
export function fitScale(view: Size, image: Size): number {
  if (!(view.width > 0 && view.height > 0 && image.width > 0 && image.height > 0)) return 1;
  return Math.min(view.width / image.width, view.height / image.height, 1);
}
export const currentScale = (state: ZoomState, fit: number) => state.zoom ?? fit;
export const formatZoom = (scale: number) => `${Math.round(scale * 100)}%`;
export const canPan = (scale: number, fit: number) => scale > fit * 1.001;

function clampAxis(value: number, scaled: number, view: number) {
  const limit = Math.max(0, (scaled - view) / 2);
  return Math.min(limit, Math.max(-limit, value));
}
/** Keeps the image covering the viewport once it is larger than it, and centred while smaller. */
export function clampPan(pan: Point, scale: number, view: Size, image: Size): Point {
  return { x: clampAxis(pan.x, image.width * scale, view.width), y: clampAxis(pan.y, image.height * scale, view.height) };
}
/** Zooms to `target`, holding the image point under `anchor` (relative to the viewport centre) still. At or below fit it returns to fit. */
export function zoomTo(state: ZoomState, target: number, anchor: Point, view: Size, image: Size): ZoomState {
  const fit = fitScale(view, image), from = currentScale(state, fit);
  const next = Math.min(Math.max(target, fit), Math.max(fit, MAX_ZOOM));
  if (!(next > fit * 1.001)) return FIT;
  const ratio = next / from;
  return { zoom: next, pan: clampPan({ x: anchor.x - (anchor.x - state.pan.x) * ratio, y: anchor.y - (anchor.y - state.pan.y) * ratio }, next, view, image) };
}
export function zoomBy(state: ZoomState, factor: number, anchor: Point, view: Size, image: Size): ZoomState {
  return zoomTo(state, currentScale(state, fitScale(view, image)) * factor, anchor, view, image);
}
/** Ctrl/Cmd+wheel (and pinch) deltas to a multiplicative factor; line-mode wheels report lines, not pixels. */
export const wheelFactor = (deltaY: number, deltaMode = 0) => Math.exp(-deltaY * (deltaMode === 1 ? 0.03 : 0.0025));

/** Shortcut for the viewer: +, -, 0 without Ctrl/Cmd/Alt, or Ctrl/Cmd+C. */
export function zoomKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): "in" | "out" | "reset" | "copy" | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) return !event.shiftKey && event.key.toLowerCase() === "c" ? "copy" : null;
  return event.key === "+" || event.key === "=" ? "in" : event.key === "-" || event.key === "_" ? "out" : event.key === "0" ? "reset" : null;
}
