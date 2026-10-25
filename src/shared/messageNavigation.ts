import { stripRenderedAssistantQuotes } from "./assistantQuoteText.js";
import { splitMessageReferences } from "./messageReferences.js";
import type { TranscriptItem } from "./bridge.js";

export type MessageNavigationPlacement = "left" | "right" | "off";
export function resolveMessageNavigation(value: unknown): MessageNavigationPlacement {
  return value === "right" || value === "off" ? value : "left";
}
export interface MessageExchange {
  readonly key: string;
  readonly rowIndex: number;
  readonly prompt: string;
  /** When the prompt was sent, shown in the hover preview. */
  readonly sentAt: string | null;
  response: string | null;
}

/** One stop per prompt, paired with the last response before the next prompt.
 * Derived from T3's timelineMinimapItems, adapted to the extension's typed rows.
 * Keep source text untouched; only the hovered preview needs compacting. */
export function messageExchanges(rows: ReadonlyArray<TranscriptItem>): MessageExchange[] {
  const exchanges: MessageExchange[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (row.item.type === "user_message") {
      // Preview what the transcript shows, not the wire text: attached snapshots and readable quote
      // blocks are most of a referencing message and would crowd out the words the user typed.
      const prompt = stripRenderedAssistantQuotes(splitMessageReferences(row.item.text).text);
      exchanges.push({ key: row.key, rowIndex,
        prompt: prompt.trim() ? prompt : row.item.attachments.map((attachment) => attachment.name).join(", ") || "Attached message", sentAt: row.item.startedAt ?? null, response: null });
    }
    else if (row.item.type === "assistant_message" && exchanges.length) exchanges[exchanges.length - 1]!.response = row.item.text;
  }
  return exchanges;
}

/** Calendar days, not 24-hour spans: Today and Yesterday, then "N days ago" for a week; from the 8th day the full date. */
export function exchangeTimeLabel(stamp: string | null, now: number, date: (value: Date) => string, time: (value: Date) => string): string {
  const sent = stamp ? new Date(stamp) : null;
  if (!sent || !Number.isFinite(sent.getTime())) return "";
  const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  // Rounding absorbs the hour a daylight-saving change adds to or removes from the span.
  const days = Math.round((midnight(new Date(now)) - midnight(sent)) / 86_400_000);
  const day = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? `${days} days ago` : date(sent);
  return `${day} ${time(sent)}`;
}

/** Tool rows and assistant messages belong to their preceding prompt. */
export function exchangeAtRow(exchanges: ReadonlyArray<MessageExchange>, rowIndex: number): number {
  let lo = 0; let hi = exchanges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (exchanges[mid]!.rowIndex <= rowIndex) lo = mid + 1; else hi = mid - 1;
  }
  return Math.max(0, hi);
}
export function exchangeAtPointer(count: number, top: number, height: number, pointerY: number): number {
  if (count <= 1 || height <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(((pointerY - top) / height) * (count - 1))));
}
