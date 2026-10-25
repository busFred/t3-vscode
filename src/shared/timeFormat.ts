export type TimeFormat = "automatic" | "12-hour" | "24-hour";
export function resolveTimeFormat(value: unknown): TimeFormat {
  return value === "12-hour" || value === "24-hour" ? value : "automatic";
}
/** Automatic preserves the runtime locale; explicit choices also control midnight (00, not 24). */
export function timeFormatOptions(format: TimeFormat): Intl.DateTimeFormatOptions {
  return format === "24-hour" ? { hourCycle: "h23" } : format === "12-hour" ? { hourCycle: "h12" } : {};
}

export const DATE_FORMATS = ["M/d/yyyy", "M/d/yy", "MM/dd/yy", "MM/dd/yyyy", "yy/MM/dd", "yyyy-MM-dd", "dd-MMM-yy", "dd/MM/yyyy", "dd.MM.yyyy", "MMM d, yyyy", "d MMM yyyy"] as const;
export type DateFormat = typeof DATE_FORMATS[number];
export function resolveDateFormat(value: unknown): DateFormat { return DATE_FORMATS.includes(value as DateFormat) ? value as DateFormat : "yyyy-MM-dd"; }
export function formatDate(date: Date, format: DateFormat): string {
  const year = String(date.getFullYear()).padStart(4, "0"), month = String(date.getMonth() + 1), day = String(date.getDate());
  const mm = month.padStart(2, "0"), dd = day.padStart(2, "0"), yy = year.slice(-2);
  // English month names, like the other formats' fixed separators, so a date reads the same in every display language.
  const mmm = date.toLocaleDateString("en-US", { month: "short" });
  switch (format) {
    case "M/d/yyyy": return `${month}/${day}/${year}`;
    case "M/d/yy": return `${month}/${day}/${yy}`;
    case "MM/dd/yy": return `${mm}/${dd}/${yy}`;
    case "MM/dd/yyyy": return `${mm}/${dd}/${year}`;
    case "yy/MM/dd": return `${yy}/${mm}/${dd}`;
    case "dd-MMM-yy": return `${dd}-${mmm}-${yy}`;
    case "dd/MM/yyyy": return `${dd}/${mm}/${year}`;
    case "dd.MM.yyyy": return `${dd}.${mm}.${year}`;
    case "MMM d, yyyy": return `${mmm} ${day}, ${year}`;
    case "d MMM yyyy": return `${day} ${mmm} ${year}`;
    default: return `${year}-${mm}-${dd}`;
  }
}
