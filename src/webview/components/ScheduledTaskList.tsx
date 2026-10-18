import { useState } from "react";
import { CalendarClockIcon, CircleDashedIcon, CircleXIcon, PlayIcon, PlusIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { taskScheduleLabel, type ScheduledTaskView } from "../../shared/scheduledTasks";
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
          <CalendarClockIcon size={12} />
        </span>
      </button>
      <button className="icon-button" disabled={busy !== null || task.lastRunStatus === "running"} aria-label={`Run ${task.title} now`} title="Run now" onClick={() => { setBusy(task.id); void run("runScheduledTask", { taskId: task.id, projectId: task.projectId }).finally(() => setBusy(null)); }}><PlayIcon size={13} /></button>
      <input type="checkbox" checked={task.enabled} disabled={busy !== null} aria-label={`Enable ${task.title}`} title={task.enabled ? "Enabled" : "Disabled"} onChange={(event) => { setBusy(task.id); void run("setScheduledTaskEnabled", { taskId: task.id, projectId: task.projectId, enabled: event.target.checked }).finally(() => setBusy(null)); }} />
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
