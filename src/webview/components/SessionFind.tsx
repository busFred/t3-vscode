import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, PanelTopIcon, PanelRightIcon, SearchIcon, XIcon, RefreshCwIcon, FilterIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { SEARCH_SOURCES, SEARCH_CONTENT, sameSearchFilters, type SearchSource, type SearchContent, type SessionMatch, type SessionSearchOptions } from "../../shared/sessionSearch";
import { sessionPreviewLines, type PreviewLine, type SearchPreferences, type SessionSearchPreview } from "../../shared/sessionSearchPresentation";
import { useActions } from "../actions";
import { bridge } from "../bridge-client";

export interface SearchTarget extends SessionMatch, SessionSearchOptions { threadId: string; nonce: number }
export const SearchTargetContext = createContext<SearchTarget | null>(null);
const PAGE_SIZE = 25;
const sourceLabels: Record<SearchSource, string> = { user: "Your messages", assistant: "Assistant", tools: "Commands / tools", thought: "Thought process", files: "Files / diffs", other: "Other activity" };
const contentLabels: Record<SearchContent, string> = { figures: "Figures", code: "Code", equations: "Equations", files: "Files" };
const kindLabel = (match: SessionMatch) => ({ "user message": "You", "assistant message": "Assistant", "command execution": "Command", "dynamic tool": "Tool", reasoning: "Thought process", "proposed plan": "Plan" })[match.kind] ?? match.kind.replace(/^./, (c) => c.toUpperCase());
function SearchPreview({ preview, match, options, context, fontKey }: { preview?: SessionSearchPreview | undefined; match: SessionMatch; options: SessionSearchOptions; context: number; fontKey: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<ReturnType<typeof sessionPreviewLines> | null>(null);
  const ranges = [{ start: match.start, end: match.end }];
  const highlightLine = (line: PreviewLine): ReactNode => {
    const output: ReactNode[] = []; let at = 0;
    for (const range of ranges) {
      if (range.end <= line.start || range.start >= line.end) continue;
      const start = Math.max(0, range.start - line.start), end = Math.min(line.text.length, range.end - line.start);
      output.push(line.text.slice(at, start), <mark key={start}>{line.text.slice(start, end)}</mark>); at = end;
    }
    output.push(line.text.slice(at) || (output.length ? "" : "\u00a0")); return output;
  };
  useLayoutEffect(() => {
    const node = element.current; if (!node || !preview) { setLines(null); return; }
    const canvas = document.createElement("canvas"), painter = canvas.getContext("2d");
    if (!painter) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => { painter.font = getComputedStyle(node).font; setLines(sessionPreviewLines(preview, match, context, Math.max(24, node.clientWidth - 10), (text) => painter.measureText(text).width)); };
    update();
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(update, 50); }); observer.observe(node);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [preview, match.id, match.start, match.end, context, fontKey]);
  return <span className="find-preview-text" ref={element}>{lines ? lines.lines.map((line) => <span className="find-context-line" key={line.start}>{highlightLine(line)}</span>) : match.snippet}</span>;
}

export function SessionFind({ state, preferences, onPreferences, onClose, onSelect }: { state: HostStateSnapshot; preferences: SearchPreferences; onPreferences: (patch: Partial<SearchPreferences>) => void; onClose: () => void; onSelect: (target: SearchTarget | null) => void }) {
  const [query, setQuery] = useState(""), [caseSensitive, setCase] = useState(false), [wholeWord, setWord] = useState(false), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [results, setResults] = useState(true);
  const [page, setPage] = useState(0);
  const [sources, setSources] = useState<readonly SearchSource[]>(SEARCH_SOURCES), [content, setContent] = useState<readonly SearchContent[]>([]);
  const [previews, setPreviews] = useState<SessionSearchPreview[]>([]), [previewError, setPreviewError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null);
  const [height, setHeight] = useState(preferences.resultsHeight), [maxHeight, setMaxHeight] = useState(700);
  const input = useRef<HTMLInputElement>(null), generation = useRef(0), selecting = useRef(0);
  const section = useRef<HTMLElement>(null), controls = useRef<HTMLDivElement>(null), feedback = useRef<HTMLDivElement>(null), contextButton = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null), dragHeight = useRef(height);
  const run = useActions(), id = state.activeThreadId;
  const scope = "all" as const;
  const options = { query, caseSensitive, wholeWord, scope, sources, content };
  const search = state.sessionSearch && state.sessionSearch.threadId === id && state.sessionSearch.query === query && state.sessionSearch.caseSensitive === caseSensitive && state.sessionSearch.wholeWord === wholeWord && state.sessionSearch.scope === scope && sameSearchFilters(state.sessionSearch, options) ? state.sessionSearch : undefined;
  const matches = useMemo(() => preferences.order === "newest" ? [...(search?.matches ?? [])].reverse() : search?.matches ?? [], [search?.matches, preferences.order]);
  const index = Math.max(0, matches.findIndex((match) => match.id === selected));
  const totalPages = Math.ceil(matches.length / PAGE_SIZE), currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const visible = results ? matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) : [];
  const visibleIds = JSON.stringify(visible.map((match) => match.id));
  const sourceRevision = search?.revision ?? 0;
  const previewMap = useMemo(() => new Map(previews.map((preview) => [preview.matchId, preview])), [previews]);
  useEffect(() => {
    // Only scroll the result group's viewport; never move the conversation or the outer workbench.
    const frame = requestAnimationFrame(() => {
      const entry = section.current?.querySelector<HTMLElement>(".find-entry.selected"), scroll = entry?.closest<HTMLElement>(".find-group-rows");
      if (!entry || !scroll) return;
      const top = entry.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      if (top < 0 || top + entry.offsetHeight > scroll.clientHeight) scroll.scrollTop += top;
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, previews, preferences.contextLines, results]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    generation.current += 1; selecting.current += 1;
    setSelected(null); onSelect(null); setPage(0); setPreviews([]);
    const timer = setTimeout(() => { if (query && id) void run("searchSession", { threadId: id, ...options }); }, 220);
    return () => { generation.current += 1; clearTimeout(timer); void run("cancelSessionSearch"); };
  }, [query, caseSensitive, wholeWord, sources, content, id, refresh, run]);
  useEffect(() => {
    let cancelled = false;
    setPreviewError(null);
    const ids: string[] = JSON.parse(visibleIds);
    if (!id || !ids.length) { setPreviews([]); return; }
    void bridge.request<SessionSearchPreview[]>("sessionSearchPreviews", { threadId: id, query, matchIds: ids }).then((next) => { if (!cancelled) setPreviews(next); }, (cause) => { if (!cancelled) setPreviewError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [id, query, caseSensitive, wholeWord, sources, content, sourceRevision, visibleIds, refresh]);
  useEffect(() => { if (!drag.current) setHeight(preferences.resultsHeight); }, [preferences.resultsHeight]);
  useLayoutEffect(() => {
    const parent = section.current?.parentElement; if (!parent || !controls.current) return;
    const update = () => setMaxHeight(Math.max(120, Math.min(700, Math.floor(parent.clientHeight - (controls.current?.clientHeight ?? 0) - (feedback.current?.clientHeight ?? 0) - 24 - 170))));
    const observer = new ResizeObserver(update); observer.observe(parent); observer.observe(controls.current); if (feedback.current) observer.observe(feedback.current); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !contextButton.current?.contains(event.target as Node)) setContextMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setContextMenu(null); contextButton.current?.focus(); } };
    const resize = () => setContextMenu(null);
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape, true); window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", resize); };
  }, [contextMenu]);
  const select = async (match: SessionMatch) => {
    if (!id) return;
    setSelected(match.id);
    setPage(Math.floor(matches.findIndex(hit => hit.id === match.id) / PAGE_SIZE));
    const original = generation.current, request = ++selecting.current;
    if (await run("revealSessionMatch", { matchId: match.id }) && generation.current === original && selecting.current === request) onSelect({ ...match, ...options, threadId: id, nonce: request });
  };
  const step = (delta: number) => { const match = matches[selected ? (index + delta + matches.length) % matches.length : delta < 0 ? matches.length - 1 : 0]; if (match) void select(match); };
  const resize = (value: number) => { const next = Math.max(120, Math.min(maxHeight, Math.round(value))); dragHeight.current = next; setHeight(next); return next; };
  const finishResize = () => { if (drag.current) { drag.current = null; onPreferences({ resultsHeight: dragHeight.current }); } };
  return <section ref={section} className="session-find" data-expanded={results} aria-label="Find in conversation" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if ((event.key === "Enter" && event.target === input.current) || event.key === "F3") { event.preventDefault(); event.stopPropagation(); step(event.shiftKey ? -1 : 1); }
  }}>
    <div ref={controls} className="find-controls"><div className="session-find-toolbar">
      <div className="find-input"><SearchIcon size={13} /><input ref={input} aria-label="Find in this session" placeholder="Find" maxLength={500} value={query} onChange={(event) => setQuery(event.target.value)} /><button className="icon-button" aria-label="Clear search" title="Clear search" disabled={!query} onClick={() => { setQuery(""); input.current?.focus(); }}><XIcon size={12} /></button></div>
      <button className="icon-button find-case" aria-label="Match case" aria-pressed={caseSensitive} title="Match case" onClick={() => setCase(!caseSensitive)}>Aa</button><button className="icon-button find-case" aria-label="Whole word" aria-pressed={wholeWord} title="Whole word" onClick={() => setWord(!wholeWord)}><u>ab</u></button>
      <span className="find-count" role="status" title={search?.scanning ? `Scanning history · ${search.scannedItems} items` : "Entire session searched"}>{query ? !search ? "…" : `${matches.length ? index + 1 : 0}/${search.total}${search.scanning ? "+" : ""}` : ""}</span>
      <button className="icon-button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!matches.length} onClick={() => step(-1)}><ArrowUpIcon size={15} /></button><button className="icon-button" aria-label="Next match" title="Next match (Enter)" disabled={!matches.length} onClick={() => step(1)}><ArrowDownIcon size={15} /></button>
      <button className="icon-button find-filter" ref={contextButton} aria-label="Search filters" aria-expanded={!!contextMenu} aria-haspopup="dialog" aria-pressed={sources.length !== SEARCH_SOURCES.length || content.length > 0} title="Search filters and display options" onClick={() => { if (contextMenu) setContextMenu(null); else { const box = contextButton.current!.getBoundingClientRect(); setContextMenu({ left: Math.max(4, Math.min(box.left, window.innerWidth - 284)), top: Math.max(4, Math.min(box.bottom + 5, window.innerHeight - 530)) }); } }}><FilterIcon size={15} />{sources.length !== SEARCH_SOURCES.length || content.length ? <i /> : null}</button>
      <button className="icon-button" aria-label={results && preferences.layout === "side" ? "Results above chat" : "Results beside chat"} title={results && preferences.layout === "side" ? "Move results above chat" : "Expand results beside chat; narrow editors stack automatically"} onClick={() => { onPreferences({ layout: results && preferences.layout === "side" ? "above" : "side" }); setResults(true); }}>{results && preferences.layout === "side" ? <PanelTopIcon size={15} /> : <PanelRightIcon size={15} />}</button>
      <button className="icon-button" aria-label="Close session search" title="Close (Escape)" onClick={onClose}><XIcon size={15} /></button>
    </div></div>
    <button className="find-disclosure" aria-expanded={results} onClick={() => setResults(!results)}>{results ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}<span>{search ? `${search.total} results${search.scanning ? " · searching…" : ""}` : query ? "Searching…" : "Results"}</span></button>
    <div ref={feedback} className="find-feedback">
      {search?.error ? <p className="turn-error" role="status">Incomplete search: {search.error}</p> : null}
      {previewError ? <p className="turn-error" role="status">Context unavailable: {previewError}</p> : null}
      {search && search.total > matches.length ? <p>Showing the first {matches.length.toLocaleString()} matches; refine the search to see others.</p> : null}
      {query && search && !search.scanning && !search.error && !search.total ? <p role="status">No matches in this session.</p> : null}
    </div>
    {results && matches.length ? <><div className="find-results" aria-label="Session search results" style={{ height: Math.min(height, maxHeight) }}>
      <div className="find-group-rows">{visible.map((hit) => {
        const stamp = hit.timestamp ? new Date(hit.timestamp) : null;
        return <div className={`find-entry ${hit.id === selected ? "selected" : ""}`} key={hit.id}>
          <button className="find-result" aria-current={hit.id === selected ? "true" : undefined} onClick={() => { void select(hit); }}><span className="find-result-meta"><span>{kindLabel(hit)}{hit.field !== "text" ? ` · ${hit.field.startsWith("attachment:") ? "attachment" : hit.field}` : ""}</span>{stamp && Number.isFinite(stamp.getTime()) ? <time dateTime={hit.timestamp!} title={stamp.toLocaleString()}>{stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}</span><SearchPreview preview={previewMap.get(hit.id)} match={hit} options={options} context={preferences.contextLines} fontKey={`${state.appearance.fontSizeInterface}:${state.appearance.fontSizeCode}`} /></button>
        </div>;
      })}</div>
      {totalPages > 1 ? <div className="find-pagination"><button className="text-button" aria-label="Previous results" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage * PAGE_SIZE + 1}–{Math.min(matches.length, (currentPage + 1) * PAGE_SIZE)} of {matches.length}</span><button className="text-button" aria-label="Next results" disabled={currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div> : null}
    </div><div className="find-resize" role="separator" tabIndex={0} aria-label="Resize search results" aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={maxHeight} aria-valuenow={Math.min(height, maxHeight)} title="Drag or use arrow keys to resize; double-click to reset" onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); drag.current = { y: event.clientY, height: Math.min(height, maxHeight) }; dragHeight.current = Math.min(height, maxHeight); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (drag.current) resize(drag.current.height + event.clientY - drag.current.y); }} onPointerUp={(event) => { finishResize(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={finishResize} onLostPointerCapture={finishResize} onDoubleClick={() => { setHeight(280); onPreferences({ resultsHeight: 280 }); }} onKeyDown={(event) => { if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); onPreferences({ resultsHeight: resize(event.key === "Home" ? 120 : event.key === "End" ? maxHeight : Math.min(height, maxHeight) + (event.key === "ArrowDown" ? 20 : -20)) }); } }}><span className="find-grip" />Drag to resize results</div></> : null}
    {contextMenu && createPortal(<div ref={popup} className="find-context-popover" role="dialog" aria-label="Search filters and options" style={contextMenu}>
      <fieldset><legend>Search in</legend><div className="find-filter-grid">{SEARCH_SOURCES.map(source => <label key={source}><input type="checkbox" checked={sources.includes(source)} onChange={() => setSources(sources.includes(source) ? sources.filter(item => item !== source) : SEARCH_SOURCES.filter(item => item === source || sources.includes(item)))} />{sourceLabels[source]}</label>)}</div></fieldset>
      <fieldset><legend>Containing any of</legend><div className="find-filter-grid">{SEARCH_CONTENT.map(feature => <label key={feature}><input type="checkbox" checked={content.includes(feature)} onChange={() => setContent(content.includes(feature) ? content.filter(item => item !== feature) : SEARCH_CONTENT.filter(item => item === feature || content.includes(item)))} />{contentLabels[feature]}</label>)}</div><p>Text and filenames are searched, not image pixels.</p></fieldset>
      <div className="find-filter-grid"><label><input type="checkbox" checked={caseSensitive} onChange={() => setCase(!caseSensitive)} />Match case</label><label><input type="checkbox" checked={wholeWord} onChange={() => setWord(!wholeWord)} />Whole word</label></div>
      <label className="find-filter-option">Context lines<select aria-label="Context lines" value={preferences.contextLines} onChange={event => onPreferences({ contextLines: Number(event.target.value) })}>{Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n ? `${n} before + ${n} after` : "Matching line only"}</option>)}</select></label>
      <label className="find-filter-option">Order<select aria-label="Chronological order" value={preferences.order} onChange={event => { onPreferences({ order: event.target.value as SearchPreferences["order"] }); setPage(0); }}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
      <div className="find-filter-actions"><button className="text-button" onClick={() => { setSources(SEARCH_SOURCES); setContent([]); setCase(false); setWord(false); }}>Reset filters</button><button className="icon-button" title="Refresh search" aria-label="Refresh search" disabled={!query} onClick={() => setRefresh(n => n + 1)}><RefreshCwIcon size={14} /></button><button className="text-button" onClick={() => { setContextMenu(null); contextButton.current?.focus(); }}>Done</button></div>
    </div>, document.body)}
  </section>;
}
