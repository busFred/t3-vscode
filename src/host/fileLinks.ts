/** Resolve chat file links once in the host; locations stay one-based until VS Code opens them. */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMarkdownLinkDestination, safeDecodeURIComponent, splitMarkdownLinkSearchAndHash } from "@t3tools/shared/markdownLinks";
import { splitFilePathPosition } from "@t3tools/shared/fileLinks";

export interface ChatFileLink {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

/** `~/x` and `~\x` are in the home folder, not under the thread folder (T3 0.1.11). A null home (a thread on another machine) leaves them alone: this machine's home is the wrong one. */
function expandHome(path: string, home: string | null): string {
  return home !== null && (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) ? join(home, path.slice(2)) : path;
}

export function resolveChatFileLink(href: string, cwd: string | null, home: string | null = homedir()): ChatFileLink {
  const normalized = normalizeMarkdownLinkDestination(href);
  const source = splitMarkdownLinkSearchAndHash(normalized);
  const path = /^file:/i.test(source.path) ? fileURLToPath(source.path) : safeDecodeURIComponent(source.path);
  const hash = safeDecodeURIComponent(source.hash);
  const split = splitFilePathPosition(path, hash);
  const position = { ...split, path: expandHome(split.path, home) };
  if (!position.path || (/^[a-z][a-z\d+.-]*:/i.test(position.path) && !isAbsolute(position.path))) throw new Error("Unsupported link type.");
  if (!isAbsolute(position.path) && !cwd) throw new Error("This thread has no workspace for relative file links.");
  const range = /^#L(\d+)(?:C(\d+))?-L(\d+)(?:C(\d+))?$/i.exec(hash);
  if (range) {
    const line = Number(range[1]); const column = Number(range[2] ?? 1);
    const endLine = Number(range[3]); const endColumn = range[4] ? Number(range[4]) : undefined;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || line < 1 || column < 1 || endLine < line || (endLine === line && endColumn !== undefined && endColumn < column) || endColumn === 0) throw new Error("Invalid file range.");
    return { path: isAbsolute(position.path) ? position.path : resolve(cwd!, position.path), line, column, endLine, ...(endColumn === undefined ? {} : { endColumn }) };
  }
  return { ...position, path: isAbsolute(position.path) ? position.path : resolve(cwd!, position.path) };
}
