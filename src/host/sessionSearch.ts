import type { OrchestrationV2ThreadProjection, OrchestrationV2ThreadHistoryPage } from "@t3tools/contracts";
import type { TranscriptItem } from "../shared/bridge.js";
import { findSessionMatches, searchableFields, type SessionSearchOptions, type SessionSearchState } from "../shared/sessionSearch.js";
import { sessionSearchPreview, type SessionSearchPreview } from "../shared/sessionSearchPresentation.js";

export type SearchRow = OrchestrationV2ThreadProjection["visibleTurnItems"][number];
const key = (row: SearchRow) => `${row.sourceThreadId}:${row.sourceItemId}`;
interface SearchSources {
  present: (row: SearchRow) => TranscriptItem;
  history: (cursor: string) => Promise<OrchestrationV2ThreadHistoryPage>;
  detail: (row: SearchRow) => Promise<SearchRow>;
}
export class SessionSearchJob {
  readonly threadId: string;
  readonly options: SessionSearchOptions;
  private readonly update: () => void;
  cancelled = false;
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
  cancel(): void { this.cancelled = true; if (this.timer) clearTimeout(this.timer); this.pending.clear(); }
  previews(ids: readonly string[]): SessionSearchPreview[] {
    if (this.cancelled || !this.sources) throw new Error("Search this conversation again.");
    const wanted = new Set(ids), matches = this.state.matches.filter((match) => wanted.has(match.id));
    return matches.flatMap((match) => {
      const row = this.rows.get(match.rowKey);
      const source = row && searchableFields(this.sources!.present(row), this.options.scope).find((entry) => entry.field === match.field);
      return source ? [sessionSearchPreview(source.text, match)] : [];
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
