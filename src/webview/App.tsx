import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import type { ScheduledTaskEditorRequest } from "../shared/scheduledTasks";
import type { HostStateSnapshot, RpcMethod } from "../shared/bridge";
import { bridge, Events, Methods } from "./bridge-client";
import { Actions } from "./actions";
import { ChatView } from "./components/ChatView";
import { StatusView } from "./components/StatusView";
import { DEFAULT_APPEARANCE } from "../shared/appearance";
import type { InsertReferenceEvent } from "../shared/composerContext";
import { addEditorReference, readDraft, updateDraft } from "./composerDrafts";
import type { DraftTransfer } from "../shared/viewDraft";
import { SidebarView } from "./components/SidebarView";
import { ServerSetup } from "./components/ServerSetup";
import { MathContextMenu } from "./components/MathContextMenu";
import { EquationPreview } from "./components/EquationPreview";
import { VisualDialog } from "./components/ChatMedia";
import { settleDraftAttachments } from "./composerAttachments";

export function App() {
  const [state, setState] = useState<HostStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const lastSidebarState = useRef<HostStateSnapshot | null>(null);
  const [taskRequest, setTaskRequest] = useState<ScheduledTaskEditorRequest | null>(null);
  const [usageRequest, setUsageRequest] = useState<{ accountKey?: string } | null>(null);
  const appearance = state?.appearance ?? DEFAULT_APPEARANCE;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${appearance.fontSizeInterface}px`;
    root.style.setProperty("--font-size-prompt", `${appearance.fontSizePrompt}px`);
    root.style.setProperty("--font-size-code", `${appearance.fontSizeCode}px`);
  }, [appearance.fontSizeInterface, appearance.fontSizePrompt, appearance.fontSizeCode]);
  const receive = useCallback((next: HostStateSnapshot) => {
    setState((previous) => previous && previous.revision > next.revision ? previous : next);
  }, []);
  const run = useCallback(async (method: RpcMethod, params?: unknown) => {
    try {
      setError(null);
      receive(await bridge.request<HostStateSnapshot>(method, params));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
  }, [receive]);
  useEffect(() => bridge.on(Events.showNavigation, () => setNavigationRequest((value) => value + 1)), []);
  useEffect(() => bridge.on(Events.editScheduledTask, (data) => setTaskRequest(data as ScheduledTaskEditorRequest)), []);
  useEffect(() => bridge.on(Events.showUsage, (data) => setUsageRequest(typeof data === "string" ? { accountKey: data } : {})), []);
  useEffect(() => bridge.on(Events.openInTab, (data) => {
    const draftKey = typeof data === "string" ? data : state?.activeThreadId ?? "new";
    void settleDraftAttachments(draftKey).then(() => run(Methods.openInTab, { draftKey, draft: readDraft(draftKey) }));
  }), [state?.activeThreadId, run]);
  useEffect(() => {
    const off = bridge.on(Events.stateChanged, (data) => receive(data as HostStateSnapshot));
    const offReference = bridge.on(Events.insertReference, (data) => {
      const event = data as InsertReferenceEvent;
      const cursor = addEditorReference(event.draftKey, event.reference);
      window.dispatchEvent(new CustomEvent("t3-focus-composer", { detail: { draftKey: event.draftKey, cursor } }));
    });
    const offDraft = bridge.on(Events.initializeDraft, (data) => {
      const transfer = data as DraftTransfer;
      updateDraft(transfer.draftKey, () => transfer.draft);
    });
    let notified = false;
    const focus = () => { if (!notified) { notified = true; void run(Methods.focusView); } };
    const blur = () => { notified = false; };
    window.addEventListener("focus", focus); window.addEventListener("blur", blur); window.addEventListener("pointerdown", focus);
    void run(Methods.getState);
    return () => { off(); offReference(); offDraft(); window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); window.removeEventListener("pointerdown", focus); };
  }, [run, receive]);
  const sidebar = document.body.dataset.surface === "sidebar";
  if (sidebar && state?.phase === "ready") lastSidebarState.current = state;
  let content;
  if (!state) content = <StatusView title="Opening T3 VSCode…" detail="Connecting to the extension host." />;
  else if (state.phase === "ready") content = document.body.dataset.surface === "sidebar" ? <SidebarView navigationRequest={navigationRequest} taskRequest={taskRequest} state={state} usageRequest={usageRequest} onAppearance={() => { void run(Methods.openSettings); }} /> : <ChatView state={state} />;
  else if (state.phase === "no-server" || state.phase === "error") content = <ServerSetup state={state} />;
  else content = <StatusView
    title={state.phase === "pairing" ? "Pairing with T3 Code…" : "Connecting to T3 Code…"}
    detail={state.notice ?? state.environment?.label ?? state.home}
  />;
  if (sidebar && lastSidebarState.current) {
    // Retain sidebar navigation, scroll, groups and task drafts during same-server recovery.
    const remembered = lastSidebarState.current;
    content = <><div className="retained-sidebar" style={{ display: state?.phase === "ready" ? "flex" : "none" }}><SidebarView key={remembered.environment?.environmentId} navigationRequest={navigationRequest} taskRequest={taskRequest} state={remembered} usageRequest={usageRequest} onAppearance={() => { void run(Methods.openSettings); }} /></div>{state?.phase !== "ready" ? content : null}</>;
  }
  return <Actions value={run}><div className="app">
    {error ? <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><XIcon size={14} /></button></div> : null}
    {content}<MathContextMenu /><VisualDialog /><EquationPreview />
  </div></Actions>;
}
