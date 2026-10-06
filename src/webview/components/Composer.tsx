import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon, ChevronDownIcon, MoreHorizontalIcon, FolderIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { PendingRequests } from "./PendingRequests";
import { clearDraft, updateDraft, useComposerDraft } from "../composerDrafts";
import { fileReferenceLabel, formatComposerMessage } from "../../shared/composerContext";
import type { AssistantCitation } from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, getProviderOptionCurrentValue, isClaudeUltrathinkPrompt } from "@t3tools/shared/model";
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
  const controls = useRef<HTMLDivElement>(null);
  const overflow = useRef<HTMLDetailsElement>(null);
  const [compactControls, setCompactControls] = useState(false);
  const run = useActions();
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const selection = thread?.modelSelection ?? state.draft.modelSelection;
  const provider = state.providers.find((item) => item.instanceId === selection?.instanceId);
  const model = provider?.models.find((item) => item.slug === selection?.model);
  const target = thread ? { threadId: thread.id } : {};
  const runtimeMode = thread?.runtimeMode ?? state.draft.runtimeMode;
  const effort = effortDescriptor(model, selection);
  const promptEffort = effort?.promptInjectedValues?.includes("ultrathink") && isClaudeUltrathinkPrompt(text);
  const modelLabel = model?.name ?? selection?.model ?? "Choose model";
  const effortValue = promptEffort ? "ultrathink" : String(effort ? getProviderOptionCurrentValue(effort) ?? "" : "");
  const effortLabel = effort?.options.find((option) => option.id === effortValue)?.label ?? "Default";
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
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (overflow.current && !overflow.current.contains(event.target as Node)) overflow.current.open = false; };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  useLayoutEffect(() => {
    const row = controls.current;
    const modelButton = modelTrigger.current;
    if (!row || !modelButton) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const measure = () => {
      const modelStyle = getComputedStyle(modelButton);
      context.font = `${modelStyle.fontWeight} ${modelStyle.fontSize} ${modelStyle.fontFamily}`;
      const modelWidth = context.measureText(modelLabel).width + 22;
      const style = getComputedStyle(row);
      context.font = `400 ${style.fontSize} ${style.fontFamily}`;
      const traitsWidth = context.measureText(runtimeLabels[runtimeMode] ?? runtimeMode).width + 24
        + (effort ? context.measureText(effortLabel).width + 24 : 0);
      setCompactControls(modelWidth + traitsWidth + 12 > row.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row); measure();
    return () => observer.disconnect();
  }, [modelLabel, effortLabel, Boolean(effort), runtimeMode, state.appearance.fontSizeInterface]);
  const send = async () => {
    const value = formatComposerMessage(text, contexts);
    if (!value || disabled || !selection) return;
    setBusy(true);
    const sent = await run("sendMessage", { text: value, ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}) });
    if (sent) clearDraft(draftKey);
    setBusy(false); textarea.current?.focus();
  };
  const traits = <div className="composer-traits">
    {effort ? <label className="effort-control" title={effort.description ?? effort.label}><select aria-label="Effort level" value={effortValue} disabled={busy || !selection} onChange={(event) => {
      if (effort.promptInjectedValues?.includes(event.target.value)) {
        setText(text.trim() ? applyClaudePromptEffortPrefix(text, "ultrathink") : "Ultrathink:\n"); return;
      }
      if (promptEffort) {
        const body = text.replace(/^Ultrathink:\s*/i, "");
        if (isClaudeUltrathinkPrompt(body)) return;
        setText(body);
      }
      setBusy(true); void run("setModelOption", { ...target, optionId: effort.id, value: event.target.value }).finally(() => setBusy(false));
    }}>{getProviderOptionCurrentValue(effort) === undefined ? <option value="" disabled>Default</option> : null}{effort.options.map((option) => <option key={option.id} value={option.id} title={option.description}>{option.label}</option>)}</select></label> : null}
    <select aria-label="Permission mode" value={runtimeMode} disabled={busy || !selection} onChange={(event) => { void run("setModes", { ...target, runtimeMode: event.target.value }); }}>{(provider?.supportedRuntimeModes ?? ["approval-required", "auto", "full-access"]).map((mode) => <option key={mode} value={mode}>{runtimeLabels[mode]}</option>)}</select>
  </div>;
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
      <div className="composer-toolbar"><div className="composer-project">{!thread ? <button className="project-trigger" aria-label="Choose project" title={state.draft.workspaceRoot ?? projectLabel} disabled={busy || state.workspaceRoots.length === 1} onClick={() => {
        setBusy(true); void run("chooseProject").finally(() => setBusy(false));
      }}><FolderIcon size={12} /><span>{projectLabel}</span><ChevronDownIcon size={11} /></button> : null}</div>
      {!selection ? <div className="composer-hint">No models available. Configure a provider in T3 Code.</div> : null}
      <div className="composer-send-controls">{thread?.activeRunId ? <button className="stop-button" aria-label="Stop generation" title="Stop generation" onClick={() => { void run("interrupt", { threadId: thread.id }); }}><SquareIcon size={12} fill="currentColor" /></button> : null}
        <button className="send-button" aria-label="Send message" title="Send message" disabled={disabled || !selection || (!text.trim() && !contexts.length)} onClick={() => { void send(); }}><ArrowUpIcon size={17} /></button>
      </div></div>
    </div>
    <div ref={controls} className="composer-controls">
      <button ref={modelTrigger} className="model-trigger" title={modelLabel} disabled={busy} onClick={() => setModelsOpen(!modelsOpen)} aria-expanded={modelsOpen} aria-label="Choose model"><span>{modelLabel}</span><ChevronDownIcon size={12} /></button>
      {modelsOpen && modelTrigger.current ? <ModelPicker state={state} selection={selection} anchor={modelTrigger.current} onClose={closeModels} /> : null}
      {compactControls ? <details ref={overflow} className="composer-options-overflow" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary className="icon-button" aria-label="Effort and permissions" title="Effort and permissions"><MoreHorizontalIcon size={16} /></summary><div className="composer-options-popup">{traits}</div></details> : traits}
    </div>
    <div className="composer-footnote"><span>{thread?.activeRunId ? "Agent is working" : ""}</span><span>Enter to send · Shift+Enter for a new line</span></div>
  </div></div>;
}
