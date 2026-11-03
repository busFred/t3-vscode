export const MIN_SECTION_HEIGHT = 60;
/** A user-chosen list height in pixels, or null for the automatic height; kept within [MIN_SECTION_HEIGHT, max]. */
export function clampSectionHeight(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.max(MIN_SECTION_HEIGHT, Math.min(Math.max(MIN_SECTION_HEIGHT, max), value)));
}
