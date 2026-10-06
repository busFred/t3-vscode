/**
 * Opened folders scope project/thread navigation and supply the default cwd.
 * An empty VS Code window can browse all projects on the connected server.
 */

import * as vscode from "vscode";

export interface WorkspaceContext {
  readonly root: string | null;
  readonly roots: ReadonlyArray<string>;
}

export const getWorkspaceContext = (): WorkspaceContext => {
  const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  return { root: roots[0] ?? null, roots };
};
