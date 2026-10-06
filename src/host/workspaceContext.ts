/**
 * Workspace context (architecture doc §2): the opened folder is only used for
 * "open file at path" resolution and as the default cwd for new threads. No
 * workspace filtering — all threads/projects on the environment are shown.
 */

import * as vscode from "vscode";

export interface WorkspaceContext {
  readonly root: string | null;
}

export const getWorkspaceContext = (): WorkspaceContext => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return { root: folder ? folder.uri.fsPath : null };
};
