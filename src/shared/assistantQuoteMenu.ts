import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";

/** One name for the action, shared by the floating button and the context menu so the two entry points cannot drift. */
export const QUOTE_ACTION_LABEL = "Quote";
export const QUOTE_COMMENT_ACTION_LABEL = "Quote with comment";
export const QUOTE_TOO_LONG_LABEL = "Shorten selection";
export type AssistantQuoteMenuAction = "copy" | "markdown" | "quote" | "comment";
export interface AssistantQuoteMenuItem {
  readonly action: AssistantQuoteMenuAction;
  readonly label: string;
  readonly disabled: boolean;
  /** A separator precedes this item: copying is the platform's action, quoting is ours. */
  readonly separated: boolean;
}

/**
 * Copy leads because suppressing the native menu takes the platform's own copy with it, and both quote
 * items share the floating button's length limit rather than failing at the contract.
 */
export function assistantQuoteMenuItems(textLength: number): ReadonlyArray<AssistantQuoteMenuItem> {
  const disabled = textLength > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  return [
    { action: "copy", label: "Copy as plain text", disabled: false, separated: false },
    { action: "markdown", label: "Copy as Markdown", disabled: false, separated: false },
    { action: "quote", label: QUOTE_ACTION_LABEL, disabled, separated: true },
    { action: "comment", label: QUOTE_COMMENT_ACTION_LABEL, disabled, separated: false },
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
