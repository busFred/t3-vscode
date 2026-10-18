export type TimeFormat = "automatic" | "12-hour" | "24-hour";
export function resolveTimeFormat(value: unknown): TimeFormat {
  return value === "12-hour" || value === "24-hour" ? value : "automatic";
}
/** Automatic preserves the runtime locale; explicit choices also control midnight (00, not 24). */
export function timeFormatOptions(format: TimeFormat): Intl.DateTimeFormatOptions {
  return format === "24-hour" ? { hourCycle: "h23" } : format === "12-hour" ? { hourCycle: "h12" } : {};
}
