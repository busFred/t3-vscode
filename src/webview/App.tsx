import { useCallback, useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import type { HostStateSnapshot, RpcMethod } from "../shared/bridge";
import { bridge, Events, Methods } from "./bridge-client";
import { Actions } from "./actions";
import { ChatView } from "./components/ChatView";
import { StatusView } from "./components/StatusView";

export function App() {
  const [state, setState] = useState<HostStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    void run(Methods.getState);
    return off;
  }, [run, receive]);
  let content;
  if (!state) content = <StatusView title="Opening T3 Code…" detail="Connecting to the extension host." />;
  else if (state.phase === "ready") content = <ChatView state={state} />;
  else content = <StatusView
    title={state.phase === "no-server" ? "Connect to T3 Code" : state.phase === "error" ? "Connection interrupted" : state.phase === "pairing" ? "Pairing with T3 Code…" : "Connecting to T3 Code…"}
    detail={state.notice ?? (state.phase === "no-server" ? "Install and start the T3 service with t3 service install." : state.environment?.label ?? state.home)}
    actions={state.phase === "error" || state.phase === "no-server" ? [
      { label: "Reconnect", onClick: () => { void run(Methods.reconnect); } },
      { label: "Pair again", onClick: () => { void run(Methods.startPairing); } },
    ] : []}
  />;
  return <Actions value={run}><div className="app">
    {error ? <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><XIcon size={14} /></button></div> : null}
    {content}
  </div></Actions>;
}
