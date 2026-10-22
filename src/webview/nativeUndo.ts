/** Which native history command an undo/redo shortcut asks for, or null for any other key. */
export function historyCommand(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): "undo" | "redo" | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  return key === "y" && !event.shiftKey ? "redo" : null;
}

const textFields = "textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file])";

/**
 * VS Code sends Ctrl/Cmd+Z in a custom-editor tab (every session opened from Sessions) to that editor's own,
 * empty undo history and never back into the webview, so typing there could not be undone. Its forwarding
 * listener sits on the window, so an editable field's shortcut stops at the document and the browser's own
 * default undo or redo runs, the same as in any page; a plain webview panel cannot undo twice either.
 */
export function installNativeUndo(target: Window): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !historyCommand(event)) return;
    if (!(event.target instanceof HTMLElement) || !(event.target.matches(textFields) || event.target.isContentEditable)) return;
    event.stopPropagation();
  };
  target.document.addEventListener("keydown", keydown);
  return () => target.document.removeEventListener("keydown", keydown);
}
