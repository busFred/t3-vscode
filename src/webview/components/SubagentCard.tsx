import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRightIcon, CircleDashedIcon, CircleXIcon, MessageCircleQuestionIcon } from "lucide-react";
import type { HostStateSnapshot, TranscriptItem, WireTurnItem } from "../../shared/bridge";
import { subagentElapsed, subagentStatus } from "../../shared/sessionTree";
import { providerBrand } from "../../shared/usage";
import { useActions } from "../actions";
import { ProviderIcon } from "./ProviderIcon";
import { ChatMarkdown } from "./ChatMarkdown";

export const SubagentState = createContext<Pick<HostStateSnapshot, "threads" | "providers" | "activeThreadId"> | null>(null);

export function SubagentCard({ row }: { readonly row: TranscriptItem & { readonly item: Extract<WireTurnItem, { type: "subagent" }> } }) {
  const state = useContext(SubagentState)!;
  const item = row.item; const run = useActions();
  const child = state.threads.find((thread) => thread.id === item.childThreadId);
  const provider = state.providers.find((entry) => entry.instanceId === (child?.modelSelection.instanceId ?? item.providerInstanceId));
  const title = child?.title || item.title || "Subagent";
  const model = child?.modelSelection.model;
  const modelLabel = provider?.models.find((entry) => entry.slug === model)?.name ?? model ?? provider?.displayName ?? item.driver;
  const status = subagentStatus(item, child);
  const working = ["preparing", "running", "starting", "waiting", "in_progress", "pending"].includes(status);
  const failed = ["failed", "error"].includes(status);
  const label = status === "input" ? "Input needed" : working ? "Running" : status === "completed" ? "Completed" : status.replaceAll("_", " ");
  const StatusIcon = status === "input" ? MessageCircleQuestionIcon : failed ? CircleXIcon : status === "completed" ? CheckIcon : CircleDashedIcon;
  const elapsed = subagentElapsed(child?.workingStartedAt ?? item.startedAt, working ? child?.updatedAt ?? item.updatedAt : item.completedAt ?? item.updatedAt);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const [details, setDetails] = useState(false);
  const show = (element: HTMLElement) => { const box = element.getBoundingClientRect(); setPreview({ x: Math.max(8, Math.min(box.left + 24, window.innerWidth - 292)), y: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - 210)) }); };
  const result = item.result ?? item.progress ?? item.prompt;
  return <section className="subagent-entry" onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setPreview(null)} onFocusCapture={(event) => show(event.currentTarget)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null); }}>
    <div className="subagent-line"><button className="subagent-open" disabled={!child} aria-label={`Open subagent ${title}`} aria-describedby={preview ? `subagent-preview-${item.id}` : undefined} onClick={() => { setPreview(null); if (child) void run("selectThread", { threadId: child.id }); }}>
      <ProviderIcon brand={providerBrand(provider?.driver ?? item.driver, provider?.displayName)} /><span className="subagent-title-status"><span>{title}</span><small className={`subagent-status ${working ? "working" : failed ? "failed" : status === "input" ? "input" : ""}`}><StatusIcon size={12} />{label}</small></span><time>{elapsed}</time>{child ? <ChevronRightIcon size={13} /> : null}
    </button><button className="icon-button" aria-label={`Details for ${title}`} aria-expanded={details} onClick={() => { setPreview(null); setDetails(!details); }}><ChevronRightIcon size={13} className={details ? "rotate-90" : ""} /></button></div>
    {details ? <div className="subagent-details"><ChatMarkdown text={result} threadId={state.activeThreadId ?? ""} assetSource={{ sourceThreadId: row.sourceThreadId, itemId: row.sourceItemId ?? item.id }} />{!child ? <p className="subtle">This subagent has no conversation available in the current workspace.</p> : null}</div> : null}
    {preview ? createPortal(<div className="subagent-hover-card" role="tooltip" id={`subagent-preview-${item.id}`} style={{ left: preview.x, top: preview.y }}><strong>{title}</strong><div><ProviderIcon brand={providerBrand(provider?.driver ?? item.driver, provider?.displayName)} /><span>{modelLabel}</span></div>{state.providers.filter((entry) => entry.driver === provider?.driver).length > 1 ? <small>{provider?.displayName}</small> : null}<div><span className={`subagent-status ${working ? "working" : failed ? "failed" : status === "input" ? "input" : ""}`}><StatusIcon size={12} />{label}</span><time>{elapsed}</time></div>{child?.branch ? <small>{child.branch}</small> : null}{result ? <p>{result.replace(/\s+/g, " ").slice(0, 240)}</p> : null}</div>, document.body) : null}
  </section>;
}
