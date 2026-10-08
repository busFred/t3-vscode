import type { ScheduledTask, ScheduledTaskUpsertSchedule, ServerProvider } from "@t3tools/contracts";
import type { ModelSelection } from "./bridge.js";
import { effortDescriptor } from "./modelOptions.js";

export type TaskOrigin = { readonly environmentId: string; readonly projectId: string; readonly taskId: string; readonly threadId: string | null };
export type ScheduledTaskView = ScheduledTask & { readonly originThreadId: string | null; readonly originKnown: boolean; readonly editVersion: string };
export interface ScheduledTaskEditorRequest { readonly taskId?: string; readonly projectId: string; readonly originThreadId?: string }
export interface ScheduledTasksState { readonly tasks: ReadonlyArray<ScheduledTaskView>; readonly loading: boolean; readonly error?: string }

/** Compare configuration only: scheduler run-state changes must not invalidate an open form. */
export function taskEditVersion(task: ScheduledTask): string {
  return JSON.stringify([task.title, task.prompt, task.enabled, task.schedule, task.projectId, task.threadId,
    task.workspaceStrategy, task.modelSelection, task.runtimeMode, task.interactionMode, task.createdBy, task.creationSource]);
}
export function supportedSchedule(value: unknown): value is ScheduledTaskUpsertSchedule {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return s.type === "interval" ? Number.isSafeInteger(s.everyMs) && Number(s.everyMs) > 0
    : s.type === "fixed_time" && typeof s.timeOfDay === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.timeOfDay)
      && (s.weekdays === undefined || Array.isArray(s.weekdays) && s.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6));
}
export function taskScheduleLabel(schedule: unknown): string {
  if (!supportedSchedule(schedule)) return "Unsupported schedule";
  return schedule.type === "interval" ? `Every ${schedule.everyMs / 60_000} min`
    : `${schedule.timeOfDay}${schedule.weekdays?.length ? ` · ${schedule.weekdays.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")}` : " · Daily"}`;
}
/** Explicitly cheap advertised default; do not fall back to the conversation model. */
export function newTaskModel(providers: ReadonlyArray<ServerProvider>): ModelSelection | null {
  for (const provider of providers) {
    if (!provider.enabled || !provider.installed || provider.availability === "unavailable") continue;
    const model = provider.models.find((model) => model.slug === "gpt-6-luna");
    if (!model) continue;
    const effort = effortDescriptor(model, null);
    if (!effort?.options.some((option) => option.id === "low")) continue;
    return { instanceId: provider.instanceId, model: model.slug, options: [{ id: effort.id, value: "low" }] };
  }
  return null;
}
