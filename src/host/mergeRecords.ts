/** Records of worktree merges applied to a checkout, attached to the turn they landed in. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface MergeRecordFile { readonly path: string; readonly additions: number; readonly deletions: number; readonly binary?: boolean }
export interface MergeRecord {
  readonly destinationThreadId: string;
  readonly sourceThreadId: string;
  readonly sourceTitle: string;
  readonly sourceBranch: string;
  readonly destinationBranch: string;
  readonly cwd: string;
  readonly appliedAt: string;
  readonly files: ReadonlyArray<MergeRecordFile>;
  readonly patchFile: string;
}
export interface CheckoutThreadLookup { readonly id: string; readonly projectId: string; readonly worktreePath?: string | null; readonly activeRunId?: string | null; readonly title: string }
/** Prefer the thread currently running at this checkout; otherwise the first bound thread. */
export function resolveThreadForCheckout(threads: ReadonlyArray<CheckoutThreadLookup>, projectId: string, workspaceRoot: string, checkoutPath: string): CheckoutThreadLookup | null {
  const matches = threads.filter((thread) => thread.projectId === projectId && (thread.worktreePath ?? workspaceRoot) === checkoutPath);
  return matches.find((thread) => thread.activeRunId) ?? matches[0] ?? null;
}
export interface TurnAnchor { readonly id: string; readonly capturedAtMs: number }
/**
 * A merge lands on the latest turn whose checkpoint precedes it; a turn that is
 * still running is treated as the newest anchor, since it has no checkpoint yet.
 */
export function attachMergesToTurns(merges: ReadonlyArray<MergeRecord>, turns: ReadonlyArray<TurnAnchor>, runningTurnId: string | null = null): ReadonlyMap<string, MergeRecord[]> {
  const sorted = [...turns].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  const result = new Map<string, MergeRecord[]>();
  for (const merge of merges) {
    const appliedMs = Date.parse(merge.appliedAt);
    let latest: string | null = null;
    for (const turn of sorted) { if (turn.capturedAtMs <= appliedMs) latest = turn.id; else break; }
    const target = runningTurnId ?? latest;
    if (!target) continue;
    const list = result.get(target);
    if (list) list.push(merge); else result.set(target, [merge]);
  }
  return result;
}
/** Parse `git apply --numstat -z` output; binary files report `-` for both counts. */
export function parsePatchNumstat(numstat: string): Array<{ path: string; additions: number; deletions: number; binary: boolean }> {
  return numstat.split("\0").filter(Boolean).map((record) => {
    const first = record.indexOf("\t"), second = record.indexOf("\t", first + 1);
    const additionsField = record.slice(0, first), deletionsField = record.slice(first + 1, second);
    return { path: record.slice(second + 1), additions: Number(additionsField) || 0, deletions: Number(deletionsField) || 0, binary: additionsField === "-" || deletionsField === "-" };
  });
}
/** Best-effort isolation of one file's section from a multi-file unified patch, for the read-only fallback view. */
export function extractFilePatch(patchText: string, path: string): string | null {
  const lines = patchText.split("\n");
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) if (lines[index]!.startsWith("diff --git ")) starts.push(index);
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]!, end = starts[index + 1] ?? lines.length;
    if (lines[start] === `diff --git a/${path} b/${path}`) return lines.slice(start, end).join("\n");
  }
  return null;
}
function sanitizeStamp(appliedAt: string): string { return appliedAt.replace(/[^0-9A-Za-z-]/g, "-"); }
export class MergeRecordStore {
  private readonly root: string | undefined;
  private readonly memory = new Map<string, MergeRecord[]>();
  private readonly memoryPatches = new Map<string, string>();
  constructor(storageRoot?: string) { this.root = storageRoot ? join(storageRoot, "merges") : undefined; }
  private threadDir(threadId: string): string { return join(this.root!, createHash("sha256").update(threadId).digest("hex").slice(0, 24)); }
  private indexPath(threadId: string): string { return join(this.threadDir(threadId), "records.json"); }
  async forThread(threadId: string): Promise<MergeRecord[]> {
    if (!this.root) return this.memory.get(threadId) ?? [];
    try {
      const raw: unknown = JSON.parse(await readFile(this.indexPath(threadId), "utf8"));
      return Array.isArray(raw) ? raw as MergeRecord[] : [];
    } catch { return []; }
  }
  async record(entry: Omit<MergeRecord, "patchFile">, patchText: string): Promise<MergeRecord> {
    const existing = await this.forThread(entry.destinationThreadId);
    const stamp = `${sanitizeStamp(entry.appliedAt)}-${createHash("sha256").update(patchText).digest("hex").slice(0, 8)}`;
    if (!this.root) {
      const patchFile = `memory:${entry.destinationThreadId}:${stamp}`;
      const record: MergeRecord = { ...entry, patchFile };
      this.memory.set(entry.destinationThreadId, [...existing, record]);
      this.memoryPatches.set(patchFile, patchText);
      return record;
    }
    const dir = this.threadDir(entry.destinationThreadId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const patchFile = join(dir, `${stamp}.patch`);
    await writeFile(patchFile, patchText, { mode: 0o600 });
    const record: MergeRecord = { ...entry, patchFile };
    await writeFile(this.indexPath(entry.destinationThreadId), JSON.stringify([...existing, record]), { mode: 0o600 });
    return record;
  }
  async readPatch(record: MergeRecord): Promise<string> {
    if (record.patchFile.startsWith("memory:")) {
      const patch = this.memoryPatches.get(record.patchFile);
      if (patch === undefined) throw new Error("This merge patch is no longer available.");
      return patch;
    }
    return readFile(record.patchFile, "utf8");
  }
}
