import { fileReferenceLabel, fileReferenceOccurrences, type ComposerContext, type FileReference } from "./composerContext.js";

/** File URIs retain their actual checkout even when the conversation's draft changes checkout. */
function absoluteReferencePath(reference: FileReference): string | null {
  try {
    const uri = new URL(reference.uri);
    if (uri.protocol === "file:") {
      const path = decodeURIComponent(uri.pathname);
      if (uri.hostname && uri.hostname !== "localhost") return `//${uri.hostname}${path}`;
      return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
    }
  } catch { /* Legacy references may contain an absolute path instead of a URI. */ }
  return /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(reference.path) ? reference.path : null;
}
function relativeTo(path: string, root: string): string | null {
  const clean = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const source = clean(path), base = clean(root);
  // Drive-letter paths are case insensitive; POSIX paths are not.
  const windows = /^[a-z]:\//i.test(base) || base.startsWith("//");
  const candidate = windows ? source.toLowerCase() : source;
  const prefix = windows ? base.toLowerCase() : base;
  return candidate.startsWith(`${prefix}/`) ? source.slice(base.length + 1) : null;
}
const token = (label: string) => `@${/[\s"\\]/.test(label) ? JSON.stringify(label) : label}`;

/**
 * Keep external references explicit after a checkout choice changes. A not-yet-created
 * checkout has no root, so every existing file retains its absolute checkout path.
 * Only recognized file tokens are rewritten; URIs, snapshots, quotes, attachments and
 * surrounding prompt text remain intact. `map` preserves the textarea selection.
 */
export function relabelWorktreeReferences(text: string, contexts: ReadonlyArray<ComposerContext>, checkoutRoot: string | null): {
  readonly text: string; readonly contexts: ReadonlyArray<ComposerContext>; readonly map: (position: number) => number;
} | null {
  const labels = new Map<FileReference, string>();
  for (const context of contexts) {
    if (context.type !== "file") continue;
    const absolute = absoluteReferencePath(context);
    if (!absolute) continue;
    labels.set(context, checkoutRoot ? relativeTo(absolute, checkoutRoot) ?? absolute : absolute);
  }
  const replacements = new Map<FileReference, FileReference>();
  for (const [context, label] of labels) {
    if (label === context.label) continue;
    const next = { ...context, label };
    if (context.inlineText) {
      const displayed = fileReferenceLabel(next);
      const collision = [...labels].some(([other, otherLabel]) => other !== context && fileReferenceLabel({ ...other, label: otherLabel }) === displayed && (other.uri !== context.uri || JSON.stringify(other.range) !== JSON.stringify(context.range)));
      const range = context.range;
      next.inlineText = token(collision && range ? `${label}:${range.start.line}:${range.start.column}-${range.end.line}:${range.end.column}` : displayed);
    }
    replacements.set(context, next);
  }
  if (!replacements.size) return null;
  const edits = fileReferenceOccurrences(text, contexts).flatMap((match) => {
    const replacement = replacements.get(match.context)?.inlineText;
    return replacement && replacement !== match.context.inlineText ? [{ start: match.start, end: match.end, source: replacement }] : [];
  });
  let result = "", at = 0;
  for (const edit of edits) { result += text.slice(at, edit.start) + edit.source; at = edit.end; }
  return { text: result + text.slice(at), contexts: contexts.map((context) => context.type === "file" ? replacements.get(context) ?? context : context), map: (position) => {
    let shift = 0;
    for (const edit of edits) {
      if (position >= edit.end) shift += edit.source.length - (edit.end - edit.start);
      else return position > edit.start ? edit.start + shift + edit.source.length : position + shift;
    }
    return position + shift;
  } };
}
