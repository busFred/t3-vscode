import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssistantCitationSourceAnchor } from "./t3/assistantTextSelection";

export function CitationCommentEditor({ citation, anchor, onSave, onClose }: { readonly citation: AssistantCitation; readonly anchor?: AssistantCitationSourceAnchor | undefined; readonly onSave: (comment: string) => void; readonly onClose: () => void }) {
  const [comment, setComment] = useState(citation.comment ?? ""); const popup = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null);
  const tooLong = comment.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH;
  const save = () => { if (!tooLong) onSave(comment); };
  useLayoutEffect(() => {
    const element = popup.current!; const bounds = anchor?.range.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(bounds?.left ?? (window.innerWidth - rect.width) / 2, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(bounds ? bounds.bottom + 8 : (window.innerHeight - rect.height) / 2, window.innerHeight - rect.height - 8))}px`;
    input.current?.focus();
    if (anchor && typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.set("t3-citation-comment", new Highlight(anchor.range));
    return () => { CSS.highlights?.delete("t3-citation-comment"); };
  }, [anchor]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close);
  }, [onClose]);
  return <div ref={popup} className="citation-comment" role="dialog" aria-label="Comment on assistant quote" onKeyDown={(event) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); save(); }
  }}>
    <blockquote className="citation-comment-quote">{citation.text}</blockquote>
    <textarea ref={input} aria-label="Comment on selected text" placeholder="Add an optional comment…" value={comment} rows={3} onChange={(event) => setComment(event.target.value)} />
    {tooLong ? <p className="turn-error" role="alert">Comments can contain up to {ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()} characters.</p> : null}
    <div className="citation-comment-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={tooLong} onClick={save}>Save</button></div>
  </div>;
}
