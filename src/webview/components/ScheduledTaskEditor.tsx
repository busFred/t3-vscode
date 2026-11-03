import { emptyWebhookFilterDraft, parseWebhookFilterDrafts, webhookFilterDrafts, WEBHOOK_FILTER_OPS, type WebhookFilterDraft } from "@t3tools/client-runtime/scheduled-task-webhook";
import { bridge } from "../bridge-client";
import type { ScheduledTaskWebhookDelivery, ScheduledTaskWebhookDeliverySummary } from "@t3tools/contracts";
import { useDateTimeFormat } from "../timeFormat";
import { useCallback, useRef, useState } from "react";
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";
import type { HostStateSnapshot, ModelSelection } from "../../shared/bridge";
import type { ScheduledTask } from "@t3tools/contracts";
import { newTaskModel, supportedSchedule, taskModelWithSpeed, type ScheduledTaskEditorRequest, type ScheduledTaskView } from "../../shared/scheduledTasks";
import { effortDescriptor, effortOptionLabel, isPremiumSpeed, selectionWithSpeed, speedChoiceLabel, speedControl } from "../../shared/modelOptions";
import { ModelPicker } from "./ModelPicker";
import { useActions } from "../actions";

export interface TaskDraft {
  readonly id: string; readonly projectId: string; readonly originThreadId: string | null; readonly base: ScheduledTaskView | null;
  readonly title: string; readonly prompt: string; readonly modelSelection: ModelSelection | null; readonly enabled: boolean;
  readonly threadId: string | null; readonly workspaceStrategy: ScheduledTask["workspaceStrategy"];
  readonly scheduleType: "interval" | "fixed_time" | "once" | "webhook" | "unsupported"; readonly runAt: string; readonly filters: ReadonlyArray<WebhookFilterDraft>; readonly minutes: string; readonly timeOfDay: string; readonly weekdays: ReadonlyArray<number> | undefined;
}
function localDateTime(value: string): string { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
export function taskDraft(state: HostStateSnapshot, request: ScheduledTaskEditorRequest): TaskDraft | null {
  const task = request.taskId ? state.scheduledTasks?.tasks.find((task) => task.id === request.taskId && task.projectId === request.projectId) : undefined;
  if (request.taskId && !task) return null;
  const schedule = task && supportedSchedule(task.schedule) ? task.schedule : undefined;
  return { id: task?.id ?? crypto.randomUUID(), projectId: request.projectId, originThreadId: task?.originThreadId ?? request.originThreadId ?? null, base: task ?? null,
    title: task?.title ?? "", prompt: task?.prompt ?? "", modelSelection: task?.modelSelection ?? newTaskModel(state.providers, state.taskDefaultSpeed ?? "standard"), enabled: task?.enabled ?? true,
    threadId: task ? task.threadId : request.originThreadId ?? null, workspaceStrategy: task?.workspaceStrategy ?? { type: "root" },
    scheduleType: schedule?.type ?? (task ? "unsupported" : "interval"), minutes: String(schedule?.type === "interval" ? schedule.everyMs / 60_000 : 30),
    runAt: schedule?.type === "once" ? localDateTime(schedule.runAt) : "", filters: webhookFilterDrafts(schedule?.type === "webhook" ? schedule.filters : undefined),
    timeOfDay: schedule?.type === "fixed_time" ? schedule.timeOfDay : "09:00", weekdays: schedule?.type === "fixed_time" ? schedule.weekdays : undefined };
}

export function ScheduledTaskEditor({ state, draft, onChange, onReturn, onReload, returnLabel }: {
  readonly state: HostStateSnapshot; readonly draft: TaskDraft; readonly onChange: (draft: TaskDraft) => void;
  readonly onReturn: (discard: boolean) => void; readonly onReload: () => void; readonly returnLabel: string;
}) {
  const { dateTime } = useDateTimeFormat();
  const run = useActions(); const [saving, setSaving] = useState(false); const [failed, setFailed] = useState(false);
  const [deliveries, setDeliveries] = useState<ReadonlyArray<ScheduledTaskWebhookDeliverySummary> | null>(null); const [webhookError, setWebhookError] = useState(""); const [rotated, setRotated] = useState<string | null>(null);
  const [deliveryDetail, setDeliveryDetail] = useState<ScheduledTaskWebhookDelivery | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false); const anchor = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const patch = (change: Partial<TaskDraft>) => { setFailed(false); onChange({ ...draft, ...change }); };
  const saved = state.scheduledTasks?.tasks.find((task) => task.id === draft.id && task.projectId === draft.projectId);
  const project = state.projects.find((project) => project.id === draft.projectId);
  const stale = !!draft.base && !state.scheduledTasks?.loading && (!saved || saved.editVersion !== draft.base.editVersion);
  const provider = state.providers.find((provider) => provider.instanceId === draft.modelSelection?.instanceId);
  const model = provider?.models.find((model) => model.slug === draft.modelSelection?.model);
  const unavailable = !provider?.enabled || !provider.installed || provider.availability === "unavailable" || !model;
  const effort = effortDescriptor(model, draft.modelSelection);
  const effortChoices = effort?.options.filter((option) => !effort.promptInjectedValues?.includes(option.id)) ?? [];
  const effortValue = draft.modelSelection?.options?.find((option) => option.id === effort?.id)?.value ?? (effortChoices.some((option) => option.id === effort?.currentValue) ? effort?.currentValue : undefined) ?? effortChoices.find((option) => option.isDefault)?.id ?? effortChoices[0]?.id ?? "";
  const speed = speedControl(model, draft.modelSelection);
  const speedValue = speed?.explicit ? speed.current?.id ?? "" : "";
  const origin = draft.originThreadId ? state.threads.find((thread) => thread.id === draft.originThreadId)?.title ?? "Origin session unavailable" : draft.base && !draft.base.originKnown ? "Origin unknown" : "Independent task";
  const interval = Number(draft.minutes) * 60_000;
  const filters = draft.filters ?? [];
  const parsedFilters = parseWebhookFilterDrafts(filters);
  const scheduleValid = draft.scheduleType === "interval" ? Number.isSafeInteger(interval) && interval >= 60_000 : draft.scheduleType === "once" ? !!draft.runAt && !Number.isNaN(Date.parse(draft.runAt)) : draft.scheduleType === "webhook" ? "filters" in parsedFilters : draft.scheduleType === "fixed_time" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(draft.timeOfDay);
  const valid = !!draft.title.trim() && !!draft.prompt.trim() && !unavailable && scheduleValid && !!project && !stale && state.scheduledTasks?.loading !== true;
  const submit = async () => {
    if (!valid || saving) return; setSaving(true); setFailed(false);
    const previousSchedule = draft.base && supportedSchedule(draft.base.schedule) && draft.base.schedule.type === draft.scheduleType ? draft.base.schedule : {};
    const schedule = draft.scheduleType === "interval" ? { ...previousSchedule, type: "interval", everyMs: interval }
      : draft.scheduleType === "once" ? { ...previousSchedule, type: "once", runAt: draft.base && supportedSchedule(draft.base.schedule) && draft.base.schedule.type === "once" && localDateTime(draft.base.schedule.runAt) === draft.runAt ? draft.base.schedule.runAt : new Date(draft.runAt).toISOString() }
      : draft.scheduleType === "webhook" ? { ...previousSchedule, type: "webhook", ...( "filters" in parsedFilters ? { filters: parsedFilters.filters } : {}) }
      : { ...previousSchedule, type: "fixed_time", timeOfDay: draft.timeOfDay, ...(draft.weekdays === undefined ? {} : { weekdays: draft.weekdays }) };
    const ok = await run("saveScheduledTask", { id: draft.id, existing: !!draft.base, editVersion: draft.base?.editVersion, projectId: draft.projectId,
      originThreadId: draft.originThreadId, title: draft.title, prompt: draft.prompt, modelSelection: draft.modelSelection,
      enabled: draft.enabled, schedule, threadId: draft.threadId, workspaceStrategy: draft.workspaceStrategy });
    setSaving(false); if (ok) onReturn(true); else setFailed(true);
  };
  return <form className="scheduled-task-editor" aria-label={draft.base ? "Edit scheduled task" : "New scheduled task"} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <header><button type="button" className="text-button" disabled={saving} onClick={() => onReturn(false)}><ArrowLeftIcon size={13} />{returnLabel}</button><h2>{draft.base ? "Edit task" : "New task"}</h2></header>
    <div className="task-editor-fields">
      <p className="task-context">{state.environment?.label} · {project?.title ?? "Project unavailable"}<br /><span title={origin}>{origin}</span></p>
      {stale ? <p className="task-status" role="alert">{saved ? "This task changed elsewhere." : "This task is no longer available."} Your edits are kept.{saved ? <button type="button" onClick={onReload}>Reload saved task</button> : null}</p> : null}
      {failed ? <p className="task-status" role="alert">Save failed. Your edits are kept; check the error above and retry.</p> : null}
      <fieldset disabled={saving}>
      <label>Name<input autoFocus aria-label="Task name" required value={draft.title} onChange={(event) => patch({ title: event.target.value })} /></label>
      <label>Prompt<textarea className="task-prompt" aria-label="Task prompt" required value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} /></label>
      <div className="task-model-field"><span>Model</span><button type="button" className="task-model-choice" aria-label="Choose task model" ref={anchor} onClick={() => setPickerOpen(!pickerOpen)}>{model?.name ?? draft.modelSelection?.model ?? "Choose a model"}<ChevronDownIcon size={13} /></button>
      {provider ? <small>{provider.displayName ?? provider.instanceId}</small> : null}
      {unavailable ? <small className="turn-error">Choose an available model before saving.</small> : null}</div>
      {effort && draft.modelSelection ? <label>{effort.label}<select aria-label="Task effort" value={String(effortValue)} onChange={(event) => patch({ modelSelection: { ...draft.modelSelection!, options: [...(draft.modelSelection?.options ?? []).filter((option) => option.id !== effort.id), { id: effort.id, value: event.target.value }] } })}>
        {!effortChoices.some((option) => option.id === effortValue) ? <option value={String(effortValue)}>Saved: {String(effortValue)}</option> : null}
        {effortChoices.map((option) => <option key={option.id} value={option.id}>{effortOptionLabel(option)}</option>)}
      </select></label> : null}
      {speed && draft.modelSelection ? <label>{speed.label}<select aria-label="Task speed" className={isPremiumSpeed(speed.current) ? "premium-speed" : undefined} value={speedValue} onChange={(event) => {
        patch({ modelSelection: selectionWithSpeed(draft.modelSelection!, speed, event.target.value || undefined) });
      }}>
        {/* A saved value the model stopped advertising stays visible instead of silently changing. */}
        {speed.explicit && !speed.current ? <option value="" disabled>Saved: unavailable</option> : null}
        <option value="">Server default{speed.current && !speed.explicit ? ` (${speed.current.label})` : ""}</option>
        {speed.choices.map((choice) => <option key={choice.id} value={choice.id} title={choice.description}>{isPremiumSpeed(choice) ? "⚡ " : ""}{speedChoiceLabel(choice)}</option>)}
      </select></label> : null}
      {speed && isPremiumSpeed(speed.current) ? <small className="task-status">{speed.explicit ? "" : "The server default is "}{speed.current!.label} speed: each run costs more.</small> : null}
      <label>Schedule<select aria-label="Task schedule" value={draft.scheduleType} disabled={draft.scheduleType === "unsupported"} onChange={(event) => patch({ scheduleType: event.target.value as TaskDraft["scheduleType"] })}>
        <option value="interval">Every interval</option><option value="fixed_time">At a time</option><option value="once">Once</option><option value="webhook">Webhook</option>{draft.scheduleType === "unsupported" ? <option value="unsupported">Newer schedule — edit in T3 Web</option> : null}
      </select></label>
      {draft.scheduleType === "interval" ? <label>Run every (minutes)<input type="number" min="1" step="any" aria-label="Task interval minutes" value={draft.minutes} onChange={(event) => patch({ minutes: event.target.value })} /></label> : draft.scheduleType === "fixed_time" ? <>
        <label>Time on {state.environment?.label ?? "server"}<input type="time" aria-label="Task time" value={draft.timeOfDay} onChange={(event) => patch({ timeOfDay: event.target.value })} /></label>
        <div className="task-weekdays" role="group" aria-label="Days of week">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => <label key={day}><input type="checkbox" checked={draft.weekdays === undefined || draft.weekdays.includes(index)} onChange={(event) => { const days = draft.weekdays ?? [0, 1, 2, 3, 4, 5, 6]; patch({ weekdays: event.target.checked ? [...days, index].sort() : days.filter((day) => day !== index) }); }} />{day}</label>)}</div>
        {draft.weekdays?.length === 0 ? <small>Choose at least one day.</small> : null}
      </> : null}
      {draft.scheduleType === "once" ? <label>Run on<input type="datetime-local" aria-label="Task run date and time" value={draft.runAt} onChange={(event) => patch({ runAt: event.target.value })} /></label> : null}
      {draft.scheduleType === "webhook" ? <div>
        {saved?.webhook ? <><p>Endpoint: {rotated ?? saved.webhook.url ?? saved.webhook.path}</p><button type="button" disabled={!saved.webhook.url} onClick={() => { if (saved.webhook?.url) void navigator.clipboard.writeText(rotated ?? saved.webhook.url); }}>Copy endpoint</button>{!saved.webhook.url ? <small>Link this environment to T3 Connect for a public URL.</small> : null}<p>Secret: {saved.webhook.hasSecret ? "Set" : "Not set"}</p><button type="button" onClick={() => { if (!window.confirm("Rotate this webhook URL? The current URL stops working.")) return; void bridge.request<{ task: ScheduledTask }>("rotateWebhookToken", { taskId: draft.id, projectId: draft.projectId }).then(({ task }) => setRotated(task.webhook?.url ?? task.webhook?.path ?? null), (error) => setWebhookError(String(error))); }}>Rotate token</button><button type="button" onClick={() => void bridge.request<{ deliveries: ReadonlyArray<ScheduledTaskWebhookDeliverySummary> }>("listWebhookDeliveries", { taskId: draft.id, projectId: draft.projectId }).then((result) => setDeliveries(result.deliveries), (error) => setWebhookError(String(error)))}>Recent deliveries</button></> : <p>Save this task to create an endpoint.</p>}
        {webhookError ? <p role="alert">{webhookError}</p> : null}{deliveries ? <ul>{deliveries.map((delivery) => <li key={delivery.id}><button type="button" onClick={() => void bridge.request<{ delivery: ScheduledTaskWebhookDelivery }>("getWebhookDelivery", { taskId: draft.id, projectId: draft.projectId, deliveryId: delivery.id }).then((result) => setDeliveryDetail(result.delivery), (error) => setWebhookError(String(error)))}>{delivery.outcome} · {dateTime(new Date(delivery.receivedAt))}</button></li>)}</ul> : null}{deliveryDetail ? <div><p>{deliveryDetail.method} · {deliveryDetail.outcome}</p><pre>{deliveryDetail.error ?? deliveryDetail.body}</pre></div> : null}
        <p>All filters must match.</p>{filters.map((filter) => <div key={filter.id}><input aria-label="Filter path" placeholder="body.action" value={filter.path} onChange={(event) => patch({ filters: filters.map((row) => row.id === filter.id ? { ...row, path: event.target.value } : row) })} /><select aria-label="Filter operator" value={filter.op} onChange={(event) => patch({ filters: filters.map((row) => row.id === filter.id ? { ...row, op: event.target.value as WebhookFilterDraft["op"] } : row) })}>{WEBHOOK_FILTER_OPS.map((op) => <option key={op.op} value={op.op}>{op.label}</option>)}</select>{filter.op !== "exists" ? <input aria-label="Filter value" value={filter.value} onChange={(event) => patch({ filters: filters.map((row) => row.id === filter.id ? { ...row, value: event.target.value } : row) })} /> : null}<button type="button" onClick={() => patch({ filters: filters.filter((row) => row.id !== filter.id) })}>Remove filter</button></div>)}<button type="button" onClick={() => patch({ filters: [...filters, emptyWebhookFilterDraft()] })}>Add filter</button>{"error" in parsedFilters ? <p role="alert">{parsedFilters.error}</p> : null}
      </div> : null}
      {draft.base?.blockedByPolicy !== undefined ? <p className="task-status" role="alert">{draft.base.blockedByPolicy}</p> : null}
      <label>Post results to<select aria-label="Task result destination" value={draft.threadId ?? ""} onChange={(event) => patch({ threadId: event.target.value || null })}>
        <option value="">New session each run</option>
        {draft.threadId && !state.threads.some((thread) => thread.id === draft.threadId && thread.projectId === draft.projectId) ? <option value={draft.threadId}>Saved session (unavailable)</option> : null}
        {state.threads.filter((thread) => thread.projectId === draft.projectId).map((thread) => <option key={thread.id} value={thread.id}>{thread.title || "Untitled"}</option>)}
      </select></label>
      <details className="task-workspace"><summary>Workspace</summary><label>Checkout<select aria-label="Task workspace" value={draft.workspaceStrategy.type} disabled={draft.threadId !== null} onChange={(event) => patch({ workspaceStrategy: event.target.value === "root" ? { type: "root" } : { type: "worktree", baseRef: "main", startFromOrigin: false } })}>
        <option value="root">Project checkout</option><option value="worktree">New worktree each run</option>{draft.workspaceStrategy.type === "existing_worktree" ? <option value="existing_worktree">Saved worktree</option> : null}
      </select></label>
      {draft.threadId ? <small>Uses the result session’s workspace.</small> : draft.workspaceStrategy.type === "worktree" ? <label>Base branch<input aria-label="Task base branch" value={draft.workspaceStrategy.baseRef} onChange={(event) => { if (draft.workspaceStrategy.type === "worktree") patch({ workspaceStrategy: { ...draft.workspaceStrategy, baseRef: event.target.value } }); }} /></label> : draft.workspaceStrategy.type === "existing_worktree" ? <small>{draft.workspaceStrategy.worktreePath}</small> : <small>{project?.workspaceRoot}</small>}
      {draft.base ? <small>Permissions: {draft.base.runtimeMode} · {draft.base.interactionMode}</small> : null}</details>
      <label className="task-enabled"><input type="checkbox" aria-label="Task enabled" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />Enabled</label>
      {draft.base?.nextRunAt ? <small>Next run: {dateTime(new Date(draft.base.nextRunAt))}</small> : null}
      </fieldset>
    </div>
    <footer><button type="button" disabled={saving} onClick={() => onReturn(true)}>Cancel</button><button type="submit" className="primary" disabled={!valid || saving || draft.scheduleType === "fixed_time" && draft.weekdays?.length === 0}>{saving ? "Saving…" : "Save task"}</button></footer>
    {pickerOpen && anchor.current ? <ModelPicker state={state} selection={draft.modelSelection} anchor={anchor.current} onClose={closePicker} onSelect={(modelSelection) => {
      if (modelSelection.instanceId === draft.modelSelection?.instanceId && modelSelection.model === draft.modelSelection.model) { patch({ modelSelection }); return; }
      const descriptors = state.providers.find((provider) => provider.instanceId === modelSelection.instanceId)?.models.find((model) => model.slug === modelSelection.model)?.capabilities?.optionDescriptors ?? [];
      const next = { ...modelSelection, ...(modelSelection.options ? { options: modelSelection.options.filter((option) => {
        const descriptor = descriptors.find((descriptor) => descriptor.id === option.id);
        return !(descriptor?.type === "select" && typeof option.value === "string" && descriptor.promptInjectedValues?.includes(option.value));
      }) } : {}) };
      // A new task keeps its default speed across models; a saved task keeps what it stored.
      patch({ modelSelection: draft.base ? next : taskModelWithSpeed(state.providers, next, state.taskDefaultSpeed ?? "standard") });
    }} /> : null}
  </form>;
}
