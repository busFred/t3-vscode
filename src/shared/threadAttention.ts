import { resolveCustomSnooze } from "@t3tools/client-runtime/state/thread-settled";

/** The latest run, as T3's sidebar presents it. */
export interface AttentionRun { readonly status: string; readonly completedAt: string | null }

/**
 * Something finished since the person last looked, using T3's own sidebar rules:
 * a completion counts only once the thread has been visited, while a failure always
 * needs someone, even on a thread nobody has opened yet (an automation's, say).
 */
export function unseenRun(run: AttentionRun | null, lastVisitedAt: string | null | undefined): "done" | "failed" | null {
  if (!run) return null;
  const completedAt = Date.parse(run.completedAt ?? ""), visitedAt = Date.parse(lastVisitedAt ?? "");
  if (run.status === "failed") return !lastVisitedAt || Number.isNaN(completedAt) || Number.isNaN(visitedAt) || completedAt > visitedAt ? "failed" : null;
  if (!run.completedAt || Number.isNaN(completedAt) || !lastVisitedAt) return null;
  return Number.isNaN(visitedAt) || completedAt > visitedAt ? "done" : null;
}

const UNITS: Record<string, "minutes" | "hours" | "days"> = { m: "minutes", min: "minutes", mins: "minutes", minute: "minutes", minutes: "minutes", h: "hours", hr: "hours", hrs: "hours", hour: "hours", hours: "hours", d: "days", day: "days", days: "days" };

/**
 * A custom snooze typed by the person: a duration (`90m`, `2h`, `3 days`), a local date and time
 * (`2026-10-25 14:00`), or a time of day (`14:00`, today if still ahead, otherwise tomorrow).
 * Returns the wake time as ISO, or null when the text is not understood or not in the future.
 */
export function parseCustomSnooze(text: string, now: Date): string | null {
  const value = text.trim().toLowerCase();
  const duration = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(value);
  if (duration) {
    const unit = UNITS[duration[2]!];
    return unit ? resolveCustomSnooze({ mode: "duration", amount: duration[1]!, unit }, now) : null;
  }
  const dated = /^(\d{4}-\d{2}-\d{2})[ t](\d{1,2}):(\d{2})$/.exec(value);
  if (dated) return resolveCustomSnooze({ mode: "date", date: dated[1]!, time: `${dated[2]!.padStart(2, "0")}:${dated[3]}` }, now);
  const time = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!time) return null;
  const clock = `${time[1]!.padStart(2, "0")}:${time[2]}`;
  const day = (offset: number) => { const date = new Date(now); date.setDate(date.getDate() + offset); return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  return resolveCustomSnooze({ mode: "date", date: day(0), time: clock }, now) ?? resolveCustomSnooze({ mode: "date", date: day(1), time: clock }, now);
}
