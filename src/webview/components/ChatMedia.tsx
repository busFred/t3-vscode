import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, CopyIcon, Maximize2Icon, ScanIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { mediaKindFromPath } from "@t3tools/shared/filePreview";
import type { ChatAsset, ChatAssetReference, ChatAssetSource } from "../../shared/chatVisuals";
import { bridge } from "../bridge-client";
import { useActions } from "../actions";
import { copyImage } from "../imageClipboard";
import { FIT, MAX_ZOOM, ZOOM_STEP, canPan, clampPan, currentScale, fitScale, formatZoom, wheelFactor, zoomBy, zoomKey, type Point, type Size, type ZoomState } from "../imageZoom";

const assets = new Map<string, Promise<ChatAsset>>();
export function useChatAsset(threadId: string, source: ChatAssetSource | undefined, reference: ChatAssetReference | null) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; asset?: ChatAsset; error?: string }>({ key: "" });
  const payload = JSON.stringify({ threadId, ...source, reference }); const key = `${payload}:${revision}`;
  useEffect(() => {
    if (!source || !reference) return;
    let cancelled = false;
    let pending = assets.get(payload);
    if (!pending || revision > 0) {
      pending = bridge.request<ChatAsset>("chatAsset", JSON.parse(payload), 30_000);
      assets.set(payload, pending);
      if (assets.size > 128) assets.delete(assets.keys().next().value!);
      void pending.catch(() => { if (assets.get(payload) === pending) assets.delete(payload); });
    }
    void pending.then((asset) => {
      if (asset.expiresAt <= Date.now() + 30_000) { assets.delete(payload); if (!cancelled) setRevision((value) => value + 1); return; }
      if (!cancelled) setResult({ key, asset });
    }, (cause: unknown) => { if (!cancelled) setResult({ key, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { cancelled = true; };
  }, [payload, key, revision, !!source, !!reference]);
  return { asset: result.key === key ? result.asset : undefined, error: result.key === key ? result.error : undefined, retry: () => { assets.delete(payload); setRevision((value) => value + 1); } };
}

export function ExpandedVisual({ title, children, onClose, className = "" }: { title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  return createPortal(<div className="visual-expanded" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}><div className={`visual-expanded-content ${className}`} onClick={(event) => event.stopPropagation()}><button className="icon-button" autoFocus aria-label="Close preview" onClick={onClose}><XIcon size={17} /></button>{children}</div></div>, document.body);
}
export function openVisual(detail: { title: string; src: string } | { title: string; svg: string }) {
  window.dispatchEvent(new CustomEvent("t3-expand-visual", { detail }));
}
/** Zoom is absolute (1 = natural pixels) and null while fitting; the image sits at natural size and is scaled and panned with one transform. */
function ImageViewer({ title, src }: { title: string; src: string }) {
  const stage = useRef<HTMLDivElement>(null); const drag = useRef<{ id: number; x: number; y: number; pan: Point } | null>(null);
  const [view, setView] = useState<Size>({ width: 0, height: 0 }); const [image, setImage] = useState<Size>({ width: 0, height: 0 });
  const [state, setState] = useState<ZoomState>(FIT); const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const fit = fitScale(view, image); const scale = Math.max(currentScale(state, fit), fit); const pan = clampPan(state.pan, scale, view, image);
  const latest = useRef({ view, image, copy: () => {} }); latest.current.view = view; latest.current.image = image;
  const zoom = (factor: number, anchor: Point = { x: 0, y: 0 }) => setState((value) => zoomBy(value, factor, anchor, latest.current.view, latest.current.image));
  latest.current.copy = () => { copyImage(src).then(() => setStatus({ ok: true, text: "Image copied" }), (cause: unknown) => setStatus({ ok: false, text: cause instanceof Error ? cause.message : "Copy failed." })); };
  useEffect(() => { if (!status) return; const timer = setTimeout(() => setStatus(null), status.ok ? 2000 : 4500); return () => clearTimeout(timer); }, [status]);
  useEffect(() => {
    const element = stage.current!;
    const measure = () => setView({ width: element.clientWidth, height: element.clientHeight }); measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault(); const box = element.getBoundingClientRect();
      setState((value) => zoomBy(value, wheelFactor(event.deltaY, event.deltaMode), { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }, latest.current.view, latest.current.image));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener("wheel", wheel); };
  }, []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      // Focus can be tabbed to a field behind the dialog; its typing and copying stay its own.
      const field = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      const action = event.defaultPrevented || event.isComposing || field ? null : zoomKey(event);
      if (!action) return;
      if (action === "copy") { if (window.getSelection()?.toString()) return; event.preventDefault(); latest.current.copy(); return; }
      event.preventDefault(); if (action === "reset") setState(FIT); else zoom(action === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    document.addEventListener("keydown", keys); return () => document.removeEventListener("keydown", keys);
  }, []);
  const ready = image.width > 0; const panning = canPan(scale, fit);
  return <>
    <div className="image-viewer-tools" role="toolbar" aria-label="Image tools">
      <button className="icon-button" title="Zoom out (-)" aria-label="Zoom out" disabled={!ready || !panning} onClick={() => zoom(1 / ZOOM_STEP)}><ZoomOutIcon size={15} /></button>
      <span className="image-zoom-label">{ready ? formatZoom(scale) : "…"}</span>
      <button className="icon-button" title="Zoom in (+)" aria-label="Zoom in" disabled={!ready || scale >= MAX_ZOOM} onClick={() => zoom(ZOOM_STEP)}><ZoomInIcon size={15} /></button>
      <button className="icon-button" title="Fit to window (0)" aria-label="Fit to window" disabled={!ready || state.zoom === null} onClick={() => setState(FIT)}><ScanIcon size={15} /></button>
      <button className="icon-button" title="Copy image (Ctrl+C)" aria-label="Copy image" onClick={() => latest.current.copy()}>{status?.ok ? <CheckIcon size={15} /> : <CopyIcon size={15} />}</button>
      <span className={`image-copy-status${status?.ok === false ? " failed" : ""}`} role="status">{status?.text}</span>
    </div>
    <div ref={stage} className={`image-stage${panning ? " pannable" : ""}${dragging ? " dragging" : ""}`}
      onPointerDown={(event) => { if (event.button !== 0 || !panning) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan }; setDragging(true); }}
      onPointerMove={(event) => { const start = drag.current; if (start?.id === event.pointerId) setState((value) => ({ zoom: value.zoom, pan: clampPan({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y }, scale, view, image) })); }}
      onPointerUp={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }}>
      <img src={src} alt={title} draggable={false} className={ready ? "ready" : undefined}
        style={ready ? { width: image.width, height: image.height, transform: `translate(${pan.x}px, ${pan.y}px) translate(-50%, -50%) scale(${scale})` } : undefined}
        onError={() => setStatus({ ok: false, text: "Image could not be loaded." })} onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth || 300, height: event.currentTarget.naturalHeight || 150 })} />
    </div>
  </>;
}
/** Lives outside virtualized rows so opening a preview cannot evict its own dialog. */
export function VisualDialog() {
  const [visual, setVisual] = useState<{ title: string; src?: string; svg?: string } | null>(null);
  useEffect(() => {
    const open = (event: Event) => setVisual((event as CustomEvent).detail);
    window.addEventListener("t3-expand-visual", open); return () => window.removeEventListener("t3-expand-visual", open);
  }, []);
  return visual ? <ExpandedVisual title={visual.title} className={visual.src ? "image-viewer" : ""} onClose={() => setVisual(null)}>{visual.src ? <ImageViewer key={visual.src} title={visual.title} src={visual.src} /> : <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: visual.svg ?? "" }} />}</ExpandedVisual> : null;
}

export function ChatMedia({ src, alt = "Image", threadId, source, attachmentId, kind: requestedKind }: {
  src: string; alt?: string; threadId: string; source?: ChatAssetSource | undefined; attachmentId?: string; kind?: "image" | "video" | "audio";
}) {
  const run = useActions(); const [failed, setFailed] = useState(false);
  const classified = classifyMarkdownImageSource(src, "/");
  const direct = !attachmentId && classified._tag === "Direct" && /^(https?:|data:(?:image|video|audio)\/)/i.test(classified.uri) ? classified.uri : null;
  const reference: ChatAssetReference | null = attachmentId ? { kind: "attachment", attachmentId } : classified._tag === "WorkspaceFile" ? { kind: "media", path: src } : null;
  const { asset, error, retry } = useChatAsset(threadId, source, direct ? null : reference);
  const url = direct ?? asset?.url;
  const kind = requestedKind ?? mediaKindFromPath(src) ?? "image";
  useEffect(() => setFailed(false), [url]);
  if (!direct && !reference) return <span className="attachment-label">{alt}</span>;
  if (error || failed) return <span className="visual-failure" role="status">{alt}: {error ?? "Media could not be loaded."}<button className="text-button" onClick={() => { setFailed(false); retry(); }}>Retry</button><button className="text-button" onClick={() => { void run("openLink", { href: src, threadId }); }}>Open</button></span>;
  if (!url) return <span className="visual-loading" role="status">Loading {alt}…</span>;
  if (kind === "video") return <video className="chat-media" controls preload="metadata" src={url} aria-label={alt} onError={() => setFailed(true)} />;
  if (kind === "audio") return <audio className="chat-media" controls preload="metadata" src={url} aria-label={alt} onError={() => setFailed(true)} />;
  return <span className="chat-image"><button className="image-preview-button" aria-label={`Preview ${alt}`} onClick={() => openVisual({ title: alt, src: url })}><img className="chat-media" src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} /></button><button className="icon-button expand-visual" title="Expand image" aria-label={`Expand ${alt}`} onClick={() => openVisual({ title: alt, src: url })}><Maximize2Icon size={13} /></button></span>;
}
