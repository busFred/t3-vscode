import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2Icon, XIcon } from "lucide-react";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { mediaKindFromPath } from "@t3tools/shared/filePreview";
import type { ChatAsset, ChatAssetReference, ChatAssetSource } from "../../shared/chatVisuals";
import { bridge } from "../bridge-client";
import { useActions } from "../actions";

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

export function ExpandedVisual({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  return createPortal(<div className="visual-expanded" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}><div className="visual-expanded-content" onClick={(event) => event.stopPropagation()}><button className="icon-button" autoFocus aria-label="Close preview" onClick={onClose}><XIcon size={17} /></button>{children}</div></div>, document.body);
}
export function openVisual(detail: { title: string; src: string } | { title: string; svg: string }) {
  window.dispatchEvent(new CustomEvent("t3-expand-visual", { detail }));
}
/** Lives outside virtualized rows so opening a preview cannot evict its own dialog. */
export function VisualDialog() {
  const [visual, setVisual] = useState<{ title: string; src?: string; svg?: string } | null>(null);
  useEffect(() => {
    const open = (event: Event) => setVisual((event as CustomEvent).detail);
    window.addEventListener("t3-expand-visual", open); return () => window.removeEventListener("t3-expand-visual", open);
  }, []);
  return visual ? <ExpandedVisual title={visual.title} onClose={() => setVisual(null)}>{visual.src ? <img src={visual.src} alt={visual.title} /> : <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: visual.svg ?? "" }} />}</ExpandedVisual> : null;
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
  return <span className="chat-image"><img className="chat-media" src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} /><button className="icon-button expand-visual" title="Expand image" aria-label={`Expand ${alt}`} onClick={() => openVisual({ title: alt, src: url })}><Maximize2Icon size={13} /></button></span>;
}
