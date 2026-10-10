export const DEFAULT_USAGE_REFRESH_SECONDS = 300;
export const MIN_USAGE_REFRESH_SECONDS = 15;
/** Extra delay, as a fraction of the interval, drawn randomly per tick so a fixed beat cannot keep landing on the same keystrokes. */
export const USAGE_REFRESH_JITTER = 0.2;
/** Refresh even while the host is busy once the meters are this many intervals stale. */
export const USAGE_REFRESH_STALENESS_INTERVALS = 5;

/** Interval in milliseconds, or null when periodic refresh is disabled (0). Values below the minimum are raised to it. */
export function usageRefreshIntervalMs(seconds: unknown): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DEFAULT_USAGE_REFRESH_SECONDS * 1000;
  if (seconds <= 0) return null;
  return Math.max(MIN_USAGE_REFRESH_SECONDS, seconds) * 1000;
}

export interface UsageRefreshTimers {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
  readonly now: () => number;
  /** Jitter source in [0, 1). */
  readonly random: () => number;
}

const systemTimers: UsageRefreshTimers = {
  set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(), random: () => Math.random(),
};

/**
 * Refreshes provider usage once when the host becomes ready, then on a configurable interval while it stays ready.
 *
 * A refresh makes T3 rescan provider transcripts and re-probe provider instances, which competes with sending a
 * message on the same server. Ticks that arrive while the host is busy, or while no meter is displayed to refresh
 * for, are therefore deferred until that changes rather than dropped, and the delay carries jitter so a fixed
 * cadence cannot keep colliding with the same keystrokes. The staleness ceiling still forces a refresh during a
 * long run, so the meters cannot freeze indefinitely.
 */
export class UsageRefreshScheduler {
  private handle: unknown = null;
  private ready = false;
  private busy = false;
  private displayed = true;
  private disposed = false;
  private pending = false;
  private inFlight = false;
  /** Counts connect and display transitions, which want their own refresh even if one was already under way. */
  private releases = 0;
  private intervalMs: number | null = null;
  private refreshedAt: number | null = null;
  private readonly refresh: () => Promise<void>;
  private readonly timers: UsageRefreshTimers;
  constructor(refresh: () => Promise<void>, timers: UsageRefreshTimers = systemTimers) {
    this.refresh = refresh;
    this.timers = timers;
  }
  /** Applies a (possibly changed) interval setting, restarting the timer. */
  configure(seconds: unknown): void {
    const intervalMs = usageRefreshIntervalMs(seconds);
    if (intervalMs === this.intervalMs && (this.handle !== null) === (intervalMs !== null)) return;
    this.intervalMs = intervalMs;
    this.schedule();
  }
  /** Reports whether the host is connected; the transition to ready requests an immediate refresh. */
  setReady(ready: boolean): void {
    if (this.disposed || ready === this.ready) return;
    this.ready = ready;
    if (ready) { this.pending = true; this.releases += 1; this.drain(); }
  }
  /** Reports whether the host is sending a message or running a turn; going idle releases a deferred refresh. */
  setBusy(busy: boolean): void {
    if (this.disposed || busy === this.busy) return;
    this.busy = busy;
    if (!busy) this.drain();
  }
  /** Reports whether any meter needs the data; a refresh due while nothing is shown waits for one to appear. */
  setDisplayed(displayed: boolean): void {
    if (this.disposed || displayed === this.displayed) return;
    this.displayed = displayed;
    if (displayed) { this.releases += 1; this.drain(); }
  }
  dispose(): void {
    this.disposed = true;
    this.pending = false;
    this.stop();
  }
  private schedule(): void {
    this.stop();
    if (this.disposed || this.intervalMs === null) return;
    const delay = this.intervalMs + Math.round(this.intervalMs * USAGE_REFRESH_JITTER * this.timers.random());
    this.handle = this.timers.set(() => this.tick(), delay);
  }
  private stop(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
  private tick(): void {
    this.handle = null;
    this.schedule();
    if (!this.ready) return;
    this.pending = true;
    this.drain();
  }
  /** A refresh that has never run, or one the staleness ceiling has caught up with, overrides the busy gate. */
  private overdue(): boolean {
    if (this.refreshedAt === null || this.intervalMs === null) return true;
    return this.timers.now() - this.refreshedAt >= this.intervalMs * USAGE_REFRESH_STALENESS_INTERVALS;
  }
  private drain(): void {
    if (this.disposed || !this.pending || !this.ready || this.inFlight || !this.displayed) return;
    if (this.busy && !this.overdue()) return;
    this.pending = false;
    this.inFlight = true;
    const releases = this.releases;
    void this.refresh().catch(() => undefined).finally(() => {
      this.inFlight = false;
      this.refreshedAt = this.timers.now();
      // A completed refresh satisfies any tick that arrived while it ran, so ticks never run back to back. A
      // reconnect or a meter appearing meanwhile is a different request, and a hung refresh must not swallow it.
      if (this.releases === releases) this.pending = false;
      else this.drain();
    });
  }
}
