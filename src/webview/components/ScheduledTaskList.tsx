import { useState } from "react";
import { CalendarClockIcon, CircleDashedIcon, CircleXIcon, PlayIcon, PlusIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { taskScheduleLabel, type ScheduledTaskView } from "../../shared/scheduledTasks";
import { projectMachineGroups, worktreeVisibilityScope } from "../../shared/worktreeGroups";
import { useCollapsedTaskMachines } from "../taskMachines";
import { useActions } from "../actions";

export function ScheduledTaskRows({ state, tasks }: { readonly state: HostStateSnapshot; readonly tasks: ReadonlyArray<ScheduledTaskView> }) {
  const run = useActions(); const [busy, setBusy] = useState<string | null>(null);
  return <div className="scheduled-task-rows">{tasks.map((task) => {
    const provider = state.providers.find((provider) => provider.instanceId === task.modelSelection.instanceId);
    const model = provider?.models.find((model) => model.slug === task.modelSelection.model);
    const origin = task.originThreadId ? state.threads.find((thread) => thread.id === task.originThreadId)?.title ?? "Origin session unavailable" : task.originKnown ? "Independent task" : "Origin unknown";
    return <div key={task.id} className="scheduled-task-row" data-task-id={task.id}>
      <button className="scheduled-task-open" onClick={(event) => void run("editScheduledTask", { taskId: task.id, projectId: task.projectId, preview: event.detail < 2 })} onDoubleClick={() => void run("editScheduledTask", { taskId: task.id, projectId: task.projectId, preview: false })} aria-label={`Edit task ${task.title}`}>
        <span className="scheduled-task-title"><strong title={task.title}>{task.title}</strong></span>
        <span className="scheduled-task-meta">
          {task.lastRunStatus === "running" ? <small className="task-run-state"><CircleDashedIcon size={12} />Running</small>
            : task.lastRunError ? <small className="task-run-state failed" title={task.lastRunError}><CircleXIcon size={12} />Last run failed</small> : null}
          <small title={`${taskScheduleLabel(task.schedule)} · ${model?.name ?? task.modelSelection.model} · ${origin}`}>{taskScheduleLabel(task.schedule)} · {model?.name ?? task.modelSelection.model}</small>
          {task.blockedByPolicy !== undefined ? <small className="task-policy-notice" role="alert" title={task.blockedByPolicy}>{task.blockedByPolicy}</small> : null}
          <CalendarClockIcon size={12} />
        </span>
      </button>
      <button className="icon-button" disabled={busy !== null || task.lastRunStatus === "running"} aria-label={`Run ${task.title} now`} title="Run now" onClick={() => { setBusy(task.id); void run("runScheduledTask", { taskId: task.id, projectId: task.projectId }).finally(() => setBusy(null)); }}><PlayIcon size={13} /></button>
      <input type="checkbox" checked={task.enabled} disabled={busy !== null || (!task.enabled && !!task.blockedByPolicy)} aria-label={`Enable ${task.title}`} title={task.blockedByPolicy ?? (task.enabled ? "Enabled" : "Disabled")} onChange={(event) => { setBusy(task.id); void run("setScheduledTaskEnabled", { taskId: task.id, projectId: task.projectId, enabled: event.target.checked }).finally(() => setBusy(null)); }} />
    </div>;
  })}{!tasks.length ? <p className="empty-list">No scheduled tasks.</p> : null}</div>;
}

export function ScheduledTaskList({ state, projectId, originThreadId, onClose }: { readonly state: HostStateSnapshot; readonly projectId: string; readonly originThreadId?: string; readonly onClose?: () => void }) {
  const run = useActions(); const [query, setQuery] = useState("");
  const tasks = state.scheduledTasks?.tasks.filter((task) => task.projectId === projectId && (originThreadId === undefined || task.originThreadId === originThreadId)) ?? [];
  return <section className="scheduled-task-list" aria-label={originThreadId ? "Current session scheduled tasks" : "Project scheduled tasks"}>
    {originThreadId ? <><div className="history-heading"><strong>SCHEDULED TASKS</strong><span>{tasks.length}</span>
      <button className="icon-button" aria-label="New task for this session" title="New task" onClick={() => void run("editScheduledTask", { projectId, originThreadId })}><PlusIcon size={15} /></button>
      {onClose ? <button className="icon-button" aria-label="Close scheduled tasks" onClick={onClose}><XIcon size={14} /></button> : null}</div>
      <p className="task-scope-note">Created by this session</p></>
      : <div className="sidebar-search-row"><label className="thread-search"><SearchIcon size={14} /><input aria-label="Search tasks" placeholder="Search tasks…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button className="icon-button sidebar-search-add" aria-label="New task" title="New task" onClick={() => void run("editScheduledTask", { projectId })}><PlusIcon size={15} /></button></div>}
    {state.scheduledTasks?.loading ? <p className="empty-list" role="status">Loading tasks…</p> : null}
    {state.scheduledTasks?.error ? <p className="task-status" role="alert">{state.scheduledTasks.error}</p> : null}
    <div className="scheduled-task-scroll"><ScheduledTaskRows state={state} tasks={tasks.filter((task) => `${task.title} ${task.prompt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))} /></div>
    <button className="task-refresh text-button" onClick={() => void run("refreshScheduledTasks")}><RefreshCwIcon size={12} />Refresh tasks</button>
  </section>;
}

/** Tasks are currently served by the local task store; remote controls must never target it. */
export function MachineTaskList({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions(); const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useCollapsedTaskMachines();
  const scope = worktreeVisibilityScope(state);
  const machines = projectMachineGroups(state);
  return <section className="scheduled-task-list" aria-label="Scheduled tasks by machine">
    <div className="sidebar-search-row"><label className="thread-search"><SearchIcon size={14} /><input aria-label="Search tasks" placeholder="Search tasks…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="scheduled-task-scroll">{machines.map((machine) => {
      const key = `${scope}:${machine.id}`;
      const projects = machine.projects;
      const tasks = machine.remote ? [] : state.scheduledTasks?.tasks.filter((task) => projects.some((project) => project.id === task.projectId)) ?? [];
      const add = (projectId: string, label: string) => <button type="button" className="icon-button" aria-label={`New task on ${label}`} title={`New task on ${label}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void run("editScheduledTask", { projectId }); }}><PlusIcon size={15} /></button>;
      return <details key={machine.id} className="worktree-repository history-shelf" data-machine-id={machine.id} open={!collapsed.has(key)} onToggle={(event) => setCollapsed(key, !event.currentTarget.open)}>
        <summary className="history-heading"><strong>{machine.title}</strong>{!machine.remote ? <><small className="shelf-count">{tasks.length}</small>{projects.length === 1 ? add(projects[0]!.id, machine.title) : null}</> : null}</summary>
        {machine.remote ? <p className="empty-list">Scheduled tasks are not available for this machine in VS Code.</p> : <>
          {state.scheduledTasks?.loading ? <p className="empty-list" role="status">Loading tasks…</p> : null}
          {state.scheduledTasks?.error ? <p className="task-status" role="alert">{state.scheduledTasks.error}</p> : null}
          {projects.map((project) => <div key={project.id}>{projects.length > 1 ? <div className="history-heading"><strong>{project.title}</strong>{add(project.id, `${machine.title} · ${project.title}`)}</div> : null}<ScheduledTaskRows state={state} tasks={tasks.filter((task) => task.projectId === project.id && `${task.title} ${task.prompt}`.toLowerCase().includes(query.toLowerCase()))} /></div>)}
        </>}
      </details>;
    })}{!machines.length ? <p className="empty-list">Open a project to manage its scheduled tasks.</p> : null}</div>
    <button className="task-refresh text-button" onClick={() => void run("refreshScheduledTasks")}><RefreshCwIcon size={12} />Refresh tasks</button>
  </section>;
}
