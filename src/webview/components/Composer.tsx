import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon, ChevronDownIcon, BotIcon, FolderIcon } from "lucide-react";
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
  const selection = thread?.modelSelection ?? state.draft.modelSelection;
  const provider = state.providers.find((item) => item.instanceId === selection?.instanceId);
  const model = provider?.models.find((item) => item.slug === selection?.model);
  const target = thread ? { threadId: thread.id } : {};
  const runtimeMode = thread?.runtimeMode ?? state.draft.runtimeMode;
  const interactionMode = thread?.interactionMode ?? state.draft.interactionMode;
  const project = state.projects.find((item) => item.id === state.draft.projectId);
  const projectLabel = project?.title ?? state.draft.workspaceRoot?.split(/[\\/]/).filter(Boolean).at(-1)
    ?? (state.draft.supportsNoProject ? "No project" : "Choose project");
  const modelGroups = state.providers.filter((item) => item.enabled).map((entry) => ({ entry,
    models: entry.models.filter((item) => `${entry.displayName ?? entry.instanceId} ${item.name} ${item.slug}`.toLowerCase().includes(modelSearch.toLowerCase())) }));
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
    if (!value || disabled || !selection) return;
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
      {!thread ? <div className="composer-project"><button className="project-trigger" aria-label="Choose project" title={state.draft.workspaceRoot ?? projectLabel} disabled={busy} onClick={() => {
        setBusy(true); void run("chooseProject").finally(() => setBusy(false));
      }}><FolderIcon size={12} /><span>{projectLabel}</span><ChevronDownIcon size={11} /></button></div> : null}
      {!selection ? <div className="composer-hint">No models available. Configure a provider in T3 Code.</div> : null}
      <div className="composer-toolbar"><div className="composer-controls">
        <div className="model-control" ref={modelPopup}>
          <button className="model-trigger" disabled={busy} onClick={() => setModelsOpen(!modelsOpen)} aria-expanded={modelsOpen} aria-label="Choose model"><BotIcon size={13} /><span>{model?.name ?? selection?.model ?? "Choose model"}</span><ChevronDownIcon size={12} /></button>
          {modelsOpen ? <div className="model-picker" role="dialog" aria-label="Choose model" onKeyDown={(event) => { if (event.key === "Escape") setModelsOpen(false); }}>
            <input autoFocus aria-label="Search models" placeholder="Search models…" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} />
            <div className="model-options">{modelGroups.map(({ entry, models }) => <section key={entry.instanceId}><header>{entry.displayName ?? entry.instanceId}{!entry.installed ? " · Not installed" : ""}{entry.availability === "unavailable" ? " · Unavailable" : ""}</header>{models.map((item) => <button key={item.slug} disabled={!entry.installed || entry.availability === "unavailable"} className={entry.instanceId === selection?.instanceId && item.slug === selection.model ? "selected" : ""} onClick={() => {
              setBusy(true); void run("setModel", { ...target, modelSelection: { instanceId: entry.instanceId, model: item.slug } }).then((ok) => { if (ok) setModelsOpen(false); }).finally(() => setBusy(false));
            }}><span>{item.name}</span>{item.isCustom ? <small>Custom</small> : null}</button>)}</section>)}</div>
            {!modelGroups.some((group) => group.models.length) ? <div className="model-empty">{modelSearch ? "No matching models." : "No models available. Configure a provider in T3 Code."}</div> : null}
          </div> : null}
        </div>
        <select aria-label="Interaction mode" value={interactionMode} disabled={busy || !selection} onChange={(event) => { void run("setModes", { ...target, interactionMode: event.target.value }); }}><option value="default">Code</option><option value="plan">Plan</option></select>
        <select aria-label="Permission mode" value={runtimeMode} disabled={busy || !selection} onChange={(event) => { void run("setModes", { ...target, runtimeMode: event.target.value }); }}>{(provider?.supportedRuntimeModes ?? ["approval-required", "auto", "full-access"]).map((mode) => <option key={mode} value={mode}>{runtimeLabels[mode]}</option>)}</select>
      </div>
      <div className="composer-send-controls">{thread?.activeRunId ? <button className="stop-button" aria-label="Stop generation" title="Stop generation" onClick={() => { void run("interrupt", { threadId: thread.id }); }}><SquareIcon size={12} fill="currentColor" /></button> : null}
        <button className="send-button" aria-label="Send message" title="Send message" disabled={disabled || !selection || !text.trim()} onClick={() => { void send(); }}><ArrowUpIcon size={17} /></button>
      </div></div>
    </div>
    <div className="composer-footnote"><span>{thread?.activeRunId ? "Agent is working" : provider?.displayName ?? provider?.instanceId ?? "T3 Code"}</span><span>Enter to send · Shift+Enter for a new line</span></div>
  </div></div>;
}
