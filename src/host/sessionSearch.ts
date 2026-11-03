import type { OrchestrationV2ThreadProjection, OrchestrationV2ThreadHistoryPage, OrchestrationV2SearchThreadResult } from "@t3tools/contracts";
import { searchableMessageSegments, searchablePlanSegments } from "@t3tools/shared/threadFindText";
import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import type { TranscriptItem } from "../shared/bridge.js";
import { findSessionMatches, searchableFields, type SessionSearchOptions, type SessionSearchState } from "../shared/sessionSearch.js";
import { sessionSearchPreview, type SessionSearchPreview } from "../shared/sessionSearchPresentation.js";

export type SearchRow = OrchestrationV2ThreadProjection["visibleTurnItems"][number];
const key = (row: SearchRow) => `${row.sourceThreadId}:${row.sourceItemId}`;
interface SearchSources {
  cwd?: string | undefined;
  present: (row: SearchRow) => TranscriptItem;
  history: (cursor: string) => Promise<OrchestrationV2ThreadHistoryPage>;
  detail: (row: SearchRow) => Promise<SearchRow>;
}
/** Only the unfiltered user/assistant message subset has server-side find semantics. */
export function supportsThreadFindStream(options: SessionSearchOptions): boolean {
  return options.scope === "text" && !options.caseSensitive && !options.wholeWord && !options.content?.length
    && options.query === options.query.trim() && options.query.length <= 200
    && options.sources?.length === 2 && options.sources.includes("user") && options.sources.includes("assistant");
}
type FindSubscribe = (handler: (result: OrchestrationV2SearchThreadResult) => void, onError: (message: string) => void, index?: number) => Promise<() => Promise<void>>;
export class SessionSearchJob {
  readonly threadId: string;
  readonly options: SessionSearchOptions;
  private readonly update: () => void;
  cancelled = false;
  private streaming = false;
  private refreshStream: ((rows: ReadonlyArray<SearchRow>) => void) | undefined;
  private stopStream: (() => Promise<void>) | undefined;
  private readonly streamText = new Map<string, string>();
  readonly historyPages = new Map<string, readonly SearchRow[]>();
  readonly rows = new Map<string, SearchRow>();
  private readonly originals = new Map<string, SearchRow>();
  private readonly found = new Map<string, ReturnType<typeof findSessionMatches>>();
  private readonly pending = new Map<string, SearchRow>();
  private order: string[] = [];
  private sources: SearchSources | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshing = false;
  state: SessionSearchState;
  constructor(threadId: string, options: SessionSearchOptions, update: () => void) {
    this.threadId = threadId; this.options = options; this.update = update;
    this.state = { ...options, threadId, matches: [], total: 0, scanning: true, scannedItems: 0 };
  }
  cancel(): void { this.cancelled = true; void this.stopStream?.(); if (this.timer) clearTimeout(this.timer); this.pending.clear(); }
  previews(ids: readonly string[]): SessionSearchPreview[] {
    if (this.cancelled || !this.sources) throw new Error("Search this conversation again.");
    const wanted = new Set(ids), matches = this.state.matches.filter((match) => wanted.has(match.id));
    return matches.flatMap((match) => {
      const row = this.rows.get(match.rowKey);
      const source = row && searchableFields(this.sources!.present(row), this.options.scope).find((entry) => entry.field === match.field);
      return source ? [sessionSearchPreview(this.streamText.get(match.rowKey) ?? source.text, match)] : [];
    });
  }
  private async index(original: SearchRow): Promise<void> {
    const rowKey = key(original);
    this.originals.set(rowKey, original);
    let row = original, presented = this.sources!.present(row);
    if (this.options.scope === "all" && presented.needsDetail) {
      row = await this.sources!.detail(row);
      if (this.cancelled) return;
      presented = this.sources!.present(row);
    }
    this.rows.set(rowKey, row);
    this.found.set(rowKey, findSessionMatches(presented, this.options));
  }
  private publish(): void {
    const matches: SessionSearchState["matches"][number][] = []; let total = 0;
    for (const rowKey of this.order) {
      const found = this.found.get(rowKey); if (!found) continue;
      total += found.total;
      if (matches.length < 20_000) matches.push(...found.matches.slice(0, 20_000 - matches.length));
    }
    this.state = { ...this.state, matches, total, scannedItems: this.rows.size, revision: (this.state.revision ?? 0) + 1 };
    this.update();
  }
  /** Coalesce streaming changes; historical pages already searched stay cached. */
  refresh(rows: ReadonlyArray<SearchRow>): void {
    if (this.cancelled) return;
    if (this.streaming) { this.refreshStream?.(rows); return; }
    for (const row of rows) if (this.originals.get(key(row)) !== row) this.pending.set(key(row), row);
    if (!this.state.scanning && !this.refreshing && !this.timer && this.pending.size) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 250);
    }
  }
  private async flush(): Promise<void> {
    if (this.cancelled || this.refreshing) return;
    this.refreshing = true;
    try {
      const batch = [...this.pending.values()]; this.pending.clear();
      for (const row of batch) {
        if (this.cancelled) return;
        if (!this.rows.has(key(row))) this.order.push(key(row));
        await this.index(row);
      }
      if (!this.cancelled) this.publish();
    } catch (cause) {
      if (!this.cancelled) { this.state = { ...this.state, error: cause instanceof Error ? cause.message : String(cause) }; this.update(); }
    } finally { this.refreshing = false; this.refresh([]); }
  }
  /** Resolve the stream's message locations using history pages without replacing the visible tail. */
  async stream(initial: ReadonlyArray<SearchRow>, cursor: string | null, sources: SearchSources, subscribe: FindSubscribe): Promise<void> {
    this.sources = sources; this.streaming = true;
    const cached = new Map(initial.map(row => [key(row), row]));
    const entries = new Map<string, { startIndex: number; count: number }>();
    const seenCursors = new Set<string>();
    let queue = Promise.resolve(), nextIndex: number | undefined, generation = 0;
    const entryId = (row: SearchRow) => row.item.type === "user_message" || row.item.type === "assistant_message" ? row.item.messageId : row.item.id;
    const fail = (cause: unknown) => {
      if (!this.cancelled) { this.state = { ...this.state, scanning: false, error: cause instanceof Error ? cause.message : String(cause) }; this.update(); }
    };
    const resolve = async (id: string) => {
      let row = [...cached.values()].find(row => entryId(row) === id);
      while (!row && cursor && !this.cancelled) {
        if (seenCursors.has(cursor)) throw new Error("History returned the same cursor twice; refresh the search.");
        seenCursors.add(cursor);
        const page = await sources.history(cursor);
        if (this.cancelled) return;
        for (const item of page.items) { cached.set(key(item), item); this.historyPages.set(key(item), page.items); }
        cursor = page.hasMoreHistory ? page.nextCursor : null;
        row = [...cached.values()].find(row => entryId(row) === id);
      }
      if (!row && !this.cancelled) throw new Error("The search result could not be loaded from history. Refresh the search.");
      return row;
    };
    const receive = async (result: OrchestrationV2SearchThreadResult, current: number) => {
      if (this.cancelled || current !== generation) return;
      const navigation = result.navigation ?? (result.match ? [{ ...result.match, startIndex: 0, count: 1 }] : []);
      for (const entry of navigation) entries.set(entry.entryId, entry);
      for (const entry of navigation) {
        const row = await resolve(entry.entryId); if (this.cancelled || current !== generation || !row) return;
        this.rows.set(key(row), row);
        const item = row.item;
        const segments = item.type === "proposed_plan" ? searchablePlanSegments(item.markdown, sources.cwd)
          : item.type === "user_message" || item.type === "assistant_message" ? searchableMessageSegments({ role: item.type === "user_message" ? "user" : "assistant", text: item.text,
            streaming: item.type === "assistant_message" && item.streaming, ...(item.type === "user_message" ? { context: item.context } : {}) }, sources.cwd) ?? [] : [];
        const text = segments.join("\n"), matches: SessionSearchState["matches"][number][] = [];
        let offset = 0;
        for (const segment of segments) {
          for (const start of findThreadSearchOccurrences(segment, this.options.query).slice(0, Math.max(0, 20_000 - matches.length))) {
            const at = offset + start;
            matches.push({ id: `${key(row)}:text:${at}`, rowKey: key(row), field: "text", start: at, end: at + this.options.query.length,
              occurrence: matches.length, snippet: text.slice(Math.max(0, at - 55), at + this.options.query.length + 85), kind: item.type.replaceAll("_", " "), timestamp: sources.present(row).item.startedAt });
          }
          offset += segment.length + 1;
        }
        this.streamText.set(key(row), text); this.found.set(key(row), { matches, total: matches.length });
      }
      const matches = [...entries].sort((a, b) => a[1].startIndex - b[1].startIndex).flatMap(([id]) => {
        const row = [...this.rows.values()].find(row => entryId(row) === id);
        return row ? this.found.get(key(row))?.matches.filter(match => match.field === "text") ?? [] : [];
      }).slice(0, 20_000);
      this.state = { ...this.state, matches, total: result.totalMatches, scanning: result.complete === false,
        scannedItems: cached.size, revision: (this.state.revision ?? 0) + 1 };
      this.update();
      // The RPC exposes at most 17 neighboring entries. Request the first uncovered index.
      if (result.complete !== false && matches.length < 20_000) {
        let covered = 0;
        for (const entry of [...entries.values()].sort((a, b) => a.startIndex - b.startIndex)) {
          if (entry.startIndex > covered) break;
          covered = Math.max(covered, entry.startIndex + entry.count);
        }
        if (covered < result.totalMatches) {
          if (nextIndex === covered) throw new Error("Search navigation did not advance. Refresh the search.");
          nextIndex = covered; this.state = { ...this.state, scanning: true }; this.update();
          await start(covered);
        }
      }
    };
    const start = async (index?: number) => {
      const current = ++generation;
      try {
        await this.stopStream?.();
        const stop = await subscribe(result => { queue = queue.then(() => current === generation ? receive(result, current) : undefined).catch(cause => { if (current === generation) fail(cause); }); }, message => { if (current === generation) fail(message); }, index);
        if (this.cancelled || current !== generation) await stop(); else this.stopStream = stop;
      } catch (cause) { if (current === generation) fail(cause); }
    };
    this.refreshStream = rows => {
      let changed = false;
      for (const row of rows) if (cached.get(key(row)) !== row) { cached.set(key(row), row); changed = true; }
      if (changed) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = undefined; entries.clear(); nextIndex = undefined;
          this.state = { ...this.state, scanning: true }; this.update();
          void start().catch(fail);
        }, 250);
      }
    };
    try { await start(); } catch (cause) { fail(cause); }
  }
  async scan(initial: ReadonlyArray<SearchRow>, cursor: string | null, sources: SearchSources, hasMoreHistory = !!cursor): Promise<void> {
    this.sources = sources;
    let batch = initial; const cursors = new Set<string>(); let lastUpdate = 0;
    try {
      if (hasMoreHistory && !cursor) throw new Error("Older history is unavailable; the match count is incomplete.");
      while (!this.cancelled) {
        const added = batch.filter((row) => !this.rows.has(key(row))).map(key);
        this.order = [...added, ...this.order];
        for (const original of batch) {
          if (this.cancelled) return;
          const rowKey = key(original); if (this.rows.has(rowKey)) continue;
          const row = this.pending.get(rowKey) ?? original; this.pending.delete(rowKey);
          await this.index(row); if (this.cancelled) return;
          if (Date.now() - lastUpdate > 250) { this.publish(); lastUpdate = Date.now(); }
        }
        this.publish();
        if (!cursor) break;
        if (cursors.has(cursor)) throw new Error("History returned the same cursor twice; refresh the search.");
        cursors.add(cursor);
        const page = await sources.history(cursor); if (this.cancelled) return;
        batch = page.items; cursor = page.hasMoreHistory ? page.nextCursor : null;
        if (page.hasMoreHistory && !cursor) throw new Error("Older history is unavailable; the match count is incomplete.");
      }
      if (!this.cancelled) { this.state = { ...this.state, scanning: false }; await this.flush(); }
    } catch (cause) {
      if (!this.cancelled) { this.state = { ...this.state, scanning: false, error: cause instanceof Error ? cause.message : String(cause) }; this.update(); }
    }
  }
}
