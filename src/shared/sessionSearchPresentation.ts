import { searchPattern, type SessionMatch, type SessionSearchOptions } from "./sessionSearch.js";

export interface SearchPreferences {
  readonly layout: "above" | "side";
  readonly contextLines: number;
  readonly order: "oldest" | "newest";
  readonly resultsHeight: number;
}
export const DEFAULT_SEARCH_PREFERENCES: SearchPreferences = { layout: "above", contextLines: 1, order: "oldest", resultsHeight: 280 };
export function resolveSearchPreferences(value: Partial<SearchPreferences> = {}): SearchPreferences {
  const number = (n: unknown, fallback: number, min: number, max: number) => typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  return { layout: value.layout === "side" ? "side" : "above", order: value.order === "newest" ? "newest" : "oldest",
    contextLines: number(value.contextLines, 1, 0, 10), resultsHeight: number(value.resultsHeight, 280, 120, 700) };
}
export function searchPreferencePatch(value: Record<string, unknown>): Partial<SearchPreferences> {
  const patch: { -readonly [K in keyof SearchPreferences]?: SearchPreferences[K] } = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (key === "layout" && (item === "above" || item === "side")) patch.layout = item;
    else if (key === "order" && (item === "oldest" || item === "newest")) patch.order = item;
    else if ((key === "contextLines" || key === "resultsHeight") && typeof item === "number" && Number.isInteger(item) && item >= (key === "contextLines" ? 0 : 120) && item <= (key === "contextLines" ? 10 : 700)) patch[key] = item;
    else throw new Error("Invalid search display preference.");
  }
  return patch;
}

export type SearchGroupKind = "messages" | "activity";
export interface SearchEntry { readonly key: string; readonly group: SearchGroupKind; readonly matches: SessionMatch[] }
/** Host matches already follow transcript chronology, including history loaded before the visible window. */
export function groupSessionMatches(matches: readonly SessionMatch[], order: SearchPreferences["order"]): SearchEntry[] {
  const entries = new Map<string, SearchEntry>();
  for (const match of matches) {
    const key = JSON.stringify([match.rowKey, match.field]);
    let entry = entries.get(key);
    if (!entry) { entry = { key, group: match.kind === "user message" || match.kind === "assistant message" ? "messages" : "activity", matches: [] }; entries.set(key, entry); }
    entry.matches.push(match);
  }
  const chronological = [...entries.values()];
  if (order === "newest") chronological.reverse();
  return [...chronological.filter((entry) => entry.group === "messages"), ...chronological.filter((entry) => entry.group === "activity")];
}

export interface SessionSearchPreview { readonly matchId: string; readonly text: string; readonly start: number; readonly totalLength: number }
/** Context is fetched only for visible entries, never copied into all 20,000 match records. */
export function sessionSearchPreview(text: string, match: SessionMatch): SessionSearchPreview {
  const radius = 8_192;
  const start = Math.max(0, match.start - radius), end = Math.min(text.length, match.end + radius);
  return { matchId: match.id, text: text.slice(start, end), start, totalLength: text.length };
}
export interface PreviewLine { readonly text: string; readonly start: number; readonly end: number }
/** Match before wrapping so soft line breaks cannot create false whole words or hide split matches. */
export function previewHighlightRanges(preview: SessionSearchPreview, options: SessionSearchOptions): Array<{ start: number; end: number }> {
  if (!options.query) return [];
  return [...preview.text.matchAll(searchPattern(options))].map((match) => ({ start: preview.start + match.index, end: preview.start + match.index + match[0].length }));
}
/** Wrap plain source text once to the result width, then take rendered lines around the focused occurrence. */
export function sessionPreviewLines(preview: SessionSearchPreview, match: SessionMatch, context: number, width: number, measure: (text: string) => number): { lines: PreviewLine[]; before: boolean; after: boolean } {
  const lines: PreviewLine[] = [];
  let offset = preview.start;
  for (const paragraph of preview.text.split("\n")) {
    let at = 0;
    if (!paragraph.length) lines.push({ text: "", start: offset, end: offset });
    while (at < paragraph.length) {
      let low = at + 1, high = paragraph.length;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (measure(paragraph.slice(at, mid)) <= width) low = mid; else high = mid - 1; }
      let end = low;
      if (end < paragraph.length) { const space = paragraph.lastIndexOf(" ", end - 1); if (space > at) end = space + 1; }
      // Keep surrogate pairs together, even when a single glyph is wider than the panel.
      if (end < paragraph.length && /[\uD800-\uDBFF]/.test(paragraph[end - 1]!)) end += 1;
      lines.push({ text: paragraph.slice(at, end), start: offset + at, end: offset + end }); at = end;
    }
    offset += paragraph.length + 1;
  }
  const first = Math.max(0, lines.findIndex((line) => line.end > match.start));
  let last = first;
  while (last + 1 < lines.length && lines[last + 1]!.start < match.end) last += 1;
  const from = Math.max(0, first - context), to = Math.min(lines.length, last + context + 1);
  return { lines: lines.slice(from, to), before: preview.start > 0 || from > 0, after: preview.start + preview.text.length < preview.totalLength || to < lines.length };
}
