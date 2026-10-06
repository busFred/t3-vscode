import type { TranscriptItem } from "./bridge.js";
import { htmlVisual } from "./chatVisuals.js";

export interface DisplayRow { readonly key: string; readonly rows: ReadonlyArray<TranscriptItem>; readonly firstIndex: number }
export function isWorkItem(row: TranscriptItem): boolean {
  switch (row.item.type) {
    case "reasoning": case "command_execution": case "file_change": case "file_search": case "web_search": return true;
    case "dynamic_tool": return !htmlVisual(row.item) && !/(?:^|[._])html_render$/.test(row.item.toolName ?? "");
    default: return false;
  }
}
/** Collapse contiguous activity without swallowing messages, requests or visuals. */
export function transcriptRows(items: ReadonlyArray<TranscriptItem>): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let work: TranscriptItem[] | null = null;
  for (const [index, item] of items.entries()) {
    if (isWorkItem(item)) {
      if (work) work.push(item);
      else { work = [item]; rows.push({ key: item.key, rows: work, firstIndex: index }); }
    } else { work = null; rows.push({ key: item.key, rows: [item], firstIndex: index }); }
  }
  return rows;
}
export function workSummary(items: ReadonlyArray<TranscriptItem>): string {
  const commands = items.filter((row) => row.item.type === "command_execution").length;
  const thoughts = items.some((row) => row.item.type === "reasoning");
  const other = items.filter((row) => row.item.type !== "reasoning" && row.item.type !== "command_execution").length;
  const running = items.some((row) => row.item.status === "running");
  return [commands ? `${running ? "Running" : "Ran"} ${commands} command${commands === 1 ? "" : "s"}` : null,
    other ? `${other} tool call${other === 1 ? "" : "s"}` : null, thoughts ? "Thought process" : null].filter(Boolean).join(" · ");
}
