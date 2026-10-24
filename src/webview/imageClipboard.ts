const SVG = /^data:image\/svg|\.svg(?:[?#]|$)/i;
const MAX_EDGE = 4096;

/** A base64 `data:image/png` is already the clipboard format, so its bytes pass through untouched. */
export function pngDataUrlBlob(src: string): Blob | null {
  const match = /^data:image\/png;base64,([a-z0-9+/=\s]*)$/i.exec(src);
  if (!match) return null;
  const binary = atob(match[1]!.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/png" });
}
/** Edge-capped canvas size; vector sources have no pixels of their own, so they are rendered at least 1600px on the long edge. */
export function canvasSize(width: number, height: number, vector: boolean): { width: number; height: number } {
  const long = Math.max(width, height) || 1;
  const scale = Math.min(MAX_EDGE / long, vector ? Math.max(1, 1600 / long) : 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // The T3 asset server answers CORS with `*`; without this the canvas below would be tainted and unreadable.
    if (/^https?:/i.test(src)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be read for copying."));
    image.src = src;
  });
}
/** Reads any displayable image as PNG. The webview CSP has no `connect-src` for data:/http:, so bytes come from a canvas, not fetch. */
export async function imagePngBlob(src: string): Promise<Blob> {
  const direct = pngDataUrlBlob(src);
  if (direct) return direct;
  const image = await loadImage(src);
  const size = canvasSize(image.naturalWidth || 1024, image.naturalHeight || 1024, SVG.test(src));
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The image could not be converted to PNG.")), "image/png"); }
    catch { reject(new Error("The image's host does not allow copying it.")); }
  });
}
/** The promise goes straight into ClipboardItem so the user gesture is still valid while the image decodes. */
export async function copyImage(src: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image copy is not supported here.");
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": imagePngBlob(src) })]); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") throw new Error("Clipboard access was denied.");
    throw cause;
  }
}
