import { useEffect, useMemo, useState } from "react";
import { GitBranchIcon } from "lucide-react";
import type { RestorePreview as RestorePreviewData } from "../../shared/bridge";
import { bridge } from "../bridge-client";
import { useActions } from "../actions";
import { useDateTimeFormat } from "../timeFormat";

/** Relative for a week, then the user's date format; the exact time is in the tooltip. */
function relativeTime(iso: string, date: (value: Date) => string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return days <= 7 ? `${days} day${days === 1 ? "" : "s"} ago` : date(new Date(iso));
}

export type RestoreLocator = { readonly itemId: string } | { readonly checkpointId: string; readonly scopeId: string };
/** The grouped preview panel for "Restore files to this point" (design B, option 1 — see docs/mockups/revert-combined.html). */
export function RestorePreview({ threadId, sourceThreadId, locator, turnNumber, onClose }: {
  readonly threadId: string; readonly sourceThreadId: string; readonly locator: RestoreLocator; readonly turnNumber?: number; readonly onClose: () => void;
}) {
  const run = useActions(); const { date, dateTime } = useDateTimeFormat();
  const [preview, setPreview] = useState<RestorePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const locatorKey = "itemId" in locator ? locator.itemId : `${locator.checkpointId}:${locator.scopeId}`;
  useEffect(() => {
    let cancelled = false;
    void bridge.request<RestorePreviewData>("restorePreview", { threadId, sourceThreadId, ...locator }).then((result) => {
      if (cancelled) return;
      setPreview(result); setKeep(new Set(result.files.filter((file) => file.you).map((file) => file.path)));
    }, (cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [threadId, sourceThreadId, locatorKey]);
  const youCount = useMemo(() => preview?.files.filter((file) => file.you).length ?? 0, [preview]);
  const toggle = (path: string) => setKeep((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const submit = (mode: "keep" | "everything") => {
    setSubmitting(true); setError(null);
    void run("restoreFiles", { threadId, sourceThreadId, ...locator, keep: [...keep], mode }).then((ok) => { if (ok) onClose(); else setError("Could not restore files."); }).finally(() => setSubmitting(false));
  };
  const openDiff = (path: string) => { void run("openRestoreDiff", { threadId, sourceThreadId, ...locator, path }); };
  const shownTurn = preview?.turnNumber ?? turnNumber;
  if (error) return <div className="restore-preview"><p className="turn-error">{error}</p><div className="restore-preview-foot"><button className="btn ghost" onClick={onClose}>Close</button></div></div>;
  if (!preview) return <div className="restore-preview restore-preview-loading" role="status">Loading files changed{shownTurn !== undefined ? ` since turn ${shownTurn}` : ""}…</div>;
  return <div className="restore-preview">
    <div className="restore-preview-head">
      <strong>{shownTurn !== undefined ? `Restore files to turn ${shownTurn}` : "Restore files to this point"}</strong>
      {preview.branch ? <span className="turn-branch-chip"><GitBranchIcon size={11} />{preview.branch}</span> : null}
      <span className="restore-preview-sub">Checkpoint from <time dateTime={preview.checkpointAt} title={dateTime(new Date(preview.checkpointAt))}>{relativeTime(preview.checkpointAt, date)}</time></span>
    </div>
    {preview.files.length ? <div className="restore-preview-section">
      <div className="restore-preview-section-head">Files changed{shownTurn !== undefined ? ` since turn ${shownTurn}` : ""} <span className="restore-preview-count">({preview.files.length} {preview.files.length === 1 ? "file" : "files"} · your edits in {youCount})</span></div>
      {preview.files.map((file) => {
        const counts = file.agent ?? file.you;
        return <div key={file.path} className="restore-preview-row">
          <span className="restore-preview-name">{file.path}
            {file.agent ? <span className="badge restore-badge-agent">agent</span> : null}
            {file.you ? <span className="badge restore-badge-you">{file.you.untracked ? "you · new file" : "you"}</span> : null}
            {file.keepVerdict === "clean" ? <span className="badge restore-badge-ok">keeps cleanly</span> : null}
            {file.keepVerdict === "conflict" ? <span className="badge restore-badge-conflict">conflicts</span> : null}
          </span>
          <span className="change-counts">{counts ? <><span className="addition">+{counts.additions}</span><span className="deletion">−{counts.deletions}</span></> : null}</span>
          <button className="text-button" onClick={() => openDiff(file.path)}>Open diff</button>
          {file.you ? <label className="restore-preview-keep"><input type="checkbox" checked={keep.has(file.path)} onChange={() => toggle(file.path)} />Keep mine</label> : <span />}
        </div>;
      })}
    </div> : <p className="subtle restore-preview-section">Nothing has changed since this checkpoint.</p>}
    <div className="restore-preview-foot">
      <button className="btn primary" disabled={submitting} onClick={() => submit("keep")}>Restore and keep {keep.size} {keep.size === 1 ? "file" : "files"}</button>
      <button className="btn" disabled={submitting} onClick={() => submit("everything")}>Restore everything</button>
      <button className="btn ghost" disabled={submitting} onClick={onClose}>Cancel</button>
    </div>
  </div>;
}
