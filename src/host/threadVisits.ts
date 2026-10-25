/** A thread on screen: its tab is visible and the VS Code window has focus. */
export interface SeenThread {
  readonly threadId: string;
  /** The shell's updatedAt: the watermark a visit records, as T3 Code's own client does. */
  readonly updatedAt: string;
  readonly lastVisitedAt: string | null;
  /** Something unseen (a finished or failed run, a wake) is showing, so the visit should not wait for the throttle. */
  readonly urgent: boolean;
}

/** At most one visit per thread in this window, as in T3 Code, unless something unseen is showing. */
export const VISIT_THROTTLE_MS = 10_000;

/**
 * Tells the server a thread was seen, which clears its unread state here and in T3 Code.
 * Only threads actually on screen count, so a run that finishes in a background tab, or while
 * the window is unfocused, stays unread until the person looks. Mark unread holds until the
 * thread changes or leaves the screen.
 */
export class ThreadVisits {
  private readonly sent = new Map<string, { readonly updatedAt: string; readonly at: number }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly heldUnread = new Map<string, string>();
  private onScreen = new Map<string, SeenThread>();

  private readonly dispatch: (threadId: string, visitedAt: string) => Promise<void>;
  private readonly now: () => number;
  constructor(dispatch: (threadId: string, visitedAt: string) => Promise<void>, now: () => number = Date.now) { this.dispatch = dispatch; this.now = now; }

  /** Mark unread: keep the thread unread while it stays on screen unchanged. */
  holdUnread(threadId: string, updatedAt: string): void {
    this.heldUnread.set(threadId, updatedAt);
    // Mark unread rewinds the server's watermark without changing the thread, so the next look must send it again.
    this.sent.delete(threadId);
    this.cancel(threadId);
  }

  update(seen: ReadonlyArray<SeenThread>): void {
    const next = new Map(seen.map((thread) => [thread.threadId, thread]));
    // Leaving the screen ends a hold: looking again later is a fresh visit.
    for (const threadId of this.onScreen.keys()) if (!next.has(threadId)) { this.heldUnread.delete(threadId); this.cancel(threadId); }
    this.onScreen = next;
    for (const thread of next.values()) this.consider(thread);
  }

  dispose(): void { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }

  private consider(thread: SeenThread): void {
    const held = this.heldUnread.get(thread.threadId);
    if (held === thread.updatedAt) return;
    if (held !== undefined) this.heldUnread.delete(thread.threadId);
    if (thread.lastVisitedAt && Date.parse(thread.lastVisitedAt) >= Date.parse(thread.updatedAt)) return;
    const previous = this.sent.get(thread.threadId);
    if (previous?.updatedAt === thread.updatedAt) return;
    const wait = previous && !thread.urgent ? previous.at + VISIT_THROTTLE_MS - this.now() : 0;
    if (wait <= 0) { this.send(thread); return; }
    if (this.timers.has(thread.threadId)) return;
    this.timers.set(thread.threadId, setTimeout(() => {
      this.timers.delete(thread.threadId);
      const latest = this.onScreen.get(thread.threadId);
      if (latest) this.consider({ ...latest, urgent: true });
    }, wait));
  }

  private send(thread: SeenThread): void {
    this.cancel(thread.threadId);
    this.sent.set(thread.threadId, { updatedAt: thread.updatedAt, at: this.now() });
    // A lost visit only leaves the thread unread; the next change on screen retries.
    void this.dispatch(thread.threadId, thread.updatedAt).catch(() => {
      if (this.sent.get(thread.threadId)?.updatedAt === thread.updatedAt) this.sent.delete(thread.threadId);
    });
  }

  private cancel(threadId: string): void {
    const timer = this.timers.get(threadId);
    if (timer) { clearTimeout(timer); this.timers.delete(threadId); }
  }
}
