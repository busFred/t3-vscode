import type { TranscriptItem } from "./bridge.js";

export type MessageNavigationPlacement = "left" | "right" | "off";
export function resolveMessageNavigation(value: unknown): MessageNavigationPlacement {
  return value === "right" || value === "off" ? value : "left";
}
export interface MessageExchange {
  readonly key: string;
  readonly rowIndex: number;
  readonly prompt: string;
  response: string | null;
}

/** One stop per prompt, paired with the last response before the next prompt.
 * Derived from T3's timelineMinimapItems, adapted to the extension's typed rows.
 * Keep source text untouched; only the hovered preview needs compacting. */
export function messageExchanges(rows: ReadonlyArray<TranscriptItem>): MessageExchange[] {
  const exchanges: MessageExchange[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (row.item.type === "user_message") exchanges.push({ key: row.key, rowIndex,
      prompt: row.item.text.trim() ? row.item.text : row.item.attachments.map((attachment) => attachment.name).join(", ") || "Attached message", response: null });
    else if (row.item.type === "assistant_message" && exchanges.length) exchanges[exchanges.length - 1]!.response = row.item.text;
  }
  return exchanges;
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
