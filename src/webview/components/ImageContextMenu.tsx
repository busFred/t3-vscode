import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActions } from "../actions";
import { copyImage, imagePngBlob } from "../imageClipboard";

interface Target { readonly src: string; readonly name: string; readonly path?: string | undefined; readonly x: number; readonly y: number }

/** The PNG the webview can read from a displayed image, as base64 for the host. */
async function pngBase64(src: string): Promise<string> {
  const bytes = new Uint8Array(await (await imagePngBlob(src)).arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Right-click on a transcript image (a preview or a mid-run image chip). Webviews have no native
 * image menu, so without this a right-click offers nothing that acts on the image itself. It listens
 * on the window's capture phase so it runs before the selection menu, which claims right-clicks on
 * the document and would otherwise show its text actions over an image.
 */
export function ImageContextMenu() {
  const run = useActions(); const menu = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const show = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("img.chat-media, [data-image-src]") : null;
      if (!element || element.closest("input,textarea,[contenteditable=true]")) return;
      const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : element.dataset.imageSrc;
      if (!src) return;
      event.preventDefault(); event.stopPropagation();
      setError(null);
      setTarget({ src, name: element.dataset.imageName || (element instanceof HTMLImageElement ? element.alt : "") || "image", path: element.dataset.imagePath || undefined,
        x: Math.min(event.clientX, Math.max(5, innerWidth - 235)), y: Math.min(event.clientY, Math.max(5, innerHeight - 140)) });
    };
    window.addEventListener("contextmenu", show, true); return () => window.removeEventListener("contextmenu", show, true);
  }, []);
  useEffect(() => {
    if (!target) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setTarget(null); };
    const blur = () => setTarget(null);
    document.addEventListener("pointerdown", close); window.addEventListener("blur", blur); window.addEventListener("resize", blur);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("blur", blur); window.removeEventListener("resize", blur); };
  }, [target]);
  if (!target) return null;
  // A failure stays in the menu so the user sees why nothing happened instead of a silent no-op.
  const attempt = (action: () => Promise<unknown>) => { void action().then(() => setTarget(null), (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); };
  const choices: ReadonlyArray<{ label: string; act: () => Promise<unknown> }> = [
    { label: "Copy image", act: () => copyImage(target.src) },
    { label: "Save image as…", act: async () => run("saveImage", { name: target.name, data: await pngBase64(target.src) }) },
    { label: "Open in editor", act: async () => run("openImage", target.path ? { path: target.path } : { name: target.name, data: await pngBase64(target.src) }) },
    ...(target.path ? [{ label: "Copy path", act: () => run("copyText", { text: target.path! }) }] : []),
  ];
  return createPortal(<div ref={menu} className="math-context-menu image-context-menu" role="menu" aria-label="Image" style={{ left: target.x, top: target.y }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); setTarget(null); return; }
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>{choices.map((choice) => <button key={choice.label} role="menuitem" onClick={() => attempt(choice.act)}>{choice.label}</button>)}{error ? <p className="subtle" role="alert">{error}</p> : null}</div>, document.body);
}
