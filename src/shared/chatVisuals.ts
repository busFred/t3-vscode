import type { WireTurnItem } from "./bridge.js";

export interface HtmlVisual {
  readonly attachmentId: string;
  readonly title: string;
  readonly height: number;
  readonly heights?: ReadonlyArray<readonly [number, number]>;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const clampHeight = (height: number) => Math.min(2000, Math.max(80, Math.round(height)));

/** T3 MCP results can be JSON strings, content blocks or structuredContent.
 * Walk only these envelopes, with the same bounded decoding used by T3. */
export function toolResultData(output: unknown): Record<string, unknown> | null {
  let bytes = 16_384; let nodes = 128; let failed = false;
  function read(value: unknown, depth: number): Record<string, unknown> | null {
    if (depth > 4 || --nodes < 0) return null;
    if (typeof value === "string") {
      bytes -= value.length;
      if (bytes < 0) return null;
      try { return read(JSON.parse(value), depth + 1); } catch { return null; }
    }
    if (Array.isArray(value)) {
      if (value.length > 32) return null;
      let result: Record<string, unknown> | null = null;
      for (const block of value) { const candidate = read(record(block) ? block.text ?? block : block, depth + 1); result ??= candidate; }
      return result;
    }
    if (!record(value)) return null;
    if (value.isError === true || value.is_error === true || value.error != null || value._tag === "OrchestratorMcpFailure") failed = true;
    return value.structuredContent !== undefined || value.content !== undefined
      ? read(value.structuredContent ?? value.content, depth + 1) : value;
  }
  const data = read(output, 0);
  return failed ? null : data;
}

/** The installed T3 0.0.46 html_render format, including responsive heights. */
export function htmlVisual(item: WireTurnItem): HtmlVisual | null {
  if (item.type !== "dynamic_tool" || item.status !== "completed" || !/(?:^|[._])html_render$/.test(item.toolName ?? "")) return null;
  const value = toolResultData(item.output)?.htmlRender;
  if (!record(value) || typeof value.attachmentId !== "string" || !value.attachmentId || value.attachmentId.length > 256
    || typeof value.title !== "string" || typeof value.height !== "number" || !Number.isFinite(value.height)) return null;
  const heights = Array.isArray(value.heights) && value.heights.length > 0 && value.heights.length <= 24
    && value.heights.every((entry) => Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[0]) && entry[0] > 0 && entry[0] <= 10_000 && typeof entry[1] === "number" && Number.isFinite(entry[1]))
    ? (value.heights as Array<[number, number]>).map(([width, height]) => [width, clampHeight(height)] as const).sort((a, b) => a[0] - b[0]) : undefined;
  return { attachmentId: value.attachmentId, title: value.title.trim().slice(0, 200) || "HTML", height: clampHeight(value.height), ...(heights ? { heights } : {}) };
}
export function htmlVisualHeight(visual: HtmlVisual, width: number): number {
  const sizes = visual.heights;
  if (!sizes?.length) return visual.height;
  const found = sizes.findIndex(([candidate]) => candidate >= width);
  const upper = found < 0 ? sizes.length - 1 : found;
  const lower = sizes[upper]![0] === width ? upper : Math.max(0, upper - 1);
  return Math.min(visual.height, Math.max(sizes[lower]![1], sizes[upper]![1]));
}
export interface ChatAssetSource { readonly sourceThreadId: string; readonly itemId: string }
export interface ChatAsset { readonly url: string; readonly expiresAt: number }
export type ChatAssetReference = { readonly kind: "html" } | { readonly kind: "attachment"; readonly attachmentId: string } | { readonly kind: "media"; readonly path: string };
