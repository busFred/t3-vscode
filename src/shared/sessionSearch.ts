import { htmlVisual } from "./chatVisuals.js";
import type { TranscriptItem } from "./bridge.js";

export const SEARCH_SOURCES = ["user", "assistant", "tools", "thought", "files", "other"] as const;
export const SEARCH_CONTENT = ["figures", "code", "equations", "files"] as const;
export type SearchSource = typeof SEARCH_SOURCES[number];
export type SearchContent = typeof SEARCH_CONTENT[number];
export interface SessionSearchOptions { readonly sources?: readonly SearchSource[]; readonly content?: readonly SearchContent[]; readonly query: string; readonly caseSensitive: boolean; readonly wholeWord: boolean; readonly scope: "all" | "messages" }
export interface SessionMatch { readonly id: string; readonly rowKey: string; readonly field: string; readonly start: number; readonly end: number; readonly occurrence: number; readonly snippet: string; readonly kind: string; readonly timestamp?: string | null }
export interface SessionSearchState extends SessionSearchOptions { readonly threadId: string; readonly matches: ReadonlyArray<SessionMatch>; readonly total: number; readonly scanning: boolean; readonly error?: string; readonly scannedItems: number; readonly revision?: number }
export function searchPattern(options: SessionSearchOptions): RegExp {
  const literal = options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(options.wholeWord ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal, options.caseSensitive ? "gu" : "giu");
}
export function searchableFields(row: TranscriptItem, scope: SessionSearchOptions["scope"]): ReadonlyArray<{ field: string; text: string }> {
  const item = row.item;
  if (item.type === "user_message" || item.type === "assistant_message") return [{ field: "text", text: item.text }, ...(item.type === "user_message" ? item.attachments.map((attachment, index) => ({ field: `attachment:${index}`, text: attachment.name })) : [])];
  if (scope === "messages") return [];
  switch (item.type) {
    case "reasoning": return [{ field: "text", text: item.text }];
    case "proposed_plan": return [{ field: "text", text: item.markdown }];
    case "command_execution": return [{ field: "input", text: item.input }, { field: "output", text: row.output ?? "" }];
    case "dynamic_tool": return /(?:^|[._])html_render$/.test(item.toolName ?? "") ? [{ field: "title", text: item.title ?? "Visualization" }] : [{ field: "input", text: typeof item.input === "string" ? item.input : JSON.stringify(item.input) ?? "" }, { field: "output", text: row.output ?? "" }];
    case "file_change": return [{ field: "file", text: item.fileName }, { field: "diff", text: item.diffStr ?? [item.oldStr, item.newStr].filter(Boolean).join("\n") }];
    case "todo_list": return [{ field: "text", text: [item.explanation, ...item.steps.map((step) => step.text)].filter(Boolean).join("\n") }];
    case "system_notice": return [{ field: "text", text: item.message }];
    case "error": return [{ field: "text", text: item.failure.message }];
    case "user_input_request": return [{ field: "text", text: item.questions.map((question) => question.question).join("\n") }];
    case "file_search": return [{ field: "text", text: item.results?.map((result) => `${result.fileName}\n${result.preview ?? ""}`).join("\n") ?? "" }];
    case "web_search": return [{ field: "text", text: item.results?.map((result) => `${result.title ?? ""}\n${result.snippet ?? ""}\n${result.url ?? ""}`).join("\n") ?? "" }];
    case "notification": return [{ field: "text", text: `${item.summary}\n${item.detail ?? ""}` }];
    case "compaction": case "handoff": return [{ field: "text", text: item.summary ?? "" }];
    default: return [];
  }
}
/** Filters describe record types and content; they never classify assistant prose as hidden reasoning. */
export function matchesSearchFilters(row: TranscriptItem, options: SessionSearchOptions): boolean {
  const item = row.item;
  const source: SearchSource = item.type === "user_message" ? "user" : item.type === "assistant_message" || item.type === "proposed_plan" ? "assistant"
    : item.type === "reasoning" ? "thought" : item.type === "command_execution" || item.type === "dynamic_tool" ? "tools"
    : item.type === "file_change" || item.type === "file_search" ? "files" : "other";
  if (options.sources && !options.sources.includes(source)) return false;
  if (!options.content?.length) return true;
  const text = searchableFields(row, options.scope).map(field => field.text).join("\n");
  const attachments = item.type === "user_message" ? item.attachments : [];
  const features: Record<SearchContent, boolean> = {
    figures: attachments.some(file => file.mimeType.startsWith("image/")) || /!\[[^\]]*\]\(|```mermaid\b/.test(text) || item.type === "dynamic_tool" && (!!htmlVisual(item) || /(?:^|[._])html_render$/.test(item.toolName ?? "")),
    code: /`[^`\n]+`|```|~~~/.test(text) || item.type === "command_execution" || item.type === "file_change",
    equations: /\$[^$\n]+\$|\$\$|\\\(|\\\[/.test(text),
    files: attachments.length > 0 || item.type === "file_change" || item.type === "file_search",
  };
  return options.content.some(feature => features[feature]);
}
export function parseSearchFilters(value: Record<string, unknown>): Pick<SessionSearchOptions, "sources" | "content"> {
  const array = <T extends string>(raw: unknown, allowed: readonly T[]): readonly T[] | undefined => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.some(item => !allowed.includes(item)) || raw.length > allowed.length) throw new Error("Invalid search filters.");
    return [...new Set(raw)] as T[];
  };
  const sources = array(value.sources, SEARCH_SOURCES), content = array(value.content, SEARCH_CONTENT);
  return { ...(sources ? { sources } : {}), ...(content ? { content } : {}) };
}
export function sameSearchFilters(a: SessionSearchOptions, b: SessionSearchOptions): boolean {
  return JSON.stringify(a.sources ?? SEARCH_SOURCES) === JSON.stringify(b.sources ?? SEARCH_SOURCES) && JSON.stringify(a.content ?? []) === JSON.stringify(b.content ?? []);
}
export function findSessionMatches(row: TranscriptItem, options: SessionSearchOptions, limit = 20_000): { matches: SessionMatch[]; total: number } {
  const matches: SessionMatch[] = []; let total = 0;
  if (!options.query || !matchesSearchFilters(row, options)) return { matches, total };
  for (const { field, text } of searchableFields(row, options.scope)) {
    let occurrence = 0;
    for (const match of text.matchAll(searchPattern(options))) {
      const start = match.index, end = start + match[0].length;
      total += 1;
      if (matches.length < limit) matches.push({ id: `${row.key}:${field}:${start}`, rowKey: row.key, field, start, end, occurrence,
        snippet: text.slice(Math.max(0, start - 55), Math.min(text.length, end + 85)).replace(/\s+/g, " "), kind: row.item.type.replaceAll("_", " "), timestamp: row.item.startedAt });
      occurrence += 1;
    }
  }
  return { matches, total };
}
