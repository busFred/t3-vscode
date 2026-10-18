import { useEffect, useState } from "react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { ScheduledTaskEditorRequest } from "../../shared/scheduledTasks";
import { bridge } from "../bridge-client";
import { useActions } from "../actions";
import { ScheduledTaskEditor, taskDraft, type TaskDraft } from "./ScheduledTaskEditor";

/** A task owns its editor draft; changing the sidebar selection never replaces it. */
export function TaskEditorPanel({ state, request }: { state: HostStateSnapshot; request: ScheduledTaskEditorRequest | null }) {
  const run = useActions();
  const [draft, setDraft] = useState<TaskDraft | null>(() => bridge.readViewState<{ taskDraft?: TaskDraft }>()?.taskDraft ?? null);
  useEffect(() => { if (request) setDraft(previous => previous ?? taskDraft(state, request)); }, [request, state]);
  const update = (value: TaskDraft | null) => {
    bridge.saveViewState({ ...bridge.readViewState<object>(), taskDraft: value }); setDraft(value);
  };
  if (!draft) return <p className="empty-list">{request ? "Task unavailable." : "Opening task…"}</p>;
  return <div className="task-editor-panel"><ScheduledTaskEditor state={state} draft={draft} returnLabel="Task manager"
    onChange={value => { update(value); void run("keepTab"); }}
    onReturn={discard => { if (discard) { update(null); void run("closeTaskTab"); } else void run("openTaskManager"); }}
    onReload={() => { if (request) update(taskDraft(state, request)); }} /></div>;
}
