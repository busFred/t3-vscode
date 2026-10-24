import type { ComposerClipboard } from "../shared/composerClipboard";

const blobOf = (dataUrl: string): Blob => {
  // `connect-src` forbids fetching a data: URL, so it is decoded by hand.
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(dataUrl)?.[1] ?? "image/png" });
};
/** Chromium puts only PNG bitmaps on the clipboard. */
async function pngBlob(dataUrl: string): Promise<Blob> {
  const blob = blobOf(dataUrl); if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((png) => png ? resolve(png) : reject(new Error("Could not encode the image.")), "image/png"));
}
/**
 * The string formats go out synchronously with the event, which is the part that always works. A bitmap can only be written
 * through the async API, which then replaces them with the same text and HTML plus the PNG; if VS Code or the OS refuses,
 * the synchronous formats simply remain.
 */
export function writeComposerClipboard(event: ClipboardEvent, clip: ComposerClipboard): boolean {
  if (!event.clipboardData) return false;
  event.preventDefault();
  event.clipboardData.setData("text/plain", clip.plain); event.clipboardData.setData("text/html", clip.html);
  if (clip.image) void pngBlob(clip.image.dataUrl).then((png) => navigator.clipboard.write([new ClipboardItem({
    "text/plain": new Blob([clip.plain], { type: "text/plain" }), "text/html": new Blob([clip.html], { type: "text/html" }), "image/png": png,
  })])).catch(() => undefined);
  return true;
}
