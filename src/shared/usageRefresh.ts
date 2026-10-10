export const DEFAULT_USAGE_REFRESH_SECONDS = 60;
export const MIN_USAGE_REFRESH_SECONDS = 15;

/** Interval in milliseconds, or null when periodic refresh is disabled (0). Values below the minimum are raised to it. */
export function usageRefreshIntervalMs(seconds: unknown): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DEFAULT_USAGE_REFRESH_SECONDS * 1000;
  if (seconds <= 0) return null;
  return Math.max(MIN_USAGE_REFRESH_SECONDS, seconds) * 1000;
}

export interface UsageRefreshTimers {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

/** Refreshes provider usage once when the host becomes ready, then on a configurable interval while it stays ready. */
export class UsageRefreshScheduler {
  private handle: unknown = null;
  private ready = false;
  private disposed = false;
  private intervalMs: number | null = null;
  private inFlight = false;
  private readonly refresh: () => Promise<void>;
  private readonly timers: UsageRefreshTimers;
  constructor(
    refresh: () => Promise<void>,
    timers: UsageRefreshTimers = { set: (callback, ms) => setInterval(callback, ms), clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
  ) {
    this.refresh = refresh;
    this.timers = timers;
  }
  /** Applies a (possibly changed) interval setting, restarting the timer. */
  configure(seconds: unknown): void {
    const intervalMs = usageRefreshIntervalMs(seconds);
    if (intervalMs === this.intervalMs && (this.handle !== null) === (intervalMs !== null)) return;
    this.intervalMs = intervalMs;
    this.restart();
  }
  /** Reports whether the host is connected; the transition to ready triggers an immediate refresh. */
  setReady(ready: boolean): void {
    if (this.disposed || ready === this.ready) return;
    this.ready = ready;
    if (ready) this.run();
  }
  dispose(): void {
    this.disposed = true;
    this.stop();
  }
  private restart(): void {
    this.stop();
    if (this.disposed || this.intervalMs === null) return;
    this.handle = this.timers.set(() => { if (this.ready) this.run(); }, this.intervalMs);
  }
  private stop(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
  private run(): void {
    if (this.inFlight || this.disposed) return;
    this.inFlight = true;
    void this.refresh().catch(() => undefined).finally(() => { this.inFlight = false; });
  }
}
