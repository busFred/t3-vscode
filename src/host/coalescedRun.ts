/**
 * Runs `task` one at a time. A call while it runs asks for one more pass after it, however many calls
 * arrive, so the last pass always starts after the last call and an older pass never lands after a newer one.
 */
export function coalescedRun(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null, again = false;
  return () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await task().catch(() => undefined); } while (again); }
      finally { running = null; }
    })();
    return running;
  };
}
