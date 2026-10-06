import type * as vscode from "vscode";
import { basename, relative } from "node:path";
import type { FileReference } from "../shared/composerContext.js";

/** Capture before changing focus; getText(selection) includes unsaved edits and partial lines. */
export function editorReference(editor: Pick<vscode.TextEditor, "document" | "selection">, workspaceRoot?: string): FileReference {
  const { document, selection } = editor;
  if (document.uri.scheme !== "file") throw new Error("Select text in a file to reference it in T3 Code.");
  const path = document.uri.fsPath;
  return { type: "file", uri: document.uri.toString(), path,
    label: workspaceRoot ? relative(workspaceRoot, path).replaceAll("\\", "/") : basename(path),
    range: { start: { line: selection.start.line + 1, column: selection.start.character + 1 },
      end: { line: selection.end.line + 1, column: selection.end.character + 1 } },
    text: selection.isEmpty ? "" : document.getText(selection) };
}
