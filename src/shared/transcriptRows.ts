import { mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import type { TranscriptItem } from "./bridge.js";
import { htmlVisual } from "./chatVisuals.js";

/** A run's final checkpoint already covers its complete baseline-to-end range. */
export function finalResponseCheckpoints(items: ReadonlyArray<TranscriptItem>): ReadonlyArray<TranscriptItem> {
  const latest = new Map<string, TranscriptItem>();
  const key = (row: TranscriptItem) => JSON.stringify([row.sourceThreadId, row.item.runId]);
  for (const row of items) if (row.item.type === "checkpoint" && row.item.runId) latest.set(key(row), row);
  return items.filter(row => row.item.type !== "checkpoint" || !row.item.runId || latest.get(key(row)) === row);
}

export interface DisplayRow {
  readonly key: string; readonly rows: ReadonlyArray<TranscriptItem>; readonly firstIndex: number;
  /** Set on a round fold: the display rows it hides, rendered as they would be unfolded once opened. */
  readonly fold?: ReadonlyArray<DisplayRow>;
}
export function isWorkItem(row: TranscriptItem): boolean {
  switch (row.item.type) {
    case "reasoning": case "command_execution": case "file_change": case "file_search": case "web_search": return true;
    case "dynamic_tool": return !mcpAppFromToolItem(row.item) && !row.item.viewedImagePath && !htmlVisual(row.item) && !/(?:^|[._])html_render$/.test(row.item.toolName ?? "");
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
/** What a settled round may hide: work, the agent's running commentary, and images it read on the way. */
function foldable(row: DisplayRow): boolean {
  const first = row.rows[0]!;
  return isWorkItem(first) || first.item.type === "assistant_message" || (first.item.type === "dynamic_tool" && !!first.item.viewedImagePath);
}
const runKey = (row: TranscriptItem) => row.item.runId ? `${row.sourceThreadId}:${row.item.runId}` : null;
const unsettled = (row: TranscriptItem) => row.item.status === "running" || row.item.status === "pending";

/**
 * Folds a settled round the way T3 Code does: once a response has ended, everything the agent did on
 * the way to its answer collapses behind one "Worked for …" row, leaving the prompt and the answer.
 *
 * - A round is split at every user message, so a steer starts its own segment and the reply to that
 *   steer is the last assistant message of its segment. Each segment's last assistant message stays
 *   visible; only what came before it folds.
 * - The run in progress never folds, nor does any segment with a running or pending item.
 * - Requests, visuals, MCP apps, checkpoints and anything else that is not foldable stay in place and
 *   split the fold around them.
 * - A lone foldable row is left alone; it already has its own collapsed form.
 *
 * Folded rows keep their own display rows, so opening a fold shows the existing work groups, still
 * collapsed — the fold nests rather than replaces them.
 */
export function foldSettledRounds(rows: ReadonlyArray<DisplayRow>, activeRunId: string | null | undefined): DisplayRow[] {
  const out: DisplayRow[] = [];
  let segment: DisplayRow[] = [];
  const emit = (stretch: DisplayRow[]) => {
    if (stretch.length < 2) { out.push(...stretch); return; }
    out.push({ key: `fold:${stretch[0]!.key}`, rows: stretch.flatMap((row) => row.rows), firstIndex: stretch[0]!.firstIndex, fold: stretch });
  };
  const flush = () => {
    const current = segment; segment = [];
    if (!current.length) return;
    const first = current[0]!.rows[0]!;
    const live = (activeRunId && first.item.runId === activeRunId) || current.some((row) => row.rows.some(unsettled));
    const answer = live ? -1 : current.findLastIndex((row) => row.rows[0]!.item.type === "assistant_message");
    if (answer <= 0) { out.push(...current); return; }
    let stretch: DisplayRow[] = [];
    for (const row of current.slice(0, answer)) {
      if (foldable(row)) { stretch.push(row); continue; }
      emit(stretch); stretch = []; out.push(row);
    }
    emit(stretch);
    out.push(...current.slice(answer));
  };
  let segmentRun: string | null = null;
  for (const row of rows) {
    const first = row.rows[0]!;
    const key = runKey(first);
    if (first.item.type === "user_message" || key === null) { flush(); segmentRun = null; out.push(row); continue; }
    if (key !== segmentRun) { flush(); segmentRun = key; }
    segment.push(row);
  }
  flush();
  return out;
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
