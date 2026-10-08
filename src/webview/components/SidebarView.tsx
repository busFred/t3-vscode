import { useEffect, useRef, useState } from "react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { ScheduledTaskEditorRequest } from "../../shared/scheduledTasks";
import { ThreadList } from "./ThreadList";
import { AccountUsage } from "./AccountUsage";
import { ProviderSetupNotice } from "./ServerSetup";
import { ScheduledTaskList } from "./ScheduledTaskList";
import { ScheduledTaskEditor, taskDraft, type TaskDraft } from "./ScheduledTaskEditor";

export function SidebarView({ state, onAppearance, usageRequest, taskRequest, navigationRequest }: { readonly state: HostStateSnapshot; readonly onAppearance: () => void; readonly usageRequest: { accountKey?: string } | null; readonly taskRequest: ScheduledTaskEditorRequest | null; readonly navigationRequest: number }) {
  const [tab, setTab] = useState<"sessions" | "tasks">("sessions");
  const [selectedProject, setProject] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const latest = useRef(state); latest.current = state;
  const returnFocus = useRef<HTMLElement | null>(null); const tabs = useRef<HTMLDivElement>(null);
  const projectId = state.projects.some((project) => project.id === selectedProject) ? selectedProject
    : state.threads.find((thread) => thread.id === state.activeThreadId)?.projectId ?? state.draft.projectId ?? state.projects[0]?.id;
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
      <ProviderSetupNotice state={state} />
      <div className="sidebar-tabs" ref={tabs} role="tablist" aria-label="Session and task managers" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
        const next = event.key === "Home" ? "sessions" : event.key === "End" ? "tasks" : tab === "sessions" ? "tasks" : "sessions"; setTab(next);
        tabs.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
      }}>
        <button role="tab" id="sessions-tab" data-tab="sessions" aria-controls="sessions-manager" aria-selected={tab === "sessions"} tabIndex={tab === "sessions" ? 0 : -1} onClick={() => setTab("sessions")}>Sessions</button>
        <button role="tab" id="tasks-tab" data-tab="tasks" aria-controls="tasks-manager" aria-selected={tab === "tasks"} tabIndex={tab === "tasks" ? 0 : -1} onClick={() => setTab("tasks")}>Tasks <small>{state.scheduledTasks?.tasks.filter((task) => task.projectId === projectId).length ?? 0}</small></button>
      </div>
      <div id="sessions-manager" className="sidebar-manager" role="tabpanel" aria-labelledby="sessions-tab" style={{ display: tab === "sessions" ? "flex" : "none" }}><ThreadList state={state} onAppearance={onAppearance} /></div>
      <div id="tasks-manager" className="sidebar-manager" role="tabpanel" aria-labelledby="tasks-tab" style={{ display: tab === "tasks" ? "flex" : "none" }}>
        {state.projects.length > 1 ? <label className="task-project-select">Project<select aria-label="Task project" value={projectId} onChange={(event) => setProject(event.target.value)}>{state.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label> : null}
        {projectId ? <ScheduledTaskList key={projectId} state={state} projectId={projectId} /> : <p className="empty-list">Open a project to manage its scheduled tasks.</p>}
      </div>
    </div>
    {draft && editing ? <ScheduledTaskEditor key={editing} state={state} draft={draft} returnLabel={tab === "sessions" ? "Sessions" : "Project tasks"} onChange={(value) => setDrafts((previous) => ({ ...previous, [editing]: value }))} onReturn={back}
      onReload={() => { const value = taskDraft(state, { taskId: draft.id, projectId: draft.projectId }); if (value) setDrafts((previous) => ({ ...previous, [editing]: value })); }} /> : null}
  </div>;
}
