/** `absolute` formats ages beyond 14 days with the user's Date Format and Time Format settings. */
export function sessionActivityLabel(stamp: string | null | undefined, now: number, absolute: (date: Date) => string): string {
  const time = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(time)) return "";
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return "<1 min";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr`;
  if (elapsed <= 14 * 86_400_000) { const days = Math.floor(elapsed / 86_400_000); return `${days} ${days === 1 ? "day" : "days"}`; }
  return absolute(new Date(time));
}
