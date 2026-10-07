import { createContext, useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, SearchIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { SessionMatch, SessionSearchOptions } from "../../shared/sessionSearch";
import { useActions } from "../actions";

export interface SearchTarget extends SessionMatch, SessionSearchOptions { threadId: string; nonce: number }
export const SearchTargetContext = createContext<SearchTarget | null>(null);
export function SessionFind({ state, onClose, onSelect }: { state: HostStateSnapshot; onClose: () => void; onSelect: (target: SearchTarget | null) => void }) {
  const [query, setQuery] = useState(""), [caseSensitive, setCase] = useState(false), [wholeWord, setWord] = useState(false), [scope, setScope] = useState<"all" | "messages">("all"), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [results, setResults] = useState(true);
  const input = useRef<HTMLInputElement>(null), generation = useRef(0);
  const run = useActions(), id = state.activeThreadId;
  const search = state.sessionSearch && state.sessionSearch.threadId === id && state.sessionSearch.query === query && state.sessionSearch.caseSensitive === caseSensitive && state.sessionSearch.wholeWord === wholeWord && state.sessionSearch.scope === scope ? state.sessionSearch : undefined;
  const matches = search?.matches ?? [], index = Math.max(0, matches.findIndex((match) => match.id === selected));
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    generation.current += 1;
    setSelected(null); onSelect(null);
    const timer = setTimeout(() => { if (query && id) void run("searchSession", { threadId: id, query, caseSensitive, wholeWord, scope }); }, 220);
    return () => { generation.current += 1; clearTimeout(timer); void run("cancelSessionSearch"); };
  }, [query, caseSensitive, wholeWord, scope, id, refresh, run]);
  const select = async (match: SessionMatch) => {
    if (!id) return;
    setSelected(match.id);
    const original = generation.current;
    if (await run("revealSessionMatch", { matchId: match.id }) && generation.current === original) onSelect({ ...match, query, caseSensitive, wholeWord, scope, threadId: id, nonce: Date.now() });
  };
  const step = (delta: number) => { const match = matches[selected ? (index + delta + matches.length) % matches.length : delta < 0 ? matches.length - 1 : 0]; if (match) void select(match); };
  const start = Math.floor(index / 50) * 50;
  return <section className="session-find" aria-label="Find in conversation" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === "Enter" && event.target === input.current || event.key === "F3") { event.preventDefault(); event.stopPropagation(); if (!selected && matches[0]) void select(matches[0]); else step(event.shiftKey ? -1 : 1); }
  }}><div className="session-find-toolbar"><SearchIcon size={14} /><input ref={input} aria-label="Find in this session" placeholder="Find in this session…" maxLength={500} value={query} onChange={(event) => setQuery(event.target.value)} />
    <button className={`icon-button ${caseSensitive ? "selected" : ""}`} aria-label="Match case" aria-pressed={caseSensitive} title="Match case" onClick={() => setCase(!caseSensitive)}>Aa</button><button className={`icon-button ${wholeWord ? "selected" : ""}`} aria-label="Whole word" aria-pressed={wholeWord} title="Whole word" onClick={() => setWord(!wholeWord)}>ab</button>
    <span className="find-count" role="status">{query ? !search ? "Searching…" : `${matches.length ? index + 1 : 0} / ${search.total}${search.scanning ? "+" : ""}` : ""}</span>
    <button className="icon-button" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}><ArrowUpIcon size={14} /></button><button className="icon-button" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}><ArrowDownIcon size={14} /></button><button className="icon-button" aria-label="Close session search" onClick={onClose}><XIcon size={14} /></button></div>
    <div className="find-options"><select aria-label="Search content" value={scope} onChange={(event) => setScope(event.target.value as "all" | "messages")}><option value="all">All text</option><option value="messages">Messages only</option></select><button className="text-button" onClick={() => setResults(!results)}>{results ? "Hide results" : "Show results"}</button><button className="text-button" disabled={!query} onClick={() => setRefresh((n) => n + 1)}>Refresh</button><small>{search?.scanning ? `Scanning history · ${search.scannedItems} items` : search && !search.error ? "Entire session searched" : ""}</small></div>
    {search?.error ? <p className="turn-error" role="status">Incomplete search: {search.error}</p> : null}
    {search && search.total > matches.length ? <p className="subtle">Showing the first {matches.length.toLocaleString()} matches; refine the search to see others.</p> : null}
    {results && matches.length ? <div className="find-results" aria-label="Session search results">{matches.slice(start, start + 50).map((match, offset) => <button key={match.id} className={`find-result ${match.id === selected ? "selected" : ""}`} onClick={() => { void select(match); }}><small>{start + offset + 1} · {match.kind}</small><span>{match.snippet}</span></button>)}</div> : null}
    {query && search && !search.scanning && !search.error && !search.total ? <p role="status">No matches in this session.</p> : null}
  </section>;
}
