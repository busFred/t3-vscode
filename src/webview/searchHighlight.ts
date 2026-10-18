import { matchesSearchFilters, searchableFields, searchPattern, type SessionSearchOptions } from "../shared/sessionSearch";
import type { TranscriptItem } from "../shared/bridge";
import { isCitationExpanded, setCitationExpanded } from "./citationExpansion";
import type { SearchTarget } from "./components/SessionFind";

/** Keep separate DOM ranges so markdown, selection/citation anchors and code controls stay intact. */
function fieldRanges(root: HTMLElement, field: string, options: SessionSearchOptions): Range[] {
  if (!options.query) return [];
  const selector = field === "input" ? ".command-input,.tool-input" : field === "output" ? ".tool-output" : field.startsWith("attachment:") ? ".attachments" : field === "text" ? ".markdown" : null;
  const candidates = selector ? [...root.querySelectorAll<HTMLElement>(selector)] : [];
  const containers = candidates.length ? candidates.filter(node => !candidates.some(other => other !== node && other.contains(node))) : [root];
  const ranges: Range[] = [];
  for (const container of containers) {
    const nodes: Array<{ node: Text; start: number }> = []; let text = "", previousBlock: Element | null = null;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest('button,script,style,svg,.katex-mathml,[aria-hidden=true],.response-actions,.message-author,.work-status') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const block = node.parentElement?.closest("p,pre,li,td,th,h1,h2,h3,h4,h5,h6,blockquote") ?? null;
      if (nodes.length && block !== previousBlock) text += "\n";
      nodes.push({ node, start: text.length }); text += node.data; previousBlock = block;
    }
    for (const hit of text.matchAll(searchPattern(options))) {
      if (!hit[0].length) continue;
      const start = nodes.find(entry => entry.start + entry.node.length > hit.index);
      const end = nodes.find(entry => entry.start + entry.node.length >= hit.index + hit[0].length);
      if (!start || !end || start.start > hit.index) continue;
      const range = document.createRange(); range.setStart(start.node, hit.index - start.start); range.setEnd(end.node, hit.index + hit[0].length - end.start); ranges.push(range);
    }
  }
  return ranges;
}

function setHighlight(name: string, ranges: Range[], priority: number) {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  if (!ranges.length) { CSS.highlights.delete(name); return; }
  const highlight = new Highlight(...ranges); highlight.priority = priority;
  CSS.highlights.set(name, highlight);
}

/** Redraw on virtual row mounting, streamed text and disclosure expansion, without scrolling. */
export function observeSearchHighlights(root: HTMLElement, rows: readonly TranscriptItem[], options: SessionSearchOptions, target: SearchTarget | null): () => void {
  const eligible = new Map(rows.filter(row => matchesSearchFilters(row, options)).map(row => [row.key, row]));
  let frame = 0;
  const paint = () => {
    frame = 0; const all: Range[] = [], active: Range[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("[data-search-row]")) {
      const row = eligible.get(element.dataset.searchRow!); if (!row) continue;
      for (const { field } of searchableFields(row, options.scope)) {
        const ranges = fieldRanges(element, field, options); all.push(...ranges);
        if (target?.rowKey === row.key && target.field === field && ranges[target.occurrence]) active.push(ranges[target.occurrence]!);
      }
    }
    setHighlight("t3-session-matches", all, 0); setHighlight("t3-session-match", active, 1);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  const observer = new MutationObserver(schedule); observer.observe(root, { childList: true, subtree: true, characterData: true });
  paint();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); CSS.highlights?.delete("t3-session-matches"); CSS.highlights?.delete("t3-session-match"); };
}

export function highlightSearchResult(root: HTMLElement, target: SearchTarget): boolean {
  const range = fieldRanges(root, target.field, target)[target.occurrence]; if (!range) return false;
  const card = range.startContainer.parentElement?.closest<HTMLElement>(".citation-card, .message-reference");
  const key = card?.dataset.expanded === "true" ? undefined : card?.dataset.citationKey;
  if (key) { if (!isCitationExpanded(key)) setCitationExpanded(key, true); return false; }
  setHighlight("t3-session-match", [range], 1);
  range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "instant" });
  return true;
}
