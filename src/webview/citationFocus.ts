/** A citation jump moves focus to the cited response, unless the user is typing in an input. */
export function shouldFocusCitedSource(active: Element | null): boolean {
  const element = active as (Element & { isContentEditable?: boolean }) | null;
  if (!element || typeof element.matches !== "function") return true;
  return !(element.isContentEditable || element.matches("input, textarea, select"));
}
