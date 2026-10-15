import { ASSISTANT_CITATION_MAX_TEXT_LENGTH, type AssistantCitation } from "@t3tools/contracts";
import { QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { QUOTE_ACTION_LABEL, QUOTE_TOO_LONG_LABEL } from "../../shared/assistantQuoteMenu";
import { captureSelectedCitation } from "./AssistantSelectionMenu";
import type { AssistantCitationSourceAnchor } from "./t3/assistantTextSelection";
import { observeSelectionActions, resolveSelectionActionPosition, type SelectionActionPoint } from "./t3/selectionActions";

export function AssistantSelectionToolbar({ viewport, onCite }: { readonly viewport: HTMLElement | null; readonly onCite: (citation: AssistantCitation, anchor: AssistantCitationSourceAnchor) => void }) {
  const [selected, setSelected] = useState<{ citation: AssistantCitation; anchor: AssistantCitationSourceAnchor; position: SelectionActionPoint } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!selected || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    button.current.style.left = `${Math.max(8, Math.min(selected.position.x, window.innerWidth - rect.width - 8))}px`;
    button.current.style.top = `${Math.max(8, Math.min(selected.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selected]);
  useEffect(() => {
    if (!viewport) return;
    const actions = observeSelectionActions({ element: viewport, getActionElement: () => button.current,
      onDismiss: () => setSelected(null), onSelection: (pointer) => {
        const captured = captureSelectedCitation(viewport, window.getSelection());
        if (!captured) { setSelected(null); return; }
        const rect = captured.range.getBoundingClientRect(); const bounds = viewport.getBoundingClientRect();
        if (!rect.width || rect.bottom < bounds.top || rect.top > bounds.bottom) { setSelected(null); return; }
        setSelected({ citation: captured.citation, anchor: captured.anchor,
          position: resolveSelectionActionPosition({ bounds, selectionRect: rect, pointer, viewport: { width: window.innerWidth, height: window.innerHeight } }) });
      } });
    const focus = (event: KeyboardEvent) => {
      if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && button.current && event.target !== button.current) { event.preventDefault(); button.current.focus(); }
    };
    document.addEventListener("selectionchange", actions.selectionChanged); document.addEventListener("keydown", focus, true);
    return () => { document.removeEventListener("selectionchange", actions.selectionChanged); document.removeEventListener("keydown", focus, true); actions.dispose(); };
  }, [viewport]);
  if (!selected) return null;
  const tooLong = selected.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  return <button ref={button} className="btn citation-selection-button" aria-label={`${QUOTE_ACTION_LABEL} selection in composer`} disabled={tooLong} style={{ left: selected.position.x, top: selected.position.y }} onPointerDown={(event) => event.preventDefault()} onClick={() => {
    onCite(selected.citation, selected.anchor); setSelected(null); window.getSelection()?.removeAllRanges();
  }}><QuoteIcon size={13} />{tooLong ? QUOTE_TOO_LONG_LABEL : QUOTE_ACTION_LABEL}</button>;
}
