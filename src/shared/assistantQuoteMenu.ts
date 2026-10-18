import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";

/** Quoting opens the optional-comment editor for either message author. */
export const QUOTE_ACTION_LABEL = "Quote";
export const QUOTE_TOO_LONG_LABEL = "Shorten selection";
export type AssistantQuoteMenuAction = "copy" | "markdown" | "quote";
export interface AssistantQuoteMenuItem {
  readonly action: AssistantQuoteMenuAction;
  readonly label: string;
  readonly disabled: boolean;
  /** A separator precedes this item: copying is the platform's action, quoting is ours. */
  readonly separated: boolean;
}

/**
 * Copy leads because suppressing the native menu takes the platform's own copy with it.
 * Oversized selections remain copyable but cannot be quoted.
 */
export function assistantQuoteMenuItems(textLength: number): ReadonlyArray<AssistantQuoteMenuItem> {
  const disabled = textLength > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  return [
    { action: "copy", label: "Copy as plain text", disabled: false, separated: false },
    { action: "markdown", label: "Copy as Markdown", disabled: false, separated: false },
    { action: "quote", label: QUOTE_ACTION_LABEL, disabled, separated: true },
  ];
}

/** Measured after mount: a menu anchored to a virtualized row is positioned against the window, not the clipping scroller. */
export function clampMenuPosition(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  margin = 6,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(margin, Math.min(point.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)),
  };
}
