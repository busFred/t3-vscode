import { formatDuration } from "@t3tools/shared/usageLimitsCopy";

/**
 * `3d 20h`: the meter's value line carries its reset as a suffix, where the sentence
 * "resets in 3d 20h" once cost a third line per meter. The words stay in the hover title.
 */
export function meterResetLabel(resetsAt: string | null | undefined, now: number): string {
  const at = resetsAt ? Date.parse(resetsAt) : NaN;
  if (!Number.isFinite(at)) return "";
  return at <= now ? "now" : formatDuration(at - now);
}
