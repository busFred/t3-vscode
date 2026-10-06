import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon, ChevronDownIcon, BotIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { PendingRequests } from "./PendingRequests";

const drafts = new Map<string, string>();
const runtimeLabels: Record<string, string> = { "approval-required": "Ask permission", "auto-accept-edits": "Auto-accept edits", auto: "Auto", "full-access": "Full access" };
export function Composer({ state }: { readonly state: HostStateSnapshot }) {
  const draftKey = state.activeThreadId ?? "new";
  const [text, setText] = useState(() => drafts.get(draftKey) ?? "");
  const [busy, setBusy] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const modelPopup = useRef<HTMLDivElement>(null);
  const run = useActions();
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const provider = state.providers.find((item) => item.instanceId === thread?.modelSelection.instanceId);
  const model = provider?.models.find((item) => item.slug === thread?.modelSelection.model);
  const disabled = busy || state.sending || thread?.archived === true;
  useEffect(() => { drafts.set(draftKey, text); }, [draftKey, text]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`;
  }, [text]);
  useEffect(() => {
    if (!modelsOpen) return;
    const close = (event: PointerEvent) => { if (!modelPopup.current?.contains(event.target as Node)) setModelsOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [modelsOpen]);
  const send = async () => {
    const value = text.trim();
    if (!value || disabled) return;
    setBusy(true);
    const sent = await run("sendMessage", { text: value, ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}) });
    if (sent) { setText(""); drafts.delete(draftKey); }
    setBusy(false); textarea.current?.focus();
  };
  return <div className="composer-area"><div className="composer-column">
    <PendingRequests state={state} />
    {thread?.archived ? <div className="archived-banner">This thread is archived.<button className="text-button" onClick={() => { void run("threadAction", { threadId: thread.id, action: "unarchive" }); }}>Restore thread</button></div> : null}
    <div className="composer-box">
      <textarea ref={textarea} value={text} placeholder={thread?.activeRunId ? "Send a follow-up…" : "Ask anything, or describe a task…"} aria-label="Message" disabled={disabled} rows={2} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
      }} />
      <div className="composer-toolbar"><div className="composer-controls">
        {thread ? <><div className="model-control" ref={modelPopup}>
          <button className="model-trigger" disabled={busy} onClick={() => setModelsOpen(!modelsOpen)} aria-expanded={modelsOpen} aria-label="Choose model"><BotIcon size={13} /><span>{model?.name ?? thread.modelSelection.model}</span><ChevronDownIcon size={12} /></button>
          {modelsOpen ? <div className="model-picker" role="dialog" aria-label="Choose model" onKeyDown={(event) => { if (event.key === "Escape") setModelsOpen(false); }}>
            <input autoFocus aria-label="Search models" placeholder="Search models…" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} />
            <div className="model-options">{state.providers.filter((item) => item.enabled).map((entry) => <section key={entry.instanceId}><header>{entry.displayName ?? entry.instanceId}{!entry.installed ? " · Not installed" : ""}</header>{entry.models.filter((item) => `${entry.displayName ?? entry.instanceId} ${item.name} ${item.slug}`.toLowerCase().includes(modelSearch.toLowerCase())).map((item) => <button key={item.slug} disabled={!entry.installed || entry.availability === "unavailable"} className={entry.instanceId === thread.modelSelection.instanceId && item.slug === thread.modelSelection.model ? "selected" : ""} onClick={() => {
              setBusy(true); void run("setModel", { threadId: thread.id, modelSelection: { instanceId: entry.instanceId, model: item.slug } }).then((ok) => { if (ok) setModelsOpen(false); }).finally(() => setBusy(false));
            }}><span>{item.name}</span>{item.isCustom ? <small>Custom</small> : null}</button>)}</section>)}</div>
          </div> : null}
        </div>
        <select aria-label="Interaction mode" value={thread.interactionMode} disabled={busy} onChange={(event) => { void run("setModes", { threadId: thread.id, interactionMode: event.target.value }); }}><option value="default">Code</option><option value="plan">Plan</option></select>
        <select aria-label="Permission mode" value={thread.runtimeMode} disabled={busy} onChange={(event) => { void run("setModes", { threadId: thread.id, runtimeMode: event.target.value }); }}>{(provider?.supportedRuntimeModes ?? ["approval-required", "auto", "full-access"]).map((mode) => <option key={mode} value={mode}>{runtimeLabels[mode]}</option>)}</select>
        </> : <span className="composer-hint">A new thread will use your workspace</span>}
      </div>
      <div className="composer-send-controls">{thread?.activeRunId ? <button className="stop-button" aria-label="Stop generation" title="Stop generation" onClick={() => { void run("interrupt", { threadId: thread.id }); }}><SquareIcon size={12} fill="currentColor" /></button> : null}
        <button className="send-button" aria-label="Send message" title="Send message" disabled={disabled || !text.trim()} onClick={() => { void send(); }}><ArrowUpIcon size={17} /></button>
      </div></div>
    </div>
    <div className="composer-footnote"><span>{thread?.activeRunId ? "Agent is working" : provider?.displayName ?? provider?.instanceId ?? "T3 Code"}</span><span>Enter to send · Shift+Enter for a new line</span></div>
  </div></div>;
}
