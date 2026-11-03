/** Retry delay after consecutive failures; a successful operation resets its caller's count. */
export function retryDelay(failures: number): number { return Math.min(30_000, 1500 * 2 ** Math.min(5, Math.max(0, failures))); }

/** Leading/trailing throttle, with cancellation for observer teardown. */
export function throttle(callback: () => void, delay: number) {
  let last = -Infinity, timer: ReturnType<typeof setTimeout> | undefined;
  const invoke = () => { timer = undefined; last = Date.now(); callback(); };
  const schedule = () => {
    if (timer !== undefined) return;
    const remaining = delay - (Date.now() - last);
    if (remaining <= 0) invoke(); else timer = setTimeout(invoke, remaining);
  };
  schedule.cancel = () => { clearTimeout(timer); timer = undefined; };
  return schedule;
}
