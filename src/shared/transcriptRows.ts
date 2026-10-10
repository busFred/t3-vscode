import type { TranscriptItem } from "./bridge.js";
import { htmlVisual } from "./chatVisuals.js";

/** A run's final checkpoint already covers its complete baseline-to-end range. */
export function finalResponseCheckpoints(items: ReadonlyArray<TranscriptItem>): ReadonlyArray<TranscriptItem> {
  const latest = new Map<string, TranscriptItem>();
  const key = (row: TranscriptItem) => JSON.stringify([row.sourceThreadId, row.item.runId]);
  for (const row of items) if (row.item.type === "checkpoint" && row.item.runId) latest.set(key(row), row);
  return items.filter(row => row.item.type !== "checkpoint" || !row.item.runId || latest.get(key(row)) === row);
}

export interface DisplayRow { readonly key: string; readonly rows: ReadonlyArray<TranscriptItem>; readonly firstIndex: number }
export function isWorkItem(row: TranscriptItem): boolean {
  switch (row.item.type) {
    case "reasoning": case "command_execution": case "file_change": case "file_search": case "web_search": return true;
    case "dynamic_tool": return !row.item.viewedImagePath && !htmlVisual(row.item) && !/(?:^|[._])html_render$/.test(row.item.toolName ?? "");
    default: return false;
  }
}
/** Collapse contiguous activity without swallowing messages, requests or visuals. */
export function transcriptRows(items: ReadonlyArray<TranscriptItem>): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let work: TranscriptItem[] | null = null;
  for (const [index, item] of items.entries()) {
    if (isWorkItem(item)) {
      if (work && work[0]!.sourceThreadId === item.sourceThreadId && work[0]!.item.runId === item.item.runId) work.push(item);
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

/** Only explicit run identity groups assistant authors; steers do not begin another response. */
export function responseBoundaries(items: ReadonlyArray<TranscriptItem>): Map<string, { first: string; last: string; answer?: TranscriptItem | undefined }> {
  const runs = new Map<string, { first: string; last: string; answer?: TranscriptItem | undefined }>();
  for (const row of items) {
    if (!row.item.runId || row.item.type === "user_message") continue;
    const key = `${row.sourceThreadId}:${row.item.runId}`, previous = runs.get(key);
    runs.set(key, { first: previous?.first ?? row.key, last: row.key, answer: row.item.type === "assistant_message" ? row : previous?.answer });
  }
  return runs;
}
export function workElapsed(items: ReadonlyArray<TranscriptItem>, now = Date.now()): string {
  const running = items.some(row => row.item.status === "running" || row.item.status === "pending");
  const starts = items.map(row => Date.parse(row.item.startedAt ?? "")).filter(Number.isFinite);
  const ends = items.map(row => Date.parse(row.item.completedAt ?? row.item.startedAt ?? "")).filter(Number.isFinite);
  if (!starts.length) return running ? "Working" : "Thoughts and tools";
  const seconds = Math.max(0, Math.floor(((running ? now : Math.max(...ends, ...starts)) - Math.min(...starts)) / 1000));
  return `${running ? "Working" : "Worked"} for ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ` : ""}${seconds % 60}s`;
}
