/** Resolve immutable, adjacent-turn snapshots using T3's persisted checkpoint metadata. */
import type { OrchestrationV2ThreadProjection, ReviewDiffFileContentsInput } from "@t3tools/contracts";
import { parsePatchFiles } from "@pierre/diffs";
import { unquoteGitPatchPath } from "@t3tools/shared/gitPatchPath";

export interface TurnDiffFile {
  readonly oldPath: string;
  readonly newPath: string;
  readonly changeType: ReviewDiffFileContentsInput["changeType"];
}
export interface TurnDiff {
  readonly threadId: string;
  readonly title: string;
  readonly turnNumber: number;
  readonly cwd: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly files: ReadonlyArray<TurnDiffFile>;
}
export function turnCheckpointRange(projection: OrchestrationV2ThreadProjection, checkpointId: string): Omit<TurnDiff, "files"> {
  const checkpoint = projection.checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
  const run = projection.runs.find((run) => run.id === checkpoint?.runId);
  if (!checkpoint || checkpoint.status !== "ready" || checkpoint.appRunOrdinal === null || run?.status !== "completed") throw new Error("This turn's checkpoint is not ready for a diff.");
  const scope = projection.checkpointScopes.find((scope) => scope.id === checkpoint.scopeId);
  const root = projection.checkpointScopes.find((scope) => scope.kind === "root_run");
  const previous = checkpoint.appRunOrdinal === 1
    ? projection.checkpoints.find((entry) => entry.scopeId === root?.id && entry.ordinalWithinScope === 0)
    : projection.checkpoints.find((entry) => entry.appRunOrdinal === checkpoint.appRunOrdinal! - 1 && entry.status === "ready");
  if (!scope || !previous || previous.status !== "ready") throw new Error("The previous turn's saved checkpoint is unavailable.");
  return { threadId: projection.thread.id, title: projection.thread.title, turnNumber: checkpoint.appRunOrdinal, cwd: scope.cwd, baseRef: previous.ref, headRef: checkpoint.ref };
}
export function turnDiffFiles(patch: string): TurnDiffFile[] {
  return parsePatchFiles(patch).flatMap((patch) => patch.files).map((file) => ({
    oldPath: unquoteGitPatchPath(file.prevName ?? file.name), newPath: unquoteGitPatchPath(file.name), changeType: file.type,
  }));
}
export function turnDiffFileRequest(diff: TurnDiff, file: TurnDiffFile): ReviewDiffFileContentsInput {
  if (!diff.files.includes(file)) throw new Error("This file is not in the selected turn's diff.");
  return { cwd: diff.cwd, sourceKind: "branch-range", baseRef: diff.baseRef, headRef: diff.headRef, ...file };
}
