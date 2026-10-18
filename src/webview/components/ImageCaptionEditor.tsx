import { useEffect, useRef, useState } from "react";
import { openVisual } from "./ChatMedia";

export function ImageCaptionEditor({ label, src, onSave, onClose }: { label: string; src?: string | undefined; onSave: (label: string) => void; onClose: () => void }) {
  const [caption, setCaption] = useState(label); const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <div className="image-caption-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="citation-comment image-caption-editor" role="dialog" aria-modal="true" aria-label="Edit image caption" onKeyDown={event => {
      event.stopPropagation(); if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Enter" && !event.shiftKey && event.target === input.current) { event.preventDefault(); onSave(caption); }
      if (event.key === "Tab") {
        const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('textarea,button')]; const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      {src ? <button className="image-caption-preview" aria-label="Preview image" onClick={() => openVisual({ title: caption || label, src })}><img src={src} alt={caption} /></button> : null}
      <label>Image caption<textarea ref={input} aria-label="Image caption" value={caption} rows={3} maxLength={2000} onChange={event => setCaption(event.target.value)} /></label>
      <div className="citation-comment-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(caption)}>Save</button></div>
    </div>
  </div>;
}
