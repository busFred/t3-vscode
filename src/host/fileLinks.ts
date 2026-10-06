/** Resolve chat file links once in the host; locations stay one-based until VS Code opens them. */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMarkdownLinkDestination, safeDecodeURIComponent, splitFilePathPosition, splitMarkdownLinkSearchAndHash } from "@t3tools/client-runtime/markdown-links";

export interface ChatFileLink {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

export function resolveChatFileLink(href: string, cwd: string | null): ChatFileLink {
  const normalized = normalizeMarkdownLinkDestination(href);
  const source = splitMarkdownLinkSearchAndHash(normalized);
  const path = /^file:/i.test(source.path) ? fileURLToPath(source.path) : safeDecodeURIComponent(source.path);
  const hash = safeDecodeURIComponent(source.hash);
  const position = splitFilePathPosition(path, hash);
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
