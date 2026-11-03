import { ScheduledTaskUpsertSchedule, type ScheduledTask, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { ModelSelection } from "./bridge.js";
import { effortDescriptor, withStandardSpeed } from "./modelOptions.js";

export type TaskOrigin = { readonly environmentId: string; readonly projectId: string; readonly taskId: string; readonly threadId: string | null };
export type ScheduledTaskView = ScheduledTask & { readonly originThreadId: string | null; readonly originKnown: boolean; readonly editVersion: string };
export interface ScheduledTaskEditorRequest { readonly taskId?: string; readonly projectId: string; readonly originThreadId?: string }
export interface ScheduledTasksState { readonly tasks: ReadonlyArray<ScheduledTaskView>; readonly loading: boolean; readonly error?: string }

/** Compare configuration only: scheduler run-state changes must not invalidate an open form. */
export function taskEditVersion(task: ScheduledTask): string {
  return JSON.stringify([task.title, task.prompt, task.enabled, task.schedule, task.projectId, task.threadId,
    task.workspaceStrategy, task.modelSelection, task.runtimeMode, task.interactionMode, task.createdBy, task.creationSource]);
}
/** Schedules understood by the editor. */
export type EditableSchedule = ScheduledTaskUpsertSchedule;
export function supportedSchedule(value: unknown): value is EditableSchedule {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  // The upstream write schema drops unknown fields on these variants. Never overwrite them.
  if (s.type === "once" && Object.keys(s).some((key) => !["type", "runAt"].includes(key))) return false;
  if (s.type === "webhook") {
    const extra = (value: unknown, keys: string[]) => value !== null && typeof value === "object" && Object.keys(value).some((key) => !keys.includes(key));
    if (extra(s, ["type", "signature", "maxDeliveryAgeMinutes", "dedupe", "filters"]) || extra(s.signature, ["header", "encoding", "prefix", "secret", "secretRef"]) || extra(s.dedupe, ["replayKey", "coalesceKey", "coalesceWindowSeconds"]) || Array.isArray(s.filters) && s.filters.some((filter) => extra(filter, ["path", "op", "value"]))) return false;
  }
  return s.type === "interval" ? Number.isSafeInteger(s.everyMs) && Number(s.everyMs) > 0
    : s.type === "once" ? typeof s.runAt === "string" && !Number.isNaN(Date.parse(s.runAt))
    : s.type === "webhook" ? Schema.is(ScheduledTaskUpsertSchedule)(s)
    : s.type === "fixed_time" && typeof s.timeOfDay === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.timeOfDay)
      && (s.weekdays === undefined || Array.isArray(s.weekdays) && s.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6));
}
export function taskScheduleLabel(schedule: unknown): string {
  if (schedule && typeof schedule === "object") {
    const value = schedule as Record<string, unknown>;
    if (value.type === "webhook") return "Webhook";
    if (value.type === "once" && typeof value.runAt === "string" && !Number.isNaN(Date.parse(value.runAt))) return `Once · ${new Date(value.runAt).toLocaleString()}`;
  }
  if (!supportedSchedule(schedule)) return "Unsupported schedule";
  return schedule.type === "interval" ? `Every ${schedule.everyMs / 60_000} min`
    : schedule.type === "once" ? `Once · ${new Date(schedule.runAt).toLocaleString()}`
    : schedule.type === "webhook" ? "Webhook" : `${schedule.timeOfDay}${schedule.weekdays?.length ? ` · ${schedule.weekdays.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")}` : " · Daily"}`;
}
/** Speed for new tasks: pin Standard, or leave the choice to the server and Codex config. */
export type TaskDefaultSpeed = "standard" | "inherit";
export function resolveTaskDefaultSpeed(value: unknown): TaskDefaultSpeed { return value === "inherit" ? "inherit" : "standard"; }
/** Apply the default speed to a new task's model; saved tasks keep whatever they stored. */
export function taskModelWithSpeed(providers: ReadonlyArray<ServerProvider>, selection: ModelSelection, speed: TaskDefaultSpeed): ModelSelection {
  if (speed !== "standard") return selection;
  const model = providers.find((provider) => provider.instanceId === selection.instanceId)?.models.find((model) => model.slug === selection.model);
  return withStandardSpeed(model, selection);
}
/** Explicitly cheap advertised default; do not fall back to the conversation model. */
export function newTaskModel(providers: ReadonlyArray<ServerProvider>, speed: TaskDefaultSpeed = "inherit"): ModelSelection | null {
  for (const provider of providers) {
    if (!provider.enabled || !provider.installed || provider.availability === "unavailable") continue;
    const model = provider.models.find((model) => model.slug === "gpt-6-luna");
    if (!model) continue;
    const effort = effortDescriptor(model, null);
    if (!effort?.options.some((option) => option.id === "low") || effort.promptInjectedValues?.includes("low")) continue;
    return taskModelWithSpeed(providers, { instanceId: provider.instanceId, model: model.slug, options: [{ id: effort.id, value: "low" }] }, speed);
  }
  return null;
}
