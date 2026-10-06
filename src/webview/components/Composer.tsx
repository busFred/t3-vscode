import { bridge } from "../bridge-client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon, ChevronDownIcon, MoreHorizontalIcon, FolderIcon, XIcon, PaperclipIcon, FileIcon } from "lucide-react";
import type { ComposerSuggestion, HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { PendingRequests } from "./PendingRequests";
import { clearDraft, updateDraft, useComposerDraft } from "../composerDrafts";
import { fileReferenceLabel, formatComposerMessage } from "../../shared/composerContext";
import type { AssistantCitation } from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, getProviderOptionCurrentValue, isClaudeUltrathinkPrompt } from "@t3tools/shared/model";
import { effortDescriptor } from "../../shared/modelOptions";
import { ModelPicker } from "./ModelPicker";
import { detectComposerTrigger } from "../../shared/composerSuggestions";
import { replaceTextRange, serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { useBridgeQuery } from "../useBridgeQuery";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { ConversationActivity } from "./ConversationActivity";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { addDraftAttachments, pasteAttachments, removeDraftAttachment, trackAttachmentWork } from "../composerAttachments";
import type { DraftAttachment } from "../../shared/composerAttachments";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { openVisual } from "./ChatMedia";

const runtimeLabels: Record<string, string> = { "approval-required": "Ask permission", "auto-accept-edits": "Auto-accept edits", auto: "Auto", "full-access": "Full access" };
const steerShortcut = navigator.userAgent.includes("Mac") ? "Cmd+Enter" : "Ctrl+Enter";
export function Composer({ state, onEditCitation, onUsage }: { readonly state: HostStateSnapshot; readonly onEditCitation: (citation: AssistantCitation, index: number) => void; readonly onUsage: () => void }) {
  const draftKey = state.activeThreadId ?? "new";
  const { text, contexts, attachments = [] } = useComposerDraft(draftKey);
  const touched = useRef(false);
  const markTouched = () => {
    if (touched.current || !state.activeThreadId) return;
    touched.current = true; void bridge.request("composerState", { threadId: state.activeThreadId, touched: true }).catch(() => undefined);
  };
  const setText = (value: string) => { if (value.length) markTouched(); updateDraft(draftKey, (draft) => ({ ...draft, text: value })); };
  useEffect(() => {
    const threadId = state.activeThreadId; if (!threadId) return;
    void bridge.request("composerState", { threadId, active: true }).catch(() => undefined);
    return () => { void bridge.request("composerState", { threadId, active: false }).catch(() => undefined); };
  }, [state.activeThreadId]);
  useEffect(() => { if (text.length || contexts.length || attachments.length) markTouched(); }, [text, contexts, attachments]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [cursor, setCursor] = useState(text.length);
  const [dismissedTrigger, setDismissedTrigger] = useState<string | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
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
  const disabled = busy || state.sending || thread?.archived === true || thread?.providerNativeSubagent === true;
  const trigger = detectComposerTrigger(text, cursor);
  const queryKind = trigger?.kind;
  const canSuggest = queryKind === "path" || queryKind === "slash-command" || queryKind === "skill";
  const triggerKey = canSuggest && trigger ? `${draftKey}:${state.draft.projectId ?? state.draft.workspaceRoot}:${selection?.instanceId}:${trigger.kind}:${trigger.rangeStart}:${trigger.query}` : null;
  const suggestions = useBridgeQuery<ReadonlyArray<ComposerSuggestion>>("composerSuggestions", { kind: queryKind, query: trigger?.query ?? "", atPromptStart: trigger?.rangeStart === 0 }, triggerKey);
  const items = suggestions.data ?? [];
  const suggestionsOpen = triggerKey !== null && triggerKey !== dismissedTrigger && !disabled;
  const highlighted = Math.min(suggestionIndex, Math.max(0, items.length - 1));
  useEffect(() => setSuggestionIndex(0), [triggerKey]);
  useEffect(() => { if (suggestionsOpen) document.getElementById(`composer-suggestion-${highlighted}`)?.scrollIntoView({ block: "nearest" }); }, [highlighted, suggestionsOpen]);
  const chooseSuggestion = (item: ComposerSuggestion) => {
    if (!trigger) return;
    const replacement = item.kind === "file" || item.kind === "directory" ? `${serializeComposerFileLink(item.value)} ` : item.value;
    const next = replaceTextRange(text, trigger.rangeStart, trigger.rangeEnd, replacement);
    setText(next.text); setCursor(next.cursor); setDismissedTrigger(triggerKey);
    if (item.kind === "model") setModelsOpen(true);
    else if (item.kind === "usage") onUsage();
    else requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.cursor, next.cursor); });
  };
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
  const running = Boolean(thread?.activeRunId || state.queue?.activeRunId);
  const shortcutHint = `${running ? `Enter to queue${state.queue?.canSteer ? ` · ${steerShortcut} to steer` : ""}` : "Enter to send"} · Shift+Enter for a new line`;
  const send = async (steer = false) => {
    const value = formatComposerMessage(text, contexts);
    if ((!value && !attachments.length) || disabled || !selection || picking || attachments.some((file) => file.pending || !file.attachment)) return;
    setBusy(true);
    const mode = resolveComposerDispatchMode({ running, activeTurnDefault: "queue", alternateModifier: steer && state.queue?.canSteer === true });
    const sent = await run("sendMessage", { text: value, mode, attachmentIds: attachments.map((file) => file.attachment!.id), ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}) });
    if (sent) clearDraft(draftKey);
    setBusy(false); textarea.current?.focus();
  };
  const addFiles = (files: ReadonlyArray<File>) => {
    if (disabled || !files.length) return;
    markTouched(); setAttachmentError(null);
    void pasteAttachments(draftKey, files, state.activeThreadId).catch((cause) => setAttachmentError(cause instanceof Error ? cause.message : String(cause)));
  };
  const pickFiles = () => {
    setPicking(true); setAttachmentError(null);
    void trackAttachmentWork(draftKey, bridge.request<{ attachments: DraftAttachment[]; errors: string[] }>("pickAttachments", undefined, 10 * 60_000).then((result) => {
      if (result.attachments.length) { markTouched(); addDraftAttachments(draftKey, result.attachments); }
      setAttachmentError(result.errors.join("\n") || null);
    })).catch((cause) => setAttachmentError(cause instanceof Error ? cause.message : String(cause))).finally(() => { setPicking(false); textarea.current?.focus(); });
  };
  const traits = <div className="composer-traits">
    {effort ? <label className="effort-control" title={effort.description ?? effort.label}><select aria-label="Effort level" value={effortValue} disabled={busy || thread?.providerNativeSubagent || !selection} onChange={(event) => {
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
    <select aria-label="Permission mode" value={runtimeMode} disabled={busy || thread?.providerNativeSubagent || !selection} onChange={(event) => { void run("setModes", { ...target, runtimeMode: event.target.value }); }}>{(provider?.supportedRuntimeModes ?? ["approval-required", "auto", "full-access"]).map((mode) => <option key={mode} value={mode}>{runtimeLabels[mode]}</option>)}</select>
  </div>;
  return <div className="composer-area"><div className="composer-column">
    <PendingRequests state={state} />
    <ConversationActivity key={draftKey} state={state} />
    {thread?.archived ? <div className="archived-banner">This thread is archived.<button className="text-button" onClick={() => { void run("threadAction", { threadId: thread.id, action: "unarchive" }); }}>Restore thread</button></div> : null}
    {thread?.providerNativeSubagent ? <p className="subagent-readonly" role="status">This conversation is controlled by its provider. Send instructions in the parent conversation.</p> : null}
    <div className="composer-box" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]); } }}>
      {suggestionsOpen ? <ComposerSuggestions items={items} selected={highlighted} pending={suggestions.pending} error={suggestions.error} onSelect={chooseSuggestion} onHighlight={setSuggestionIndex} /> : null}
      {attachments.length ? <div className="composer-attachments" aria-label="Message attachments">{attachments.map((file) => <div className={`composer-attachment${file.error ? " attachment-failed" : ""}`} key={file.key} title={`${file.name} · ${formatAttachmentSize(file.sizeBytes)}${file.error ? `\n${file.error}` : ""}`}>
        <button className="attachment-preview" aria-label={`Preview ${file.name}`} disabled={!file.previewUrl} onClick={() => { if (file.previewUrl) openVisual({ title: file.name, src: file.previewUrl }); }}>{file.previewUrl ? <img src={file.previewUrl} alt={file.name} /> : <FileIcon size={20} />}</button>
        <span className="attachment-name">{file.name}</span><span className="attachment-state">{file.pending ? "Uploading…" : file.error ? "Upload failed" : formatAttachmentSize(file.sizeBytes)}</span>
        <button className="icon-button remove-attachment" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => { void removeDraftAttachment(draftKey, file.key).catch((cause) => setAttachmentError(String(cause))); }}><XIcon size={12} /></button>
      </div>)}</div> : null}
      {attachmentError ? <div className="composer-attachment-error" role="alert">{attachmentError}</div> : null}
      {contexts.length ? <div className="composer-contexts" aria-label="Message references">{contexts.map((context, index) => <div className="context-chip" key={index}>
        <button className="context-label" title={context.type === "file" ? context.text || context.path : `${context.citation.text}${context.citation.comment ? `\nComment: ${context.citation.comment}` : ""}`} onClick={() => {
          if (context.type === "assistant") onEditCitation(context.citation, index);
          else void run("openLink", { href: `${context.uri}:${context.range.start.line}:${context.range.start.column}` });
        }}>{context.type === "file" ? `@${fileReferenceLabel(context)}` : context.citation.comment ? "Assistant quote · Comment" : "Assistant quote"}</button>
        <button className="icon-button" aria-label={`Remove reference ${index + 1}`} onClick={() => updateDraft(draftKey, (draft) => ({ ...draft, contexts: draft.contexts.filter((_, position) => position !== index) }))}><XIcon size={12} /></button>
      </div>)}</div> : null}
      <textarea ref={textarea} value={text} placeholder={running ? "Send a follow-up…" : "Ask anything, or describe a task…"} aria-label="Message" title={shortcutHint} disabled={disabled} rows={2}
        onPaste={(event) => {
          const files = event.clipboardData.files.length ? [...event.clipboardData.files] : [...event.clipboardData.items].map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => file !== null);
          if (files.length) { event.preventDefault(); addFiles(files); }
        }}
        aria-controls={suggestionsOpen ? "composer-suggestions" : undefined} aria-expanded={suggestionsOpen} aria-autocomplete="list" aria-activedescendant={suggestionsOpen && items.length ? `composer-suggestion-${highlighted}` : undefined}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart)} onChange={(event) => { setText(event.target.value); setCursor(event.target.selectionStart); setDismissedTrigger(null); }} onKeyDown={(event) => {
        if (suggestionsOpen && !event.nativeEvent.isComposing) {
          if (event.key === "Escape") { event.preventDefault(); setDismissedTrigger(triggerKey); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSuggestionIndex(items.length ? (highlighted + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0); return; }
          if ((event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) || event.key === "Tab") { event.preventDefault(); if (items[highlighted]) chooseSuggestion(items[highlighted]); return; }
        }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event.ctrlKey || event.metaKey); }
      }} />
      <div className="composer-toolbar"><div className="composer-project">{!thread ? <button className="project-trigger" aria-label="Choose project" title={state.draft.workspaceRoot ?? projectLabel} disabled={busy || state.workspaceRoots.length === 1} onClick={() => {
        setBusy(true); void run("chooseProject").finally(() => setBusy(false));
      }}><FolderIcon size={12} /><span>{projectLabel}</span><ChevronDownIcon size={11} /></button> : null}</div>
      {!selection ? <div className="composer-hint">No models available. Configure a provider in T3 Code.</div> : null}
      <div className="composer-send-controls"><button className="icon-button" aria-label="Attach files" title="Attach files from this machine" disabled={disabled || picking} onClick={pickFiles}><PaperclipIcon size={17} /></button>{thread?.activeRunId ? <button className="stop-button" aria-label="Stop generation" title="Stop generation" onClick={() => { void run("interrupt", { threadId: thread.id }); }}><SquareIcon size={12} fill="currentColor" /></button> : null}
        <button className="send-button" aria-label="Send message" title={running ? `Queue after this turn${state.queue?.canSteer ? ` · ${steerShortcut} to steer` : ""}` : "Send message"} disabled={disabled || picking || !selection || attachments.some((file) => file.pending || !file.attachment) || (!text.trim() && !contexts.length && !attachments.length)} onClick={(event) => { void send(event.ctrlKey || event.metaKey); }}><ArrowUpIcon size={17} /></button>
      </div></div>
    </div>
    <div ref={controls} className="composer-controls">
      <button ref={modelTrigger} className="model-trigger" title={modelLabel} disabled={busy || thread?.providerNativeSubagent} onClick={() => setModelsOpen(!modelsOpen)} aria-expanded={modelsOpen} aria-label="Choose model"><span>{modelLabel}</span><ChevronDownIcon size={12} /></button>
      {modelsOpen && modelTrigger.current ? <ModelPicker state={state} selection={selection} anchor={modelTrigger.current} onClose={closeModels} /> : null}
      {compactControls ? <details ref={overflow} className="composer-options-overflow" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary className="icon-button" aria-label="Effort and permissions" title="Effort and permissions"><MoreHorizontalIcon size={16} /></summary><div className="composer-options-popup">{traits}</div></details> : traits}
    </div>
    <div className="composer-footnote"><span>{running ? "Agent is working" : ""}</span><span>{shortcutHint}</span></div>
  </div></div>;
}
