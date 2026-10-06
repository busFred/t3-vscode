import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { ReviewDiffFileContentsResult } from "@t3tools/contracts";
import type { TurnDiff, TurnDiffFile } from "./turnDiff.js";

/** Readonly virtual files keep turn diffs independent of HEAD and later disk edits. */
export function registerNativeDiff(context: vscode.ExtensionContext) {
  const contents = new Map<string, string>();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("t3-turn-diff", {
    provideTextDocumentContent(uri) {
      const text = contents.get(uri.toString());
      if (text === undefined) throw new Error("This saved diff is no longer available. Open it again from the conversation.");
      return text;
    },
  }), vscode.workspace.onDidCloseTextDocument((document) => { if (document.uri.scheme === "t3-turn-diff") contents.delete(document.uri.toString()); }));
  return async (diff: TurnDiff, load: (file: TurnDiffFile) => Promise<ReviewDiffFileContentsResult>, path?: string) => {
    const file = path === undefined
      ? diff.files.length === 1 ? diff.files[0] : (await vscode.window.showQuickPick(diff.files.map((file) => ({ label: file.newPath, description: file.oldPath !== file.newPath ? `Renamed from ${file.oldPath}` : file.changeType, file })), { title: `Turn ${diff.turnNumber} changes`, matchOnDescription: true }))?.file
      : diff.files.find((file) => file.newPath === path || file.oldPath === path);
    if (!file) { if (path !== undefined) throw new Error("This file is not in the selected turn's diff."); return; }
    const result = await load(file);
    const key = randomUUID();
    const before = vscode.Uri.from({ scheme: "t3-turn-diff", path: `/${key}/before/${file.oldPath}` });
    const after = vscode.Uri.from({ scheme: "t3-turn-diff", path: `/${key}/after/${file.newPath}` });
    contents.set(before.toString(), result.oldContents); contents.set(after.toString(), result.newContents);
    try { await vscode.commands.executeCommand("vscode.diff", before, after, `${file.newPath} · Turn ${diff.turnNumber}`, { preview: true }); }
    catch (cause) { contents.delete(before.toString()); contents.delete(after.toString()); throw cause; }
  };
}
