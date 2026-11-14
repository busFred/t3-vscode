/** Largest image the webview may hand the host to save or open; well above any transcript image. */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/** Decodes the base64 PNG the webview sends, refusing anything that is not a bounded PNG. */
export function parseImageBytes(data: unknown): Uint8Array {
  if (typeof data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("Invalid image data.");
  if (data.length * 3 / 4 > MAX_IMAGE_BYTES) throw new Error("The image is too large to save.");
  const bytes = Buffer.from(data, "base64");
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) throw new Error("Invalid image data.");
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/**
 * A safe `.png` file name from the label shown in the transcript. The label is model or tool text,
 * so separators, control characters and leading dots are removed rather than trusted.
 */
export function imageFileName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const stem = raw.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s-]+|[.\s]+$/g, "").slice(0, 80);
  return `${stem || "image"}.png`;
}
