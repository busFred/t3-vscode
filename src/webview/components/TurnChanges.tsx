import { useMemo } from "react";
import { ChevronRightIcon, FileDiffIcon, FileIcon, FolderIcon } from "lucide-react";
import type { TranscriptItem, WireTurnItem } from "../../shared/bridge";
import { useActions } from "../actions";
import { buildTurnDiffTree, summarizeTurnDiffStats, type TurnDiffTreeNode, type TurnDiffStat } from "./t3/turnDiffTree";

function Counts({ stat }: { readonly stat: TurnDiffStat | null }) {
  return stat ? <span className="change-counts"><span className="addition">+{stat.additions}</span><span className="deletion">−{stat.deletions}</span></span> : null;
}
function ChangeNode({ node, open }: { readonly node: TurnDiffTreeNode; readonly open: (path: string) => void }) {
  return node.kind === "directory" ? <details className="change-directory"><summary><ChevronRightIcon size={12} /><FolderIcon size={14} /><span className="change-name">{node.name}</span><Counts stat={node.stat} /></summary><div>{node.children.map((child) => <ChangeNode key={child.path} node={child} open={open} />)}</div></details>
    : <button className="change-file" aria-label={`Open turn diff: ${node.path}`} title={`Open turn diff: ${node.path}`} onClick={() => open(node.path)}><FileIcon size={14} /><span className="change-name">{node.name}</span><Counts stat={node.stat} /></button>;
}
export function TurnChanges({ row, threadId }: { readonly row: TranscriptItem; readonly threadId: string }) {
  const item = row.item as Extract<WireTurnItem, { type: "checkpoint" }>;
  const run = useActions();
  const tree = useMemo(() => buildTurnDiffTree(item.files), [item.files]);
  const total = useMemo(() => summarizeTurnDiffStats(item.files), [item.files]);
  if (!item.files.length) return null;
  const open = (path?: string) => { void run("openTurnDiff", { threadId, sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? item.id, ...(path === undefined ? {} : { path }) }); };
  return <div className="turn-changes" data-checkpoint-id={item.checkpointId}><details><summary><ChevronRightIcon size={13} /><span>{item.files.length} changed {item.files.length === 1 ? "file" : "files"}</span><Counts stat={total} /></summary><div className="change-tree">{tree.map((node) => <ChangeNode key={node.path} node={node} open={open} />)}</div></details><button className="open-turn-diff" title="Open a file diff from this turn in VS Code" onClick={() => open()}><FileDiffIcon size={13} /><span>Open diff</span></button></div>;
}
