import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon, ChevronDownIcon, BotIcon, BrainIcon, FolderIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { PendingRequests } from "./PendingRequests";
import { clearDraft, updateDraft, useComposerDraft } from "../composerDrafts";
import { fileReferenceLabel, formatComposerMessage } from "../../shared/composerContext";
import type { AssistantCitation } from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import { effortDescriptor } from "../../shared/modelOptions";
import { ModelPicker } from "./ModelPicker";

const runtimeLabels: Record<string, string> = { "approval-required": "Ask permission", "auto-accept-edits": "Auto-accept edits", auto: "Auto", "full-access": "Full access" };
export function Composer({ state, onEditCitation }: { readonly state: HostStateSnapshot; readonly onEditCitation: (citation: AssistantCitation, index: number) => void }) {
  const draftKey = state.activeThreadId ?? "new";
  const { text, contexts } = useComposerDraft(draftKey);
  const setText = (value: string) => updateDraft(draftKey, (draft) => ({ ...draft, text: value }));
  const [busy, setBusy] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const closeModels = useCallback(() => setModelsOpen(false), []);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const run = useActions();
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const selection = thread?.modelSelection ?? state.draft.modelSelection;
  const provider = state.providers.find((item) => item.instanceId === selection?.instanceId);
  const model = provider?.models.find((item) => item.slug === selection?.model);
  const target = thread ? { threadId: thread.id } : {};
  const runtimeMode = thread?.runtimeMode ?? state.draft.runtimeMode;
  const effort = effortDescriptor(model, selection);
  const project = state.projects.find((item) => item.id === state.draft.projectId);
  const projectLabel = project?.title ?? state.draft.workspaceRoot?.split(/[\\/]/).filter(Boolean).at(-1)
    ?? (state.draft.supportsNoProject ? "No project" : "Choose project");
  const disabled = busy || state.sending || thread?.archived === true;
  useEffect(() => {
    const focus = () => textarea.current?.focus(); window.addEventListener("t3-focus-composer", focus);
    return () => window.removeEventListener("t3-focus-composer", focus);
  }, []);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`;
  }, [text, state.appearance.fontSizePrompt]);
  useEffect(() => { setModelsOpen(false); }, [draftKey]);
  const send = async () => {
    const value = formatComposerMessage(text, contexts);
    if (!value || disabled || !selection) return;
    setBusy(true);
    const sent = await run("sendMessage", { text: value, ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}) });
    if (sent) clearDraft(draftKey);
    setBusy(false); textarea.current?.focus();
  };
  return <div className="composer-area"><div className="composer-column">
    <PendingRequests state={state} />
    {thread?.archived ? <div className="archived-banner">This thread is archived.<button className="text-button" onClick={() => { void run("threadAction", { threadId: thread.id, action: "unarchive" }); }}>Restore thread</button></div> : null}
    <div className="composer-box">
      {contexts.length ? <div className="composer-contexts" aria-label="Message references">{contexts.map((context, index) => <div className="context-chip" key={index}>
        <button className="context-label" title={context.type === "file" ? context.text || context.path : `${context.citation.text}${context.citation.comment ? `\nComment: ${context.citation.comment}` : ""}`} onClick={() => {
          if (context.type === "assistant") onEditCitation(context.citation, index);
          else void run("openLink", { href: `${context.uri}:${context.range.start.line}:${context.range.start.column}` });
        }}>{context.type === "file" ? `@${fileReferenceLabel(context)}` : context.citation.comment ? "Assistant quote · Comment" : "Assistant quote"}</button>
        <button className="icon-button" aria-label={`Remove reference ${index + 1}`} onClick={() => updateDraft(draftKey, (draft) => ({ ...draft, contexts: draft.contexts.filter((_, position) => position !== index) }))}><XIcon size={12} /></button>
      </div>)}</div> : null}
      <textarea ref={textarea} value={text} placeholder={thread?.activeRunId ? "Send a follow-up…" : "Ask anything, or describe a task…"} aria-label="Message" disabled={disabled} rows={2} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
      }} />
      {!thread ? <div className="composer-project"><button className="project-trigger" aria-label="Choose project" title={state.draft.workspaceRoot ?? projectLabel} disabled={busy || state.workspaceRoots.length === 1} onClick={() => {
        setBusy(true); void run("chooseProject").finally(() => setBusy(false));
      }}><FolderIcon size={12} /><span>{projectLabel}</span><ChevronDownIcon size={11} /></button></div> : null}
      {!selection ? <div className="composer-hint">No models available. Configure a provider in T3 Code.</div> : null}
      <div className="composer-toolbar"><div className="composer-controls">
        <button ref={modelTrigger} className="model-trigger" disabled={busy} onClick={() => setModelsOpen(!modelsOpen)} aria-expanded={modelsOpen} aria-label="Choose model"><BotIcon size={13} /><span>{model?.name ?? selection?.model ?? "Choose model"}</span><ChevronDownIcon size={12} /></button>
        {modelsOpen && modelTrigger.current ? <ModelPicker state={state} selection={selection} anchor={modelTrigger.current} onClose={closeModels} /> : null}
        {effort ? <label className="effort-control" title={effort.description ?? effort.label}><BrainIcon size={13} /><select aria-label="Effort level" value={String(getProviderOptionCurrentValue(effort) ?? "")} disabled={busy || !selection} onChange={(event) => {
          setBusy(true); void run("setModelOption", { ...target, optionId: effort.id, value: event.target.value }).finally(() => setBusy(false));
        }}>{getProviderOptionCurrentValue(effort) === undefined ? <option value="" disabled>Default</option> : null}{effort.options.map((option) => <option key={option.id} value={option.id} title={option.description}>{option.label}</option>)}</select></label> : null}
        <select aria-label="Permission mode" value={runtimeMode} disabled={busy || !selection} onChange={(event) => { void run("setModes", { ...target, runtimeMode: event.target.value }); }}>{(provider?.supportedRuntimeModes ?? ["approval-required", "auto", "full-access"]).map((mode) => <option key={mode} value={mode}>{runtimeLabels[mode]}</option>)}</select>
      </div>
      <div className="composer-send-controls">{thread?.activeRunId ? <button className="stop-button" aria-label="Stop generation" title="Stop generation" onClick={() => { void run("interrupt", { threadId: thread.id }); }}><SquareIcon size={12} fill="currentColor" /></button> : null}
        <button className="send-button" aria-label="Send message" title="Send message" disabled={disabled || !selection || (!text.trim() && !contexts.length)} onClick={() => { void send(); }}><ArrowUpIcon size={17} /></button>
      </div></div>
    </div>
    <div className="composer-footnote"><span>{thread?.activeRunId ? "Agent is working" : provider?.displayName ?? provider?.instanceId ?? "T3 Code"}</span><span>Enter to send · Shift+Enter for a new line</span></div>
  </div></div>;
}
