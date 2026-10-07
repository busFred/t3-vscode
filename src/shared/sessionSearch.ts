import type { TranscriptItem } from "./bridge.js";

export interface SessionSearchOptions { readonly query: string; readonly caseSensitive: boolean; readonly wholeWord: boolean; readonly scope: "all" | "messages" }
export interface SessionMatch { readonly id: string; readonly rowKey: string; readonly field: string; readonly start: number; readonly end: number; readonly occurrence: number; readonly snippet: string; readonly kind: string }
export interface SessionSearchState extends SessionSearchOptions { readonly threadId: string; readonly matches: ReadonlyArray<SessionMatch>; readonly total: number; readonly scanning: boolean; readonly error?: string; readonly scannedItems: number }
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
export function findSessionMatches(row: TranscriptItem, options: SessionSearchOptions, limit = 20_000): { matches: SessionMatch[]; total: number } {
  const matches: SessionMatch[] = []; let total = 0;
  if (!options.query) return { matches, total };
  for (const { field, text } of searchableFields(row, options.scope)) {
    let occurrence = 0;
    for (const match of text.matchAll(searchPattern(options))) {
      const start = match.index, end = start + match[0].length;
      total += 1;
      if (matches.length < limit) matches.push({ id: `${row.key}:${field}:${start}`, rowKey: row.key, field, start, end, occurrence,
        snippet: `${start > 55 ? "…" : ""}${text.slice(Math.max(0, start - 55), Math.min(text.length, end + 85)).replace(/\s+/g, " ")}${end + 85 < text.length ? "…" : ""}`, kind: row.item.type.replaceAll("_", " ") });
      occurrence += 1;
    }
  }
  return { matches, total };
}
