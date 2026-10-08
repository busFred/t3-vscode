export function sessionActivityLabel(stamp: string | null | undefined, now: number): string {
  const time = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(time)) return "";
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return "<1 min";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr`;
  if (elapsed <= 7 * 86_400_000) { const days = Math.floor(elapsed / 86_400_000); return `${days} ${days === 1 ? "day" : "days"}`; }
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric",
    ...(new Date(time).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}
