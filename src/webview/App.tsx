import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { XIcon } from "lucide-react";
import type { HostStateSnapshot, RpcMethod } from "../shared/bridge";
import { bridge, Events, Methods } from "./bridge-client";
import { Actions } from "./actions";
import { ChatView } from "./components/ChatView";
import { StatusView } from "./components/StatusView";
import { DEFAULT_APPEARANCE } from "../shared/appearance";
import type { InsertReferenceEvent } from "../shared/composerContext";
import { addDraftContext } from "./composerDrafts";

export function App() {
  const [state, setState] = useState<HostStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  useEffect(() => {
    const off = bridge.on(Events.stateChanged, (data) => receive(data as HostStateSnapshot));
    const offReference = bridge.on(Events.insertReference, (data) => {
      const event = data as InsertReferenceEvent; addDraftContext(event.draftKey, event.reference);
      window.dispatchEvent(new CustomEvent("t3-focus-composer"));
    });
    let notified = false;
    const focus = () => { if (!notified) { notified = true; void run(Methods.focusView); } };
    const blur = () => { notified = false; };
    window.addEventListener("focus", focus); window.addEventListener("blur", blur); window.addEventListener("pointerdown", focus);
    void run(Methods.getState);
    return () => { off(); offReference(); window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); window.removeEventListener("pointerdown", focus); };
  }, [run, receive]);
  let content;
  if (!state) content = <StatusView title="Opening T3 Code…" detail="Connecting to the extension host." />;
  else if (state.phase === "ready") content = <ChatView state={state} onAppearance={() => { void run(Methods.openSettings); }} />;
  else content = <StatusView
    title={state.phase === "no-server" ? "T3 server unavailable" : state.phase === "error" ? "Connection interrupted" : state.phase === "pairing" ? "Pairing with T3 Code…" : "Connecting to T3 Code…"}
    detail={state.notice ?? (state.phase === "no-server" ? `Start the T3 server for ${state.home}, then retry the connection.` : state.environment?.label ?? state.home)}
    actions={state.phase === "no-server" ? [
      { label: "Retry connection", onClick: () => { void run(Methods.reconnect); } },
    ] : state.phase === "error" ? [
      { label: "Reconnect", onClick: () => { void run(Methods.reconnect); } },
      { label: "Pair again", onClick: () => { void run(Methods.startPairing); } },
    ] : []}
  />;
  return <Actions value={run}><div className="app">
    {error ? <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><XIcon size={14} /></button></div> : null}
    {content}
  </div></Actions>;
}
