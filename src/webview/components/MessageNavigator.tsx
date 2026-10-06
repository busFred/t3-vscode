import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { ArrowDownIcon, ChevronUpIcon } from "lucide-react";
import { exchangeAtPointer, exchangeAtRow, type MessageExchange, type MessageNavigationPlacement } from "../../shared/messageNavigation";

export function MessageNavigator({ exchanges, currentRow, placement, atEnd, history, onJump, onLatest, onEarlier }: {
  exchanges: ReadonlyArray<MessageExchange>; currentRow: number; placement: MessageNavigationPlacement; atEnd: boolean;
  history: { hasMore: boolean; loading: boolean; error: string | null };
  onJump: (key: string) => void; onLatest: () => void; onEarlier: () => void;
}) {
  const prefix = useId(); const track = useRef<HTMLDivElement>(null); const dragging = useRef(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const current = exchangeAtRow(exchanges, currentRow);
  const found = exchanges.findIndex((item) => item.key === previewKey);
  const selected = found < 0 ? current : found;
  const preview = found >= 0 ? exchanges[found] : null;
  const percent = (index: number) => exchanges.length <= 1 ? 0 : index / (exchanges.length - 1) * 100;
  const active = useRef({ exchanges, selected, onJump }); active.current = { exchanges, selected, onJump };
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault(); event.stopPropagation();
      const { exchanges, selected } = active.current;
      const next = Math.max(0, Math.min(exchanges.length - 1, selected + (event.deltaY > 0 ? 1 : -1)));
      setPreviewKey(exchanges[next]!.key);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [placement, exchanges.length >= 2]);
  if (placement === "off" || exchanges.length < 2) return null;
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = exchangeAtPointer(exchanges.length, bounds.top, bounds.height, event.clientY);
    const key = exchanges[index]!.key; setPreviewKey(key); return key;
  };
  const compact = (text: string) => text.replace(/\s+/g, " ").trim();
  return <>
    <div className={`message-navigator ${placement}`} onPointerLeave={(event) => {
      if (!dragging.current && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setPreviewKey(null);
    }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPreviewKey(null); }}>
      {history.hasMore || history.error ? <button className="icon-button message-nav-earlier" aria-label={history.error ? "Retry earlier messages" : "Load earlier messages"} title={history.error ?? "Load earlier messages"} disabled={history.loading} onClick={onEarlier}><ChevronUpIcon size={14} /></button> : null}
      <div className="message-nav-core" style={{ height: `min(${Math.max(24, (exchanges.length - 1) * 7)}px, 100%)` }}>
        <div ref={track} className="message-nav-track" role="listbox" aria-label="Past messages" aria-orientation="vertical" aria-activedescendant={`${prefix}-${selected}`} tabIndex={0}
          onFocus={() => setPreviewKey(exchanges[selected]!.key)}
          onPointerMove={(event) => { const key = point(event); if (dragging.current) onJump(key); }}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); onJump(point(event)); }}
          onPointerUp={(event) => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { dragging.current = false; setPreviewKey(null); }}
          onKeyDown={(event) => {
            let next = selected;
            if (event.key === "ArrowUp") next--; else if (event.key === "ArrowDown") next++;
            else if (event.key === "Home") next = 0; else if (event.key === "End") next = exchanges.length - 1;
            else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onJump(exchanges[selected]!.key); return; }
            else if (event.key === "Escape") { event.preventDefault(); setPreviewKey(null); return; } else return;
            event.preventDefault(); setPreviewKey(exchanges[Math.max(0, Math.min(exchanges.length - 1, next))]!.key);
          }}>
          {exchanges.map((exchange, index) => <span id={`${prefix}-${index}`} key={exchange.key} className={`message-nav-tick${index === current ? " current" : ""}${preview && index === selected ? " previewed" : ""}`}
            role="option" aria-selected={index === selected} aria-label={`Message ${index + 1}: ${compact(exchange.prompt.slice(0, 160))}`} data-message-key={exchange.key} style={{ top: `${percent(index)}%` }} />)}
        </div>
        {preview ? <button className="message-nav-preview" style={{ top: `clamp(0px, calc(${percent(selected)}% - 40px), max(0px, calc(100% - 100px)))` }} onClick={() => onJump(preview.key)} aria-label={`Jump to message ${selected + 1}`}>
          <span className="message-nav-position">{selected + 1} / {exchanges.length}</span>
          <strong>{compact(preview.prompt)}</strong>
          {preview.response ? <span className="message-nav-response">{compact(preview.response)}</span> : <span className="message-nav-response">Awaiting a response</span>}
        </button> : null}
      </div>
    </div>
    {!atEnd ? <button className="message-nav-latest btn" onClick={onLatest} aria-label="Jump to latest message"><ArrowDownIcon size={13} />Latest</button> : null}
  </>;
}
