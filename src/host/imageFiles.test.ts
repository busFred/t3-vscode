import test from "node:test";
import assert from "node:assert/strict";
import { imageFileName, parseImageBytes } from "./imageFiles.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString("base64");

test("Saved and opened images must be bounded PNG bytes", () => {
  assert.deepEqual([...parseImageBytes(png).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.throws(() => parseImageBytes(Buffer.from("<svg/>").toString("base64")), /Invalid image data/);
  assert.throws(() => parseImageBytes("not base64!"), /Invalid image data/);
  assert.throws(() => parseImageBytes(42), /Invalid image data/);
});

test("An image file name comes from its label without escaping the folder", () => {
  assert.equal(imageFileName("screenshot.jpg"), "screenshot.png");
  assert.equal(imageFileName("../../etc/passwd"), "etc-passwd.png");
  assert.equal(imageFileName(".."), "image.png");
  assert.equal(imageFileName(undefined), "image.png");
  assert.equal(imageFileName("a\\b:c"), "a-b-c.png");
});
