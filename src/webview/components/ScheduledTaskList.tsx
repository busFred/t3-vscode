import { useState } from "react";
import { CalendarClockIcon, PlayIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { taskScheduleLabel, type ScheduledTaskView } from "../../shared/scheduledTasks";
import { useActions } from "../actions";

export function ScheduledTaskRows({ state, tasks, showOrigin = false }: { readonly state: HostStateSnapshot; readonly tasks: ReadonlyArray<ScheduledTaskView>; readonly showOrigin?: boolean }) {
  const run = useActions(); const [busy, setBusy] = useState<string | null>(null);
  return <div className="scheduled-task-rows">{tasks.map((task) => {
    const provider = state.providers.find((provider) => provider.instanceId === task.modelSelection.instanceId);
    const model = provider?.models.find((model) => model.slug === task.modelSelection.model);
    const origin = task.originThreadId ? state.threads.find((thread) => thread.id === task.originThreadId)?.title ?? "Origin session unavailable" : task.originKnown ? "Independent task" : "Origin unknown";
    return <div key={task.id} className="scheduled-task-row" data-task-id={task.id}>
      <button className="scheduled-task-open" onClick={() => void run("editScheduledTask", { taskId: task.id, projectId: task.projectId })} aria-label={`Edit task ${task.title}`}>
        <span className="scheduled-task-title"><CalendarClockIcon size={13} /><strong>{task.title}</strong></span>
        <small title={`${taskScheduleLabel(task.schedule)} · ${model?.name ?? task.modelSelection.model}`}>{taskScheduleLabel(task.schedule)} · {model?.name ?? task.modelSelection.model}</small>
        {showOrigin ? <small title={origin}>{origin}</small> : null}
        {task.lastRunStatus === "running" ? <small>Running</small> : task.lastRunError ? <small className="turn-error" title={task.lastRunError}>Last run failed</small> : null}
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
    <div className="history-heading"><strong>{originThreadId ? "SCHEDULED TASKS" : "TASKS"}</strong><span>{tasks.length}</span>
      <button className="icon-button" aria-label={originThreadId ? "New task for this session" : "New task"} title="New task" onClick={() => void run("editScheduledTask", { projectId, ...(originThreadId ? { originThreadId } : {}) })}><PlusIcon size={15} /></button>
      {onClose ? <button className="icon-button" aria-label="Close scheduled tasks" onClick={onClose}><XIcon size={14} /></button> : null}</div>
    {originThreadId ? <p className="task-scope-note">Created by this session</p> : <label className="thread-search"><input aria-label="Search tasks" placeholder="Search tasks…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
    {state.scheduledTasks?.loading ? <p className="empty-list" role="status">Loading tasks…</p> : null}
    {state.scheduledTasks?.error ? <p className="task-status" role="alert">{state.scheduledTasks.error}</p> : null}
    <div className="scheduled-task-scroll"><ScheduledTaskRows state={state} tasks={tasks.filter((task) => `${task.title} ${task.prompt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))} showOrigin={!originThreadId} /></div>
    <button className="task-refresh text-button" onClick={() => void run("refreshScheduledTasks")}><RefreshCwIcon size={12} />Refresh tasks</button>
  </section>;
}
