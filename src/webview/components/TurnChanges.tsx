import { useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, FileDiffIcon, FileIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import type { TranscriptItem, WireTurnItem, TurnDiffSummary } from "../../shared/bridge";
import { bridge } from "../bridge-client";
import { useActions } from "../actions";
import { buildTurnDiffTree, summarizeTurnDiffStats, type TurnDiffTreeNode, type TurnDiffStat } from "./t3/turnDiffTree";

function Counts({ stat }: { readonly stat: TurnDiffStat | null }) {
  return stat ? <span className="change-counts"><span className="addition">+{stat.additions}</span><span className="deletion">−{stat.deletions}</span></span> : null;
}
function ChangeNode({ node, open }: { readonly node: TurnDiffTreeNode; readonly open: (path: string) => void }) {
  return node.kind === "directory" ? <details className="change-directory"><summary><ChevronRightIcon size={12} /><FolderIcon size={14} /><span className="change-name">{node.name}</span><Counts stat={node.stat} /></summary><div>{node.children.map((child) => <ChangeNode key={child.path} node={child} open={open} />)}</div></details>
    : <button className="change-file" aria-label={`Open turn diff: ${node.path}`} title={`Open turn diff: ${node.path}`} onClick={() => open(node.path)}><FileIcon size={14} /><span className="change-name">{node.name}</span><Counts stat={node.stat} /></button>;
}
function MergeGroup({ merge, threadId, itemId }: { readonly merge: NonNullable<TurnDiffSummary["merges"]>[number]; readonly threadId: string; readonly itemId: string }) {
  const run = useActions();
  const tree = useMemo(() => buildTurnDiffTree(merge.files), [merge.files]);
  const total = useMemo(() => summarizeTurnDiffStats(merge.files), [merge.files]);
  const open = (path: string) => { void run("openMergeDiff", { threadId, itemId, appliedAt: merge.appliedAt, path }); };
  return <details className="turn-merge-group">
    <summary><ChevronRightIcon size={12} /><span>Merged from subagent · {merge.sourceTitle}</span>
      <span className="turn-branch-chip" title="Source branch merged into the destination branch."><GitBranchIcon size={11} />{merge.sourceBranch} → {merge.destinationBranch}</span>
      <Counts stat={total} /></summary>
    <div className="change-tree">{tree.map((node) => <ChangeNode key={node.path} node={node} open={open} />)}</div>
    <small className="turn-merge-note">Applied to the working tree, not committed. Counts come from the merge patch.</small>
  </details>;
}
export function TurnChanges({ row, threadId }: { readonly row: TranscriptItem; readonly threadId: string }) {
  const item = row.item as Extract<WireTurnItem, { type: "checkpoint" }>;
  const run = useActions();
  const itemId = row.sourceItemId ?? item.id;
  const key = JSON.stringify([threadId, row.sourceThreadId, itemId, item.checkpointId, item.updatedAt, row.checkpointRunStatus]);
  const [result, setResult] = useState<{ key: string; summary?: TurnDiffSummary }>();
  useEffect(() => {
    if (row.checkpointRunStatus && row.checkpointRunStatus !== "completed") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      void bridge.request<TurnDiffSummary>("turnDiffSummary", { threadId, sourceThreadId: row.sourceThreadId, itemId }).then(
        (summary) => { if (!cancelled) setResult({ key, summary }); },
        () => { if (!cancelled && attempt < 2) timer = setTimeout(() => load(attempt + 1), 1000); },
      );
    };
    load(0);
    return () => { cancelled = true; clearTimeout(timer); };

  }, [key, threadId, row.sourceThreadId, itemId, row.checkpointRunStatus]);
  const current = result?.key === key ? result : undefined;
  const files = current?.summary?.files ?? [];
  const merges = current?.summary?.merges ?? [];
  const tree = useMemo(() => buildTurnDiffTree(files), [files]);
  const total = useMemo(() => summarizeTurnDiffStats(files), [files]);
  const open = (path?: string) => { void run("openTurnDiff", { threadId, sourceThreadId: row.sourceThreadId, itemId, ...(path === undefined ? {} : { path }) }); };
  if (!files.length && !merges.length) return null;
  return <div className="turn-changes" data-checkpoint-id={item.checkpointId}>
    {files.length ? <details><summary><ChevronRightIcon size={13} /><span>{files.length} changed {files.length === 1 ? "file" : "files"}</span>{current?.summary?.branch ? <span className="turn-branch-chip" title={`Diff taken in ${current.summary.cwd}. Branch is the checkout's current branch; the branch at the time of the turn is not recorded.`}><GitBranchIcon size={11} />{current.summary.branch}</span> : null}<Counts stat={total} /></summary><div className="change-tree">{tree.map((node) => <ChangeNode key={node.path} node={node} open={open} />)}</div></details> : null}
    {merges.map((merge) => <MergeGroup key={`${merge.sourceThreadId}-${merge.appliedAt}`} merge={merge} threadId={threadId} itemId={itemId} />)}
    {files.length ? <button className="open-turn-diff" title="Open a file diff from this response in VS Code" onClick={() => open()}><FileDiffIcon size={13} /><span>Open diff</span></button> : null}
  </div>;
}
