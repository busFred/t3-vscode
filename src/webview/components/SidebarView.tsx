import { bridge, Events } from "../bridge-client";
import { useEffect, useRef, useState } from "react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { ScheduledTaskEditorRequest } from "../../shared/scheduledTasks";
import { ThreadList } from "./ThreadList";
import { WorktreeList } from "./WorktreeList";
import { AccountUsage } from "./AccountUsage";
import { EnvironmentsSection } from "./EnvironmentsSection";
import { ProviderSetupNotice } from "./ServerSetup";
import { MachineTaskList } from "./ScheduledTaskList";
import { ScheduledTaskEditor, taskDraft, type TaskDraft } from "./ScheduledTaskEditor";

export function SidebarView({ state, usageRequest, taskRequest, navigationRequest }: { readonly state: HostStateSnapshot; readonly usageRequest: { accountKey?: string } | null; readonly taskRequest: ScheduledTaskEditorRequest | null; readonly navigationRequest: number }) {
  const [tab, setTab] = useState<"sessions" | "worktrees" | "tasks">("sessions");
  useEffect(() => bridge.on(Events.showTaskManager, () => { setEditing(null); setTab("tasks"); }), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const latest = useRef(state); latest.current = state;
  const returnFocus = useRef<HTMLElement | null>(null); const tabs = useRef<HTMLDivElement>(null);
  const editKey = (request: ScheduledTaskEditorRequest) => JSON.stringify([state.environment?.environmentId, request.projectId, request.taskId ?? `new:${request.originThreadId ?? "project"}`]);
  useEffect(() => {
    if (!taskRequest) return;
    const draft = taskDraft(latest.current, taskRequest); if (!draft) return;
    const key = editKey(taskRequest);
    if (!editing) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrafts((previous) => previous[key] ? previous : { ...previous, [key]: draft }); setEditing(key);
  }, [taskRequest]);
  useEffect(() => { if (navigationRequest) { setEditing(null); setTab("sessions"); } }, [navigationRequest]);
  useEffect(() => { if (usageRequest) setEditing(null); }, [usageRequest]);
  const back = (discard: boolean) => {
    if (discard && editing) setDrafts((previous) => { const next = { ...previous }; delete next[editing]; return next; });
    setEditing(null);
    requestAnimationFrame(() => { const target = returnFocus.current; if (target?.isConnected && target !== document.body) target.focus(); else tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); });
  };
  const draft = editing ? drafts[editing] : undefined;
  return <div className="sidebar-view">
    <div className="sidebar-front" style={{ display: draft ? "none" : "flex" }}>
      <AccountUsage state={state} request={usageRequest} />
      <EnvironmentsSection state={state} />
      <ProviderSetupNotice state={state} />
      <div className="sidebar-tabs" ref={tabs} role="tablist" aria-label="Session, worktree and task managers" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
        const order = ["sessions", "worktrees", "tasks"] as const;
        const index = order.indexOf(tab);
        const next = event.key === "Home" ? "sessions" : event.key === "End" ? "tasks" : order[(index + (event.key === "ArrowRight" ? 1 : 2)) % order.length]!; setTab(next);
        tabs.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
      }}>
        <button role="tab" id="sessions-tab" data-tab="sessions" aria-controls="sessions-manager" aria-selected={tab === "sessions"} tabIndex={tab === "sessions" ? 0 : -1} title="Sessions in this workspace's projects" onClick={() => setTab("sessions")}>Sessions</button>
        <button role="tab" id="worktrees-tab" data-tab="worktrees" aria-controls="worktrees-manager" aria-selected={tab === "worktrees"} tabIndex={tab === "worktrees" ? 0 : -1} onClick={() => setTab("worktrees")}>Worktrees</button>
        <button role="tab" id="tasks-tab" data-tab="tasks" aria-controls="tasks-manager" aria-selected={tab === "tasks"} tabIndex={tab === "tasks" ? 0 : -1} onClick={() => setTab("tasks")}>Tasks <small>{state.scheduledTasks?.tasks.length ?? 0}</small></button>
      </div>
      <div id="sessions-manager" className="sidebar-manager" role="tabpanel" aria-labelledby="sessions-tab" style={{ display: tab === "sessions" ? "flex" : "none" }}><ThreadList state={state} /></div>
      <div id="worktrees-manager" className="sidebar-manager" role="tabpanel" aria-labelledby="worktrees-tab" style={{ display: tab === "worktrees" ? "flex" : "none" }}><WorktreeList state={state} active={tab === "worktrees"} /></div>
      <div id="tasks-manager" className="sidebar-manager" role="tabpanel" aria-labelledby="tasks-tab" style={{ display: tab === "tasks" ? "flex" : "none" }}>
        <MachineTaskList state={state} />
      </div>
    </div>
    {draft && editing ? <ScheduledTaskEditor key={editing} state={state} draft={draft} returnLabel={tab === "sessions" ? "Sessions" : "Tasks"} onChange={(value) => setDrafts((previous) => ({ ...previous, [editing]: value }))} onReturn={back}
      onReload={() => { const value = taskDraft(state, { taskId: draft.id, projectId: draft.projectId }); if (value) setDrafts((previous) => ({ ...previous, [editing]: value })); }} /> : null}
  </div>;
}
