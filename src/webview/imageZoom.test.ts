import test from "node:test";
import assert from "node:assert/strict";
import { FIT, MAX_ZOOM, canPan, clampPan, fitScale, formatZoom, wheelFactor, zoomBy, zoomKey, zoomTo } from "./imageZoom.js";
import { canvasSize, pngDataUrlBlob } from "./imageClipboard.js";

const view = { width: 800, height: 600 }; const image = { width: 1600, height: 1200 }; const origin = { x: 0, y: 0 };
const key = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });

test("fit scales large images down to the viewport and never enlarges small ones", () => {
  assert.equal(fitScale(view, image), 0.5);
  assert.equal(fitScale(view, { width: 100, height: 50 }), 1);
  assert.equal(fitScale({ width: 0, height: 0 }, image), 1);
  assert.equal(formatZoom(0.5), "50%"); assert.equal(formatZoom(1.234), "123%");
});

test("zoom steps from fit, snaps back to fit, and respects the maximum", () => {
  const zoomed = zoomBy(FIT, 2, origin, view, image);
  assert.equal(zoomed.zoom, 1);
  assert.deepEqual(zoomBy(zoomed, 0.5, origin, view, image), FIT);
  assert.deepEqual(zoomBy(FIT, 0.5, origin, view, image), FIT);
  assert.equal(zoomTo(FIT, 1000, origin, view, image).zoom, MAX_ZOOM);
});

test("zooming around the cursor keeps the point under it still", () => {
  const anchor = { x: 200, y: -100 };
  const next = zoomBy(FIT, 4, anchor, view, image);
  assert.equal(next.zoom, 2);
  // Image point under the cursor before: (anchor - 0) / 0.5; after: (anchor - pan) / 2.
  assert.ok(Math.abs((anchor.x - next.pan.x) / 2 - anchor.x / 0.5) < 1e-9);
  assert.ok(Math.abs((anchor.y - next.pan.y) / 2 - anchor.y / 0.5) < 1e-9);
});

test("pan stays within the image edges and centred while the image fits", () => {
  assert.deepEqual(clampPan({ x: 999, y: -999 }, 1, view, image), { x: 400, y: -300 });
  assert.deepEqual(clampPan({ x: 50, y: 50 }, 0.25, view, image), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 20, y: 0 }, 0.5, view, image), { x: 0, y: 0 });
  assert.equal(canPan(0.5, 0.5), false); assert.equal(canPan(0.75, 0.5), true);
});

test("wheel deltas map to symmetric zoom factors", () => {
  assert.ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1);
  assert.ok(Math.abs(wheelFactor(-100) * wheelFactor(100) - 1) < 1e-12);
  assert.ok(wheelFactor(-3, 1) > wheelFactor(-3, 0));
});

test("keys map to zoom actions and leave editor and browser shortcuts alone", () => {
  assert.equal(zoomKey(key("+", { shiftKey: true })), "in"); assert.equal(zoomKey(key("=")), "in");
  assert.equal(zoomKey(key("-")), "out"); assert.equal(zoomKey(key("0")), "reset");
  assert.equal(zoomKey(key("c", { ctrlKey: true })), "copy"); assert.equal(zoomKey(key("C", { metaKey: true })), "copy");
  assert.equal(zoomKey(key("c")), null); assert.equal(zoomKey(key("0", { ctrlKey: true })), null);
  assert.equal(zoomKey(key("c", { ctrlKey: true, shiftKey: true })), null); assert.equal(zoomKey(key("-", { altKey: true })), null);
});

test("PNG data URLs pass through as PNG bytes and other sources fall to the canvas", async () => {
  const blob = pngDataUrlBlob("data:image/png;base64,iVBORw0KGgo=");
  assert.equal(blob?.type, "image/png");
  assert.deepEqual([...new Uint8Array(await blob!.arrayBuffer())].slice(0, 4), [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(pngDataUrlBlob("data:image/jpeg;base64,/9j/"), null); assert.equal(pngDataUrlBlob("https://x/y.png"), null);
});

test("canvas size caps huge rasters and enlarges small vector images", () => {
  assert.deepEqual(canvasSize(800, 400, false), { width: 800, height: 400 });
  assert.deepEqual(canvasSize(8192, 4096, false), { width: 4096, height: 2048 });
  assert.deepEqual(canvasSize(100, 50, true), { width: 1600, height: 800 });
  assert.deepEqual(canvasSize(0, 0, false), { width: 1, height: 1 });
});
