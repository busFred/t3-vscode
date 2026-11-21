import { RuntimeMode, isManagedDriverAllowed, managedPolicyDeniedMessage, managedRuntimeModeDenial } from "@t3tools/contracts";
import { ImageCaptionEditor } from "./ImageCaptionEditor";
import { bridge } from "../bridge-client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, CheckIcon, SquareIcon, ChevronDownIcon, MoreHorizontalIcon, FolderIcon, XIcon, FileIcon, ImageIcon, WandSparklesIcon, ZapIcon, ReplyIcon, MessagesSquareIcon } from "lucide-react";
import type { ComposerSuggestion, HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { PendingRequests } from "./PendingRequests";
import { applySideChatReferences, clearDraft, readDraft, readDraftSelection, registerDraftTextEditor, rememberDraftSelection, takeEditorReferenceFocus, updateDraft, useDraftRecovery, useComposerDraft, type DraftTextEdit } from "../composerDrafts";
import { assistantQuoteLabel, assistantQuoteNumbers, contextIsReferenced, fileReferenceLabel, fileReferenceOccurrences, formatComposerMessage, insertFileReference, insertSideChatReference, removeContextReference, responseRecordsForMessage, sideChatRecordsForMessage, syncAssistantQuoteLabels, type FileReference } from "../../shared/composerContext";
import type { AssistantCitation } from "../../shared/messageCitations.js";
import { applyClaudePromptEffortPrefix, getProviderOptionCurrentValue, isClaudeUltrathinkPrompt } from "@t3tools/shared/model";
import { effortDescriptor, effortOptionLabel, isPremiumSpeed, speedChoiceLabel, speedControl, ultracodeOption } from "../../shared/modelOptions";
import { ModelPicker } from "./ModelPicker";
import { AUTO_COMPOSER_CEILING, ComposerResize, MIN_COMPOSER_HEIGHT, clampComposerHeight } from "./ComposerResize";
import { detectComposerTrigger } from "../../shared/composerSuggestions";
import { replaceTextRange } from "@t3tools/shared/composerTrigger";
import { useBridgeQuery } from "../useBridgeQuery";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { ConversationActivity } from "./ConversationActivity";
import { idleStop, isStopDisabled, reconcileStop, STOP_PENDING_MAX_MS, stopClicked, stopKey, stopLabel, stopTimedOut } from "../../shared/stopPending";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { addDraftAttachments, hasPendingAttachmentWork, pasteAttachments, pasteComposerClipboard, removeDraftAttachment, settleDraftAttachmentsWithin, trackAttachmentWork } from "../composerAttachments";
import { buildComposerClipboard, parseComposerClipboardHtml, type ComposerClipboardPayload } from "../../shared/composerClipboard";
import { writeComposerClipboard } from "../composerClipboard";
import type { DraftAttachment, TextSelection } from "../../shared/composerAttachments";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { openVisual } from "./ChatMedia";
import { formatComposerContextReference, collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { collectAssistantCitations } from "../../shared/messageCitations.js";
import { changesListStructure, continueMarkdownList, formatMarkdown, indentMarkdown, protectMarkdownSelection, renumberMarkdownList, textReplacement, wrapMarkdownSelection, type MarkdownEdit, type MarkdownFormat } from "../../shared/composerEditing";
import { useComposerPreferences } from "../composerPreferences";
import { ComposerFormatting } from "./ComposerFormatting";
import { relabelWorktreeReferences } from "../../shared/worktreeReferences";
import { WorktreeSelector, composerWorktreeLabel } from "./WorktreeSelector";
import { MachineChip, draftMachineAway, draftSendBlock } from "./MachineChip";
import { activeWorktreePreparations, WorktreePreparation } from "./WorktreePreparation";

// Every mode `RuntimeMode` defines; a provider that reports no modes falls back to all of them,
// so each one needs a label.
const runtimeLabels: Record<RuntimeMode, string> = { "approval-required": "Ask permission", "auto-accept-edits": "Auto-accept edits", auto: "Auto", "full-access": "Full access" };
const steerShortcut = navigator.userAgent.includes("Mac") ? "Cmd+Enter" : "Ctrl+Enter";
const openModifier = navigator.userAgent.includes("Mac") ? "Cmd" : "Ctrl";
/** Native editing commands keep a programmatic change in the focused input's own undo stack; `setRangeText` is the last resort and does not. */
function insertNatively(input: HTMLTextAreaElement, start: number, end: number, value: string): void {
  const before = input.value; input.setSelectionRange(start, end);
  if (!document.execCommand(value ? "insertText" : "delete", false, value) && input.value === before) input.setRangeText(value, start, end, "end");
}
export function Composer({ state, onEditCitation, onUsage, onSelectionChange: notifySelection }: { readonly state: HostStateSnapshot; readonly onEditCitation: (citation: AssistantCitation, index: number) => void; readonly onUsage: () => void; readonly onSelectionChange: (selection: TextSelection) => void }) {
  const draftKey = state.activeThreadId ?? "new";
  const [editingPreferences, setEditingPreferences] = useComposerPreferences();
  const onSelectionChange = useCallback((selection: TextSelection) => { rememberDraftSelection(draftKey, selection); notifySelection(selection); }, [draftKey, notifySelection]);
  const recovery = useDraftRecovery(draftKey);
  const { text, contexts, attachments = [] } = useComposerDraft(draftKey);
  const visibleContexts = contexts.map((context, index) => ({ context, index })).filter(({ context }) => contextIsReferenced(text, context));
  const quoteNumbers = useMemo(() => assistantQuoteNumbers(text, contexts), [text, contexts]);
  const [captionReference, setCaptionReference] = useState<{ reference: ReturnType<typeof collectComposerContextReferences>[number]; src?: string | undefined } | null>(null);
  const [peekDismissed, setPeekDismissed] = useState<string | null>(null);
  const touched = useRef(false);
  const markTouched = () => {
    if (touched.current || !state.activeThreadId) return;
    touched.current = true; void bridge.request("composerState", { threadId: state.activeThreadId, touched: true }).catch(() => undefined);
  };
  const setText = (value: string, edit: DraftTextEdit = "keep-focus") => { if (value.length) markTouched(); updateDraft(draftKey, (draft) => ({ ...draft, text: value }), edit); };
  useEffect(() => {
    const threadId = state.activeThreadId; if (!threadId) return;
    void bridge.request("composerState", { threadId, active: true }).catch(() => undefined);
    return () => { void bridge.request("composerState", { threadId, active: false }).catch(() => undefined); };
  }, [state.activeThreadId]);
  useEffect(() => { if (text.length || contexts.length || attachments.length) markTouched(); }, [text, contexts, attachments]);
  const [busy, setBusy] = useState(false);
  /** How long a send waits for in-flight uploads before handing the composer back to the user. */
  const UPLOAD_WAIT_MS = 30_000;
  // T3 0.1.8 predicts a next prompt once a run finishes. Dismissal is per run, so a later
  // suggestion still appears.
  const [dismissedSuggestionRun, setDismissedSuggestionRun] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Picked files wait here until the commit that re-enables the textarea, so their insertion replays into its undo history.
  // The replay runs a frame later: inside React's effect flush, the controlled textarea would be reset after the input event.
  const pickedFiles = useRef<{ draftKey: string; attachments: DraftAttachment[]; selection: { start: number; end: number } } | null>(null);
  const [placingPicked, setPlacingPicked] = useState(false);
  const mounted = useRef(true);
  // A composer unmounted mid-dialog (a thread switch remounts it) still owes the files to the draft they were picked for.
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    const picked = pickedFiles.current; pickedFiles.current = null;
    if (picked) addDraftAttachments(picked.draftKey, picked.attachments, picked.selection);
  }; }, []);
  useEffect(() => {
    const picked = pickedFiles.current;
    if (picking || !picked) return;
    pickedFiles.current = null;
    requestAnimationFrame(() => {
      const cursor = addDraftAttachments(picked.draftKey, picked.attachments, picked.selection);
      if (cursor !== undefined) { setCursor(cursor); placeCursor(cursor); }
      setPlacingPicked(false);
    });
  }, [picking]);
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
  // Holding Ctrl/Cmd turns the caret into a pointer, so it is visible that a click will open rather than edit.
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    const track = (event: KeyboardEvent) => setOpening(event.ctrlKey || event.metaKey);
    const clear = () => setOpening(false);
    window.addEventListener("keydown", track); window.addEventListener("keyup", track); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", track); window.removeEventListener("keyup", track); window.removeEventListener("blur", clear); };
  }, []);
  const run = useActions();
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const selection = thread?.modelSelection ?? state.draft.modelSelection;
  const provider = state.providers.find((item) => item.instanceId === selection?.instanceId);
  const model = provider?.models.find((item) => item.slug === selection?.model);
  const target = thread ? { threadId: thread.id } : {};
  const runtimeMode = thread?.runtimeMode ?? state.draft.runtimeMode;
  const effort = effortDescriptor(model, selection);
  const speed = speedControl(model, selection);
  const speedLabel = speed?.current ? speedChoiceLabel(speed.current) : speed?.explicit ? "Unavailable" : "Default";
  const promptEffort = effort?.promptInjectedValues?.includes("ultrathink") && isClaudeUltrathinkPrompt(text);
  const modelLabel = model?.name ?? selection?.model ?? "Choose model";

  const effortValue = promptEffort ? "ultrathink" : String(effort ? getProviderOptionCurrentValue(effort) ?? "" : "");
  const effortLabel = effort?.options.find((option) => option.id === effortValue)?.label ?? "Default";
  // The trigger carries the effort so it stays readable without opening the picker.
  const triggerLabel = effort && effortValue ? `${modelLabel} · ${effortLabel}` : modelLabel;
  const project = state.projects.find((item) => item.id === state.draft.projectId);
  const projectLabel = project?.title ?? state.draft.workspaceRoot?.split(/[\\/]/).filter(Boolean).at(-1)
    ?? (state.draft.supportsNoProject ? "No project" : "Choose project");
  const preparations = activeWorktreePreparations(state);
  // A new chat bound for a machine that dropped, or waiting for a clone there, keeps its draft; sending waits until it is ready.
  const policyBlock = managedRuntimeModeDenial(state.managedPolicy, runtimeMode) ?? (provider && state.managedPolicy && !isManagedDriverAllowed(state.managedPolicy, provider.driver) ? managedPolicyDeniedMessage(state.managedPolicy.organization, `${provider.driver} providers`) : undefined);
  const sendBlock = policyBlock ?? draftSendBlock(state);
  const setupBlocked = preparations.some((item) => !item.background && item.phase !== "ready") || !!sendBlock;
  const worktreeLabel = composerWorktreeLabel(state);
  const workspace = state.draft.workspace;
  const draftCheckout = !thread || thread.canChooseWorkspace;
  const referenceCheckoutRoot = draftCheckout && workspace && workspace.type !== "root"
    ? workspace.type === "existing" ? workspace.path ?? null
      : workspace.type === "branch" ? state.worktrees?.branches.find((item) => item.projectId === (thread?.projectId ?? state.draft.projectId) && item.name === workspace.branch)?.path ?? null : null
    : thread?.worktreePath ?? state.projects.find((item) => item.id === (thread?.projectId ?? state.draft.projectId))?.workspaceRoot ?? state.draft.workspaceRoot;
  const disabled = !recovery.ready || busy || state.sending || thread?.archived === true || thread?.providerNativeSubagent === true;
  /**
   * A message in flight must not toggle the textarea's `disabled` attribute: doing so clears the
   * element's native undo stack, so a send that then failed silently cost the user their history.
   * `readOnly` blocks edits the same way while leaving that stack — and the caret — intact, and it
   * still prevents typing during the send, so a successful clear cannot discard text typed meanwhile.
   */
  const inFlight = busy || state.sending;
  // Restoring a draft holds the field read-only for the same reason. The first send in a new chat
  // moves the draft key from "new" to the thread's id, and the new key starts out restoring; as a
  // `disabled` toggle that wiped the undo stack on every first send. Insertions still refuse while
  // restoring: paste and files check `disabled`, and programmatic edits bail on `readOnly`.
  const restoring = !recovery.ready;
  const inputDisabled = thread?.archived === true || thread?.providerNativeSubagent === true;
  const inputSelection = (): TextSelection => ({ start: textarea.current?.selectionStart ?? text.length, end: textarea.current?.selectionEnd ?? text.length });
  const editing = useRef(false);
  const numberingUndo = useRef<{ before: string; after: string; selection: TextSelection } | null>(null);
  const historyText = useRef<string | null>(null);
  const repairNumbering = () => {
    const input = textarea.current;
    if (!input || !editingPreferences.listAssist) return;
    const selection = inputSelection(), edit = renumberMarkdownList(input.value, selection);
    if (edit) { numberingUndo.current = { before: input.value, after: input.value.slice(0, edit.start) + edit.text + input.value.slice(edit.end), selection }; applyEdit(edit); }
  };
  const applyEdit = (edit: MarkdownEdit | null, structural = false) => {
    const input = textarea.current;
    if (!edit || !input || disabled || picking) return;
    input.focus(); editing.current = true;
    insertNatively(input, edit.start, edit.end, edit.text);
    setText(input.value); setCursor(edit.selection.start); setDismissedTrigger(null);
    input.setSelectionRange(edit.selection.start, edit.selection.end); onSelectionChange(edit.selection);
    editing.current = false;
    if (structural) repairNumbering();
  };
  // A draft write React applies by assigning `value` discards the undo history of this textarea, so every
  // programmatic change is replayed into it as an edit instead. Unfocused or unmounted, the store write still stands.
  const editText = useCallback((previous: string, next: string, mode: DraftTextEdit) => {
    const input = textarea.current;
    if (!input || input.disabled || input.readOnly || !input.isConnected || input.value !== previous) return;
    // "borrow-focus" edits an unfocused field natively too, then hands focus back to whatever held it.
    const borrowing = mode === "borrow-focus" && document.activeElement !== input;
    const giveBackTo = borrowing && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (document.activeElement !== input) {
      // Focusing an input in a webview the person is not using could pull keystrokes away from their editor, so a
      // background carry-over is then a plain draft write: the text still lands, without a native undo step.
      if (mode === "keep-focus" || (mode === "borrow-focus" && !document.hasFocus())) return;
      input.focus({ preventScroll: mode === "borrow-focus" }); if (document.activeElement !== input) return;
    }
    const edit = textReplacement(previous, next);
    editing.current = true;
    insertNatively(input, edit.start, edit.end, edit.text);
    editing.current = false;
    if (giveBackTo?.isConnected) giveBackTo.focus({ preventScroll: true }); else if (borrowing) input.blur();
  }, []);
  useEffect(() => registerDraftTextEditor(draftKey, editText), [draftKey, editText]);
  const applyFormat = (format: MarkdownFormat) => {
    const protectedSelection = protectMarkdownSelection(text, inputSelection(), [...collectComposerContextReferences(text), ...collectAssistantCitations(text), ...fileReferenceOccurrences(text, contexts)]);
    applyEdit(formatMarkdown(text, protectedSelection, format));
  };
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
  // Committing a new value drops the textarea's selection. Restoring it before the browser paints,
  // rather than a frame later, keeps a keystroke in that frame from landing back at the old caret.
  const pendingCaret = useRef<{ position: number; end?: number; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingCaret.current; const input = textarea.current;
    if (!pending || !input) return;
    pendingCaret.current = null;
    if (pending.focus) input.focus();
    const position = Math.min(input.value.length, pending.position);
    input.setSelectionRange(position, Math.min(input.value.length, pending.end ?? position));
  });
  // A quote's token carries its number and comment, which change when quotes are added, removed or edited.
  // Declared after the effect above, which would otherwise consume the caret before the new text lands.
  useLayoutEffect(() => {
    // Rewriting what an undo just restored would queue a fresh edit for the next undo to reach, so history wins and the label settles on the next edit.
    if (!recovery.ready || text === historyText.current) return;
    const synced = syncAssistantQuoteLabels(text, contexts); if (!synced) return;
    const input = textarea.current;
    const caret = { start: synced.map(input?.selectionStart ?? text.length), end: synced.map(input?.selectionEnd ?? text.length) };
    updateDraft(draftKey, (draft) => draft.text === text ? { ...draft, text: synced.text } : draft, "keep-focus");
    pendingCaret.current = { position: caret.start, end: caret.end, focus: false };
    setCursor(caret.start); onSelectionChange(caret);
  }, [text, contexts, recovery.ready, draftKey, onSelectionChange]);
  useLayoutEffect(() => {
    if (!recovery.ready) return;
    const synced = relabelWorktreeReferences(text, contexts, referenceCheckoutRoot);
    if (!synced) return;
    const input = textarea.current;
    const caret = { start: synced.map(input?.selectionStart ?? text.length), end: synced.map(input?.selectionEnd ?? text.length) };
    updateDraft(draftKey, (draft) => draft.text === text ? { ...draft, text: synced.text, contexts: synced.contexts } : draft, "keep-focus");
    pendingCaret.current = { position: caret.start, end: caret.end, focus: false };
    setCursor(caret.start); onSelectionChange(caret);
  }, [text, contexts, referenceCheckoutRoot, recovery.ready, draftKey, onSelectionChange]);
  const placeCursor = (position: number, focus = false) => { pendingCaret.current = { position, focus }; };
  const focusCursor = (position: number) => placeCursor(position, true);
  useEffect(() => {
    if (disabled) return;
    const insert = () => {
      const position = applySideChatReferences(draftKey);
      if (position === undefined || !textarea.current) return;
      textarea.current.setSelectionRange(position, position);
      setCursor(position);
    };
    const receive = (event: Event) => { if ((event as CustomEvent<string>).detail === draftKey) insert(); };
    window.addEventListener("t3-insert-side-chat", receive);
    insert();
    return () => window.removeEventListener("t3-insert-side-chat", receive);
  }, [draftKey, disabled]);
  const chooseSuggestion = (item: ComposerSuggestion) => {
    if (!trigger) return;
    if (item.kind === "thread" && item.threadContext) {
      const inserted = insertSideChatReference(text, contexts, item.threadContext, { start: trigger.rangeStart, end: trigger.rangeEnd });
      markTouched(); updateDraft(draftKey, (draft) => ({ ...draft, text: inserted.text, contexts: inserted.contexts }), "take-focus");
      setCursor(inserted.cursor); setDismissedTrigger(triggerKey); focusCursor(inserted.cursor); return;
    }
    if (item.kind === "file" || item.kind === "directory") {
      // The relative path is the label, so three different `index.ts` stay distinguishable in the chips.
      const reference: FileReference = { type: "file", uri: item.uri ?? item.value, path: item.value, label: item.value };
      const inserted = insertFileReference(text, contexts, reference, { start: trigger.rangeStart, end: trigger.rangeEnd });
      markTouched(); updateDraft(draftKey, (draft) => ({ ...draft, text: inserted.text, contexts: inserted.contexts }), "take-focus");
      setCursor(inserted.cursor); setDismissedTrigger(triggerKey); focusCursor(inserted.cursor); return;
    }
    const next = replaceTextRange(text, trigger.rangeStart, trigger.rangeEnd, item.value);
    setText(next.text, item.kind === "model" || item.kind === "usage" ? "keep-focus" : "take-focus"); setCursor(next.cursor); setDismissedTrigger(triggerKey);
    if (item.kind === "model") setModelsOpen(true);
    else if (item.kind === "usage") onUsage();
    else focusCursor(next.cursor);
  };
  useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ draftKey?: string; cursor?: number }>).detail;
      if (detail?.draftKey && detail.draftKey !== draftKey) return;
      const pendingCursor = takeEditorReferenceFocus(draftKey);
      const nextCursor = detail?.cursor ?? pendingCursor;
      const input = textarea.current;
      requestAnimationFrame(() => {
        if (!input || input !== textarea.current) return;
        input.focus();
        const remembered = nextCursor === undefined ? readDraftSelection(draftKey) : { start: nextCursor, end: nextCursor };
        if (remembered) {
          const selection = { start: Math.min(input.value.length, remembered.start), end: Math.min(input.value.length, remembered.end) };
          input.setSelectionRange(selection.start, selection.end); setCursor(selection.start); onSelectionChange(selection);
        }
      });
    }; window.addEventListener("t3-focus-composer", focus);
    const pending = takeEditorReferenceFocus(draftKey);
    if (pending !== undefined) focus(new CustomEvent("t3-focus-composer", { detail: { draftKey, cursor: pending } }));
    return () => window.removeEventListener("t3-focus-composer", focus);
  }, [draftKey, onSelectionChange]);
  // A height dragged with the grip holds while the text changes; otherwise the box grows with the text.
  const [liveHeight, setLiveHeight] = useState<number | null | undefined>(undefined);
  const chosenHeight = liveHeight !== undefined ? liveHeight : editingPreferences.height === null ? null : clampComposerHeight(editingPreferences.height);
  useEffect(() => {
    if (!textarea.current) return;
    if (chosenHeight !== null) {
      textarea.current.style.maxHeight = textarea.current.style.height = `${chosenHeight}px`;
      return;
    }
    textarea.current.style.maxHeight = "";
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, AUTO_COMPOSER_CEILING)}px`;
  }, [text, state.appearance.fontSizePrompt, chosenHeight]);
  useEffect(() => { setModelsOpen(false); }, [draftKey]);
  useEffect(() => { if (recovery.ready && textarea.current) { const selection = readDraftSelection(draftKey); if (selection) { textarea.current.setSelectionRange(selection.start, selection.end); setCursor(selection.start); } } }, [draftKey, recovery.ready]);
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
      const modelWidth = context.measureText(triggerLabel).width + 22 + (isPremiumSpeed(speed?.current) ? 16 : 0);
      const style = getComputedStyle(row);
      context.font = `400 ${style.fontSize} ${style.fontFamily}`;
      const traitsWidth = context.measureText(runtimeLabels[runtimeMode] ?? runtimeMode).width + 24
        + (state.worktrees && (state.draft.projectId || thread?.projectId) ? context.measureText(worktreeLabel).width + 44 : 0);
      setCompactControls(modelWidth + traitsWidth + 12 > row.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row); measure();
    return () => observer.disconnect();
  }, [triggerLabel, speedLabel, runtimeMode, worktreeLabel, Boolean(state.worktrees), state.draft.projectId, thread?.projectId, state.appearance.fontSizeInterface]);
  const running = Boolean(thread?.activeRunId || state.queue?.activeRunId || state.acknowledgedWorking);
  const canStop = running || Boolean(thread?.waitingOnSubagents || thread?.backgroundWork);
  // Stop shows "Stopping…" and ignores repeat clicks until the run stops, the run changes, or 10 s pass.
  const currentStopKey = stopKey(thread?.id, thread?.activeRunId ?? state.queue?.activeRunId);
  const [storedStop, setStoredStop] = useState(() => idleStop(currentStopKey));
  const stop = reconcileStop(storedStop, currentStopKey, canStop);
  if (stop !== storedStop) setStoredStop(stop);
  useEffect(() => {
    if (stop.phase !== "pending") return;
    const timer = setTimeout(() => setStoredStop((current) => stopTimedOut(current, currentStopKey)), STOP_PENDING_MAX_MS);
    return () => clearTimeout(timer);
  }, [stop.phase, currentStopKey]);
  const stopping = isStopDisabled(stop);
  const shortcutHint = `${running ? `Enter to queue${state.queue?.canSteer ? ` · ${steerShortcut} to steer` : ""}` : "Enter to send"} · Shift+Enter for a new line`;
  // Never over a draft the user is writing, never while sending, and not once dismissed.
  const suggested = state.promptSuggestion;
  const promptSuggestion = suggested && !text.trim() && !attachments.length && !disabled && !setupBlocked
    && suggested.runId !== dismissedSuggestionRun && suggested.text.trim() ? suggested : null;
  const send = async (steer = false) => {
    if ((!formatComposerMessage(text, contexts) && !attachments.length) || disabled || setupBlocked || !selection || picking || placingPicked) return;
    setBusy(true);
    // T3 0.1.9 sends while attachments upload. The server still needs every attachment id, so the
    // send waits out the in-flight uploads instead of the button refusing the click. The draft and
    // its text stay put meanwhile, so a failure below leaves the message recoverable.
    if (hasPendingAttachmentWork(draftKey) || attachments.some((file) => file.pending)) {
      setAttachmentError(null);
      // Bounded: the composer is read-only while this send owns it, so a stalled upload must not
      // hold it indefinitely. The uploads continue regardless, so sending again later still works.
      if (!await settleDraftAttachmentsWithin(draftKey, UPLOAD_WAIT_MS)) {
        setAttachmentError("Still uploading. Send again once the attachments finish, or remove them.");
        setBusy(false); textarea.current?.focus(); return;
      }
    }
    // Re-read the whole draft after settling, not just its attachments. An editor reference can be
    // added from outside the composer while the send waits (`addEditorReference` is not gated on
    // composer state), and the wait is now up to 30s rather than one round trip. Sending the text
    // captured before the wait and then clearing the draft would discard that reference silently.
    const draft = readDraft(draftKey);
    const settled = draft.attachments ?? [];
    const value = formatComposerMessage(draft.text, draft.contexts ?? contexts);
    const unusable = settled.filter((file) => file.pending || !file.attachment);
    if (unusable.length) {
      // Never send a message that silently drops the files it refers to.
      const failed = unusable.find((file) => file.error);
      setAttachmentError(failed?.error ?? `Could not upload ${unusable.map((file) => file.name).join(", ")}.`);
      setBusy(false); textarea.current?.focus(); return;
    }
    const mode = resolveComposerDispatchMode({ running, activeTurnDefault: "queue", alternateModifier: steer && state.queue?.canSteer === true });
    const sent = await run("sendMessage", { text: value, mode, attachmentIds: settled.map((file) => file.attachment!.id), attachmentReferences: settled.flatMap((file) => file.contextId ? [{ contextId: file.contextId, attachmentId: file.attachment!.id }] : []), responseRecords: responseRecordsForMessage(value, draft.contexts ?? contexts), threadRecords: sideChatRecordsForMessage(value, draft.contexts ?? contexts), ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}) });
    if (sent) clearDraft(draftKey);
    setBusy(false); textarea.current?.focus();
  };
  const addFiles = (files: ReadonlyArray<File>, useSelectedTextAsImageDescription = false) => {
    if (disabled || !files.length) return;
    markTouched(); setAttachmentError(null);
    const selection = { start: textarea.current?.selectionStart ?? text.length, end: textarea.current?.selectionEnd ?? text.length };
    void pasteAttachments(draftKey, files, state.activeThreadId, selection, (cursor) => {
      setCursor(cursor); placeCursor(cursor);
    }, { useSelectedTextAsImageDescription }).catch((cause) => setAttachmentError(cause instanceof Error ? cause.message : String(cause)));
  };
  const pasteClipboard = (payload: ComposerClipboardPayload) => {
    if (disabled) return;
    markTouched(); setAttachmentError(null);
    void pasteComposerClipboard(draftKey, payload, state.activeThreadId, inputSelection(), (cursor) => {
      setCursor(cursor); placeCursor(cursor);
    }).catch((cause) => setAttachmentError(cause instanceof Error ? cause.message : String(cause)));
  };
  // A selection holding references is copied with what backs them; anything else is left to the browser.
  const copySelection = (event: React.ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    const input = event.currentTarget;
    const clip = buildComposerClipboard({ text: input.value, contexts, attachments }, { start: input.selectionStart, end: input.selectionEnd }, state.clipboardNonce);
    if (!clip || !writeComposerClipboard(event.nativeEvent, clip)) return;
    if (cut) applyEdit({ start: clip.range.start, end: clip.range.end, text: "", selection: { start: clip.range.start, end: clip.range.start } });
  };
  const pickFiles = () => {
    const selection = { start: textarea.current?.selectionStart ?? text.length, end: textarea.current?.selectionEnd ?? text.length };
    setPicking(true); setAttachmentError(null);
    void trackAttachmentWork(draftKey, bridge.request<{ attachments: DraftAttachment[]; errors: string[] }>("pickAttachments", undefined, 10 * 60_000).then((result) => {
      if (result.attachments.length) {
        markTouched();
        if (mounted.current) { pickedFiles.current = { draftKey, attachments: result.attachments, selection }; setPlacingPicked(true); }
        else addDraftAttachments(draftKey, result.attachments, selection);
      }
      setAttachmentError(result.errors.join("\n") || null);
    })).catch((cause) => setAttachmentError(cause instanceof Error ? cause.message : String(cause))).finally(() => { setPicking(false); textarea.current?.focus(); });
  };
  // A whole-file reference has no position to carry, so it opens the file as-is.
  const openFileReference = (context: FileReference) => run("openLink", { href: context.range ? `${context.uri}:${context.range.start.line}:${context.range.start.column}` : context.uri });
  const activateInlineReference = (position: number): boolean => {
    const fileContext = fileReferenceOccurrences(text, contexts).find(ref => ref.start <= position && position < ref.end)?.context;
    if (fileContext) { void openFileReference(fileContext); return true; }
    const reference = collectComposerContextReferences(text).find((ref) => ref.start <= position && position < ref.end);
    if (reference?.kind === "thread") {
      const context = contexts.find(context => context.type === "thread" && context.record.contextId === reference.contextId);
      if (context?.type === "thread") { void run("openSessionTab", { threadId: context.record.threadId, environmentId: context.record.environmentId }); return true; }
    }
    if (reference?.kind === "response") {
      const context = contexts.find((context) => context.type === "response" && context.record.contextId === reference.contextId);
      if (context?.type === "response") { window.dispatchEvent(new CustomEvent("t3-open-citation", { detail: context.record.citation })); return true; }
    }
    if (reference?.kind === "assistant-quote") {
      const index = contexts.findIndex((context) => context.type === "assistant" && context.contextId === reference.contextId);
      const context = contexts[index];
      if (context?.type === "assistant") { onEditCitation(context.citation, index); return true; }
    }
    const file = reference?.kind === "image" ? attachments.find((file) => file.contextId === reference.contextId) : undefined;
    if (file && reference) { setCaptionReference({ reference, src: file.previewUrl }); return true; }
    return false;
  };
  // Effort, speed and Ultracode belong to the chosen model, so they live in the model picker (a
  // Reasoning column and its footer) rather than as three more selects in the composer row.
  // Choosing Ultrathink still edits the prompt exactly as before; this only moves where it is offered.
  const optionsDisabled = busy || thread?.providerNativeSubagent || !selection;
  const chooseEffort = (value: string) => {
    if (!effort) return;
    // Re-applying Ultrathink while the prompt already carries it would rewrite the text and add an undo
    // step. Any other level may be re-sent: choosing the model's shown default pins it explicitly.
    if (promptEffort && value === "ultrathink") return;
    if (effort.promptInjectedValues?.includes(value)) {
      closeModels();
      setText(text.trim() ? applyClaudePromptEffortPrefix(text, "ultrathink") : "Ultrathink:\n", "take-focus"); return;
    }
    if (promptEffort) {
      const body = text.replace(/^Ultrathink:\s*/i, "");
      if (isClaudeUltrathinkPrompt(body)) return;
      setText(body, "take-focus");
    }
    setBusy(true); void run("setModelOption", { ...target, optionId: effort.id, value }).finally(() => setBusy(false));
  };
  const ultracode = ultracodeOption(model, selection);
  const pickerExtras = {
    reasoning: effort ? <div role="group" aria-label="Effort level" data-value={effortValue} title={effort.description ?? effort.label}><header>Reasoning</header>
      {effort.options.map((option) => <div className="model-row" key={option.id}><button className="model-choice" data-value={option.id} aria-pressed={option.id === effortValue} title={option.description} disabled={optionsDisabled} onClick={() => chooseEffort(option.id)}>
        <span>{effortOptionLabel(option)}</span>{option.id === effortValue ? <CheckIcon size={13} /> : null}</button></div>)}</div> : null,
    footer: <>
      {speed ? <label className={`speed-control${isPremiumSpeed(speed.current) ? " premium" : ""}`} title={isPremiumSpeed(speed.current) ? `${speed.current!.description ?? speed.current!.label}: costs more per request` : speed.label}>Speed{isPremiumSpeed(speed.current) ? <ZapIcon size={12} aria-hidden="true" /> : null}<select aria-label="Speed" value={speed.current?.id ?? ""} disabled={optionsDisabled} onChange={(event) => {
        const choice = speed.choices.find((item) => item.id === event.target.value); if (!choice) return;
        setBusy(true); void run("setModelOption", { ...target, optionId: speed.optionId, value: choice.value }).finally(() => setBusy(false));
      }}>{speed.current ? null : <option value="" disabled>{speed.explicit ? "Unavailable" : "Default"}</option>}{speed.choices.map((choice) => <option key={choice.id} value={choice.id} title={choice.description}>{speedChoiceLabel(choice)}</option>)}</select></label> : null}
      {ultracode ? <label title={ultracode.description ?? ultracode.label}>{ultracode.label}<select aria-label={ultracode.label} value={ultracode.value ? "on" : "off"} disabled={optionsDisabled} onChange={(event) => {
        setBusy(true); void run("setModelOption", { ...target, optionId: ultracode.id, value: event.target.value === "on" }).finally(() => setBusy(false));
      }}><option value="off">Off</option><option value="on">On</option></select></label> : null}
    </>,
  };
  const traits = <div className="composer-traits">
    <select aria-label="Permission mode" value={runtimeMode} disabled={busy || thread?.providerNativeSubagent || !selection} onChange={(event) => { void run("setModes", { ...target, runtimeMode: event.target.value }); }}>{(provider?.supportedRuntimeModes?.length ? provider.supportedRuntimeModes : RuntimeMode.literals).map((mode) => <option key={mode} value={mode} disabled={!!managedRuntimeModeDenial(state.managedPolicy, mode)} title={managedRuntimeModeDenial(state.managedPolicy, mode)}>{runtimeLabels[mode]}</option>)}</select>
    {state.remoteSession ? null : <WorktreeSelector state={state} disabled={busy || state.sending || thread?.providerNativeSubagent === true} />}
  </div>;
  return <div className="composer-area"><div className="composer-column">
    <PendingRequests state={state} />
    {recovery.error ? <p className="composer-attachment-error" role="alert">{recovery.error}</p> : null}
    <ConversationActivity key={draftKey} state={state} />
    {preparations.filter((item) => item.phase !== "ready" || item.backgroundRunning).map((preparation) => <WorktreePreparation key={preparation.id} preparation={preparation} />)}
    {thread?.archived ? <div className="archived-banner">This thread is archived.<button className="text-button" onClick={() => { void run("threadAction", { threadId: thread.id, action: "unarchive" }); }}>Restore thread</button></div> : null}
    {thread?.providerNativeSubagent ? <p className="subagent-readonly" role="status">This conversation is controlled by its provider. Send instructions in the parent conversation.</p> : null}
    <MachineChip state={state} disabled={busy || state.sending} />
    <div className="composer-box" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]); } }}>
      <ComposerResize height={chosenHeight} measure={() => textarea.current?.offsetHeight ?? MIN_COMPOSER_HEIGHT} onLive={setLiveHeight} onCommit={(height) => { setEditingPreferences({ height }); setLiveHeight(undefined); }} />
      <ComposerFormatting disabled={disabled || picking} listAssist={editingPreferences.listAssist} contextUsage={state.contextUsage} onListAssist={() => setEditingPreferences({ listAssist: !editingPreferences.listAssist })} onAttach={pickFiles} onFormat={applyFormat} onIndent={(outdent) => applyEdit(indentMarkdown(text, inputSelection(), outdent, true), true)} />
      {promptSuggestion ? <div className="prompt-suggestion"><button type="button" className="prompt-suggestion-apply" title="Use this prompt" aria-label={`Use suggested prompt: ${promptSuggestion.text}`} onClick={() => {
        // Through applyEdit, so the insertion joins the textarea's own undo history.
        applyEdit({ start: 0, end: text.length, text: promptSuggestion.text, selection: { start: promptSuggestion.text.length, end: promptSuggestion.text.length } });
        setDismissedSuggestionRun(promptSuggestion.runId);
      }}><WandSparklesIcon size={12} /><span>{promptSuggestion.text}</span></button>
        <button type="button" className="icon-button" aria-label="Dismiss suggested prompt" onClick={() => setDismissedSuggestionRun(promptSuggestion.runId)}><XIcon size={12} /></button></div> : null}
      {suggestionsOpen ? <ComposerSuggestions items={items} selected={highlighted} pending={suggestions.pending} error={suggestions.error} onSelect={chooseSuggestion} onHighlight={setSuggestionIndex} /> : null}
      {attachments.length || visibleContexts.length ? <div className="composer-chips" role="group" aria-label="Message attachments and references">
        {attachments.map((file) => {
          const lead = <>{file.previewUrl ? <img className="attachment-thumb" src={file.previewUrl} alt="" /> : file.mimeType.startsWith("image/") ? <ImageIcon size={12} /> : <FileIcon size={12} />}<span className="attachment-name">{file.name}</span></>;
          return <div className={`composer-chip composer-attachment${file.error ? " attachment-failed" : ""}`} key={file.key} data-peek={peekDismissed === file.key ? "off" : undefined} title={`${file.name} · ${formatAttachmentSize(file.sizeBytes)}${file.error ? `\n${file.error}` : ""}`}
            onKeyDown={(event) => { if (event.key === "Escape" && file.previewUrl) setPeekDismissed(file.key); }} onMouseLeave={() => setPeekDismissed(null)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPeekDismissed(null); }}>
            {file.previewUrl ? <button className="attachment-preview" aria-label={`Preview ${file.name}`} onClick={() => openVisual({ title: file.name, src: file.previewUrl! })}>{lead}</button> : <span className="attachment-preview">{lead}</span>}
            <span className="attachment-state">{file.pending ? "Uploading…" : file.error ? "Upload failed" : formatAttachmentSize(file.sizeBytes)}</span>
            {file.previewUrl ? <span className="attachment-peek" aria-hidden="true"><img src={file.previewUrl} alt="" /></span> : null}
            <button className="icon-button remove-attachment" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => { void removeDraftAttachment(draftKey, file.key).catch((cause) => setAttachmentError(String(cause))); }}><XIcon size={12} /></button>
          </div>;
        })}
        {visibleContexts.map(({ context, index }) => context.type === "thread" ? <div className="composer-chip context-chip reply-chip" key={index}>
          <button className="context-label" title={context.record.title} onClick={() => { void run("openSessionTab", { threadId: context.record.threadId, environmentId: context.record.environmentId }); }}><MessagesSquareIcon size={12} aria-hidden="true" /><span className="context-label-text">Side chat: {context.record.title}</span></button>
          <button className="icon-button" aria-label="Remove side chat reference" disabled={busy} onClick={() => updateDraft(draftKey, draft => ({ ...draft, text: removeContextReference(draft.text, context) }), "take-focus")}><XIcon size={12} /></button>
        </div> : context.type === "response" ? <div className="composer-chip context-chip reply-chip" key={index}>
          {/* Opens the response it replies to, like the source button on a quote. */}
          <button className="context-label" title={context.record.citation.text} onClick={() => window.dispatchEvent(new CustomEvent("t3-open-citation", { detail: context.record.citation }))}><ReplyIcon size={12} aria-hidden="true" /><span className="context-label-text">{context.record.subagents?.length ? `Replying to ${context.record.subagents.map((subagent) => subagent.title).join(", ")}: ` : "Replying to: "}{context.record.label}</span></button>
          <button className="icon-button" aria-label="Cancel reply" disabled={busy} onClick={() => updateDraft(draftKey, (draft) => ({ ...draft, text: removeContextReference(draft.text, context), contexts: draft.contexts.filter((_, position) => position !== index) }), "keep-focus")}><XIcon size={12} /></button>
        </div> : <div className="composer-chip context-chip" key={index}>
          <button className="context-label" data-quoted={context.type === "assistant" && context.citation.comment === undefined} title={context.type === "file" ? context.text || context.path : `${context.citation.text}${context.citation.comment ? `\nComment: ${context.citation.comment}` : ""}`} onClick={() => {
            if (context.type === "assistant") onEditCitation(context.citation, index);
            else void openFileReference(context);
          }}>{context.type === "file" ? `@${fileReferenceLabel(context)}` : assistantQuoteLabel(context.citation, quoteNumbers[index] ?? index + 1)}</button>
          {/* Disabled while a send owns the draft, like the attachment control: removing a chip mid-send
              would drop it from the draft while the message still carries its marker. */}
          <button className="icon-button" aria-label={`Remove reference ${index + 1}`} disabled={busy} onClick={() => updateDraft(draftKey, (draft) => ({ ...draft, text: removeContextReference(draft.text, context), contexts: draft.contexts.filter((_, position) => position !== index) }), "keep-focus")}><XIcon size={12} /></button>
        </div>)}
      </div> : null}
      {attachmentError ? <div className="composer-attachment-error" role="alert">{attachmentError}</div> : null}
      <textarea ref={textarea} data-opening={opening || undefined} value={text} placeholder={running ? "Send a follow-up…" : "Ask anything, or describe a task…"} aria-label="Message" title={shortcutHint} aria-description={`${openModifier}+click a file reference to open its source, an image reference to preview it or a quote reference to edit its comment; Alt+Enter opens the reference at the cursor. A plain click only moves the caret, so a reference can be edited by hand.`} disabled={inputDisabled || picking} readOnly={inFlight || restoring} rows={2}
        onBlur={(event) => onSelectionChange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
        onClick={(event) => {
          // Opening a reference moves the focus away, so the caret it was opened from is remembered here rather than on blur.
          onSelectionChange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
          if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return;
          // A plain click only places the caret, so a path can be retyped by hand — a file the suggestion
          // list will never offer, such as one that is gitignored. Ctrl/Cmd+click opens it instead.
          if (event.ctrlKey || event.metaKey) activateInlineReference(event.currentTarget.selectionStart);
        }}
        onCopy={(event) => copySelection(event, false)} onCut={(event) => copySelection(event, true)}
        onPaste={(event) => {
          // Our own HTML carries the references, so it wins over the bitmap a single copied image also puts on the clipboard.
          const html = event.clipboardData.types.includes("text/html") ? event.clipboardData.getData("text/html") : "";
          const payload = html.includes("data-t3-composer=") ? parseComposerClipboardHtml(html, state.clipboardNonce) : undefined;
          if (payload) { event.preventDefault(); pasteClipboard(payload); return; }
          const files = event.clipboardData.files.length ? [...event.clipboardData.files] : [...event.clipboardData.items].map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => file !== null);
          if (files.length) { event.preventDefault(); addFiles(files, true); }
        }}
        aria-controls={suggestionsOpen ? "composer-suggestions" : undefined} aria-expanded={suggestionsOpen} aria-autocomplete="list" aria-activedescendant={suggestionsOpen && items.length ? `composer-suggestion-${highlighted}` : undefined}
        onSelect={(event) => { setCursor(event.currentTarget.selectionStart); onSelectionChange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }); }} onChange={(event) => {
          const value = event.target.value, type = (event.nativeEvent as InputEvent).inputType ?? "";
          const repair = !editing.current && editingPreferences.listAssist && changesListStructure(text, value, type);
          const automatic = numberingUndo.current;
          if (automatic && (type === "historyUndo" && value === automatic.before || type === "historyRedo" && value === automatic.after)) event.target.setSelectionRange(automatic.selection.start, automatic.selection.end);
          if (type === "historyUndo" || type === "historyRedo") historyText.current = value;
          setText(value); setCursor(event.target.selectionStart); onSelectionChange({ start: event.target.selectionStart, end: event.target.selectionEnd }); setDismissedTrigger(null);
          if (repair) requestAnimationFrame(() => { if (textarea.current?.value === value) repairNumbering(); });
        }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" && event.altKey) {
          if (activateInlineReference(event.currentTarget.selectionStart)) { event.preventDefault(); return; }
        }
        if (suggestionsOpen && !event.nativeEvent.isComposing) {
          if (event.key === "Escape") { event.preventDefault(); setDismissedTrigger(triggerKey); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSuggestionIndex(items.length ? (highlighted + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0); return; }
          if ((event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) || (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey)) { event.preventDefault(); if (items[highlighted]) chooseSuggestion(items[highlighted]); return; }
        }
        if (!event.altKey && !event.ctrlKey && !event.metaKey) {
          const selection = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
          const edit = event.key === "Tab" ? indentMarkdown(text, selection, event.shiftKey)
            : event.key === "Enter" && event.shiftKey && editingPreferences.listAssist ? continueMarkdownList(text, selection) : null;
          if (edit) { event.preventDefault(); applyEdit(edit, true); return; }
          const protectedSelection = protectMarkdownSelection(text, selection, [...collectComposerContextReferences(text), ...collectAssistantCitations(text), ...fileReferenceOccurrences(text, contexts)]);
          const wrapped = wrapMarkdownSelection(text, protectedSelection, event.key);
          if (wrapped) { event.preventDefault(); applyEdit(wrapped); return; }
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ["b", "i"].includes(event.key.toLowerCase())) {
          event.preventDefault(); applyFormat(event.key.toLowerCase() === "b" ? "bold" : "italic"); return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event.ctrlKey || event.metaKey); }
      }} />
      {!selection && !draftMachineAway(state) ? <div className="composer-hint">No models available. Configure a provider in T3 Code.</div> : null}
      {/* The project is fixed by the window's folder or the chosen machine; the chip appears only with several folders, or none. */}
      {!thread && !state.draft.environmentId && state.workspaceRoots.length !== 1 ? <div className="composer-project"><button className="project-trigger" aria-label="Choose project" title={state.draft.workspaceRoot ?? projectLabel} disabled={busy || state.workspaceRoots.length === 1 || !!state.draft.environmentId} onClick={() => {
        setBusy(true); void run("chooseProject").finally(() => setBusy(false));
      }}><FolderIcon size={12} /><span>{projectLabel}</span><ChevronDownIcon size={11} /></button></div> : null}
      <div className="composer-bottom">
        <div ref={controls} className="composer-controls">
          <button ref={modelTrigger} className="model-trigger" title={triggerLabel} data-effort={effortValue || undefined} disabled={busy || thread?.providerNativeSubagent} onClick={() => setModelsOpen(!modelsOpen)} aria-expanded={modelsOpen} aria-label="Choose model">{isPremiumSpeed(speed?.current) ? <ZapIcon size={12} aria-hidden="true" /> : null}<span>{triggerLabel}</span><ChevronDownIcon size={12} /></button>
          {modelsOpen && modelTrigger.current ? <ModelPicker state={state} selection={selection} anchor={modelTrigger.current} onClose={closeModels} extras={pickerExtras} /> : null}
          {compactControls ? <details ref={overflow} className="composer-options-overflow" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary className="icon-button" aria-label="Permissions and worktree" title="Permissions and worktree"><MoreHorizontalIcon size={16} /></summary><div className="composer-options-popup">{traits}</div></details> : traits}
        </div>
        <div className="composer-send-controls">
          {sendBlock ? <span className="composer-shortcuts" role="status"><span>{sendBlock === "Send when it reconnects" ? "Your draft is kept" : sendBlock}</span><span>{sendBlock === "Send when it reconnects" ? sendBlock : "Your draft is kept"}</span></span>
            : <span className="composer-shortcuts" aria-hidden="true"><span>{running ? "Enter to queue" : "Enter to send"}</span><span>{running && state.queue?.canSteer ? `${steerShortcut} to steer` : "Shift+Enter for a new line"}</span></span>}
          {thread?.forceStopRunId ? <button className="stop-button" title="Agent not responding to Stop" onClick={() => { void run("forceStop", { threadId: thread.id, runId: thread.forceStopRunId }); }}>Force stop</button> : null}
          {canStop && thread ? <button className={stopping ? "stop-button stopping" : "stop-button"} aria-label={stopLabel(stop)} title={stopping ? "Stopping…" : "Stop generation"} disabled={stopping} onClick={() => {
            if (stopping) return;
            setStoredStop(stopClicked(currentStopKey));
            // A stop the host could not send leaves nothing to wait for, so allow another try.
            void run("interrupt", { threadId: thread.id }).then((ok) => { if (!ok) setStoredStop((current) => current.key === currentStopKey ? idleStop(currentStopKey) : current); });
          }}><SquareIcon size={12} fill="currentColor" />{stopping ? <span>Stopping…</span> : null}</button> : null}
          <button className="send-button" aria-label="Send message" title={policyBlock ?? shortcutHint} disabled={disabled || setupBlocked || picking || placingPicked || !selection || attachments.some((file) => !file.pending && !file.attachment) || (!text.trim() && !visibleContexts.length && !attachments.length)} onClick={(event) => { void send(event.ctrlKey || event.metaKey); }}><ArrowUpIcon size={17} /></button>
        </div>
      </div>
    </div>
    {captionReference ? <ImageCaptionEditor label={captionReference.reference.label} src={captionReference.src} onClose={() => { setCaptionReference(null); textarea.current?.focus(); }} onSave={label => {
      const old = captionReference.reference;
      const current = collectComposerContextReferences(text).find(ref => ref.start === old.start && ref.contextId === old.contextId && ref.kind === "image");
      if (current) {
        const replacement = formatComposerContextReference({ ...current, label });
        applyEdit({ start: current.start, end: current.end, text: replacement, selection: { start: current.start + replacement.length, end: current.start + replacement.length } });
      }
      setCaptionReference(null); textarea.current?.focus();
    }} /> : null}
  </div></div>;
}
