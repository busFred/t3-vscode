import { useEffect, useState } from "react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { bridge, Events } from "../bridge-client";
import { ThreadList } from "./ThreadList";
import { ChatView } from "./ChatView";
import { AccountUsage } from "./AccountUsage";

export function SidebarView({ state, onAppearance }: { readonly state: HostStateSnapshot; readonly onAppearance: () => void }) {
  const [mode, setMode] = useState<"sessions" | "chat">(() => bridge.readViewState<{ sidebarMode?: string }>()?.sidebarMode === "chat" ? "chat" : "sessions");
  useEffect(() => { bridge.saveViewState({ sidebarMode: mode }); }, [mode]);
  useEffect(() => bridge.on(Events.showNavigation, () => setMode("sessions")), []);
  useEffect(() => bridge.on(Events.showChat, () => setMode("chat")), []);
  useEffect(() => bridge.on(Events.insertReference, () => setMode("chat")), []);
  return <div className="sidebar-view">
    <nav className="sidebar-modes" aria-label="Sidebar view"><button aria-pressed={mode === "sessions"} onClick={() => setMode("sessions")}>Sessions</button><button aria-pressed={mode === "chat"} onClick={() => setMode("chat")}>Chat</button></nav>
    {mode === "sessions" ? <>
      <AccountUsage state={state} onDetails={(key) => { window.dispatchEvent(new CustomEvent("t3-show-usage", { detail: key })); }} />
      <ThreadList state={state} dedicated openInEditor onSelect={() => {}} onClose={() => setMode("chat")} onAppearance={onAppearance} />
    </> : <ChatView state={state} onAppearance={onAppearance} />}
  </div>;
}
