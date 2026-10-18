import type { AssistantCitation } from "../../shared/messageCitations.js";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { CopyIcon, QuoteIcon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActions } from "../actions";
import { assistantQuoteMenuItems, clampMenuPosition, QUOTE_TOO_LONG_LABEL, type AssistantQuoteMenuAction } from "../../shared/assistantQuoteMenu";
import { selectionMarkdown } from "../selectionMarkdown";
import { findAssistantCitationSourceAnchor, captureAssistantTextSelection, type AssistantCitationSourceAnchor } from "./t3/assistantTextSelection";

/** Capture a selected passage from a user or assistant message. */
export function captureSelectedCitation(viewport: HTMLElement, selection: Selection | null): { citation: AssistantCitation; anchor: AssistantCitationSourceAnchor; range: Range } | null {
  const captured = captureAssistantTextSelection(viewport, selection);
  const dataset = captured?.source.dataset;
  if (!captured || !dataset?.assistantCitationSource || !dataset.assistantCitationEnvironment || !dataset.assistantCitationThread) return null;
  return { citation: { version: 1, environmentId: EnvironmentId.make(dataset.assistantCitationEnvironment), threadId: ThreadId.make(dataset.assistantCitationThread), messageId: MessageId.make(dataset.assistantCitationSource), ...(dataset.citationAuthor === "user" ? { author: "user" as const } : {}), ...captured.selector },
    anchor: { source: captured.source, range: captured.range, viewport }, range: captured.range };
}

const ICONS = { copy: CopyIcon, markdown: CopyIcon, quote: QuoteIcon } as const;

/** Keep the last valid selection, scoped to this session and its source message, after dismissal. */
export function AssistantSelectionMenu({ viewport, onQuote }: { readonly viewport: HTMLElement | null; readonly onQuote: (citation: AssistantCitation, anchor: AssistantCitationSourceAnchor) => void }) {
  const run = useActions(); const menu = useRef<HTMLDivElement>(null);
  const remembered = useRef<{ citation: AssistantCitation; markdown: string } | null>(null);
  const [target, setTarget] = useState<{ citation: AssistantCitation; markdown: string; anchor: AssistantCitationSourceAnchor; x: number; y: number } | null>(null);
  const [location, setLocation] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!viewport) return;
    remembered.current = null; setTarget(null);
    const remember = () => {
      const selection = window.getSelection();
      const captured = captureSelectedCitation(viewport, selection);
      if (selection && !selection.isCollapsed && !captured) remembered.current = null;
      if (captured) remembered.current = { citation: captured.citation, markdown: selectionMarkdown(captured.range, captured.anchor.source) };
      return captured;
    };
    const recover = (source?: Element | null) => {
      remember();
      const saved = remembered.current; if (!saved) return null;
      const anchor = findAssistantCitationSourceAnchor(document, saved.citation);
      if (!anchor || !viewport.contains(anchor.source) || source && anchor.source !== source) return null;
      return { ...saved, anchor, range: anchor.range };
    };
    const show = (event: MouseEvent) => {
      // Equations keep the math menu, whose handler shares this document and capture phase: yielding by target
      // and by defaultPrevented fixes that precedence here rather than leaving it to listener registration order.
      if (event.defaultPrevented || !(event.target instanceof Node) || !viewport.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".katex")) return;
      const source = event.target instanceof Element ? event.target.closest("[data-assistant-citation-source]") : event.target.parentElement?.closest("[data-assistant-citation-source]");
      if (!source) return;
      const captured = recover(source);
      // Without a citable selection the native menu stays: suppressing it would take the platform's copy with it.
      if (!captured) return;
      event.preventDefault(); event.stopPropagation();
      setTarget({ citation: captured.citation, markdown: captured.markdown, anchor: captured.anchor, x: event.clientX, y: event.clientY });
    };
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true],.katex")) return;
      const live = captureSelectedCitation(viewport, window.getSelection());
      if (!live && (!(event.target instanceof Node) || !viewport.contains(event.target))) return;
      const captured = recover();
      if (!captured) return;
      event.preventDefault(); event.stopPropagation();
      const rect = captured.range.getBoundingClientRect();
      setTarget({ citation: captured.citation, markdown: captured.markdown, anchor: captured.anchor, x: rect.left, y: rect.bottom + 4 });
    };
    document.addEventListener("selectionchange", remember); document.addEventListener("pointerdown", remember, true);
    document.addEventListener("contextmenu", show, true); document.addEventListener("keydown", keys, true);
    return () => { remembered.current = null; document.removeEventListener("selectionchange", remember); document.removeEventListener("pointerdown", remember, true); document.removeEventListener("contextmenu", show, true); document.removeEventListener("keydown", keys, true); };
  }, [viewport]);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!target || !element) { setLocation(null); return; }
    const previous = document.activeElement;
    const box = element.getBoundingClientRect();
    setLocation(clampMenuPosition(target, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight }));
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => { if ((document.activeElement === document.body || element.contains(document.activeElement)) && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setTarget(null); };
    const dismiss = () => setTarget(null);
    document.addEventListener("pointerdown", close); window.addEventListener("blur", dismiss); window.addEventListener("resize", dismiss);
    viewport?.addEventListener("scroll", dismiss, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("blur", dismiss); window.removeEventListener("resize", dismiss); viewport?.removeEventListener("scroll", dismiss, true); };
  }, [target, viewport]);
  if (!target) return null;
  const items = assistantQuoteMenuItems(target.citation.text.length);
  const choose = (action: AssistantQuoteMenuAction) => {
    if (action === "copy") void run("copyText", { text: target.citation.text });
    else if (action === "markdown") void run("copyText", { text: target.markdown });
    else onQuote(target.citation, target.anchor);
    setTarget(null);
  };
  return createPortal(<div ref={menu} className="selection-context-menu" role="menu" aria-label="Selected text" style={{ left: (location ?? target).x, top: (location ?? target).y }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTarget(null); return; }
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>{items.map((item) => { const Icon = ICONS[item.action]; return <Fragment key={item.action}>{item.separated ? <hr /> : null}
    <button role="menuitem" disabled={item.disabled} onClick={() => choose(item.action)}><Icon size={13} />{item.label}</button></Fragment>; })}
    {items.some((item) => item.disabled) ? <small>{QUOTE_TOO_LONG_LABEL}</small> : null}
  </div>, document.body);
}
