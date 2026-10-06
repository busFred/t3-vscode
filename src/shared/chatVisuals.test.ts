import test from "node:test";
import assert from "node:assert/strict";
import { htmlVisual, htmlVisualHeight, toolResultData } from "./chatVisuals.js";
import { transcriptRows } from "./transcriptRows.js";
import type { WireTurnItem } from "./bridge.js";
const metadata = { attachmentId: "page-html", title: "Layout options", height: 800, heights: [[360, 1100], [728, 500]] };
const item = (output: unknown): WireTurnItem => ({ type: "dynamic_tool", status: "completed", toolName: "mcp__t3_code__html_render", output } as WireTurnItem);
test("HTML visuals survive direct, MCP structured, native content-block and JSON envelopes", () => {
  for (const output of [{ htmlRender: metadata }, { structuredContent: { htmlRender: metadata } }, { content: [{ type: "text", text: JSON.stringify({ htmlRender: metadata }) }] }, JSON.stringify({ htmlRender: metadata })]) {
    const visual = htmlVisual(item(output))!;
    assert.equal(visual.title, "Layout options"); assert.equal(htmlVisualHeight(visual, 360), 800); assert.equal(htmlVisualHeight(visual, 728), 500);
    assert.equal(htmlVisualHeight(visual, 500), 800, "Between sampled widths use the taller layout, capped by the requested height");
  }
});
test("Failed, malformed or oversized tool envelopes cannot become executable HTML frames", () => {
  assert.equal(htmlVisual(item({ isError: true, structuredContent: { htmlRender: metadata } })), null);
  assert.equal(toolResultData({ content: [{ text: JSON.stringify({ htmlRender: metadata }) }, { isError: true }] }), null);
  assert.equal(htmlVisual(item({ htmlRender: { ...metadata, height: "Infinity" } })), null);
  assert.equal(htmlVisual(item({ htmlRender: { ...metadata, attachmentId: "x".repeat(257) } })), null);
  assert.equal(htmlVisual(item(JSON.stringify({ htmlRender: metadata, extra: "x".repeat(20_000) }))), null);
  const visualRow = { key: "visual", sourceThreadId: "thread", toolLabel: null, output: null, needsDetail: false, item: item({ htmlRender: metadata }) };
  assert.equal(transcriptRows([visualRow])[0]!.rows.length, 1);
});
