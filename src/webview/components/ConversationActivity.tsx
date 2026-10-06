import { useState } from "react";
import { CheckIcon, ChevronDownIcon, CircleDotIcon, CircleIcon, CornerUpRightIcon, GripVerticalIcon, ListOrderedIcon, ListTodoIcon, PencilIcon, PlayIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";

export function ConversationActivity({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(false);
  const queue = state.queue; const tasks = state.tasks;
  const completed = tasks?.steps.filter((step) => step.status === "completed").length ?? 0;
  const current = tasks?.steps.find((step) => step.status === "running") ?? tasks?.steps.find((step) => step.status === "pending") ?? tasks?.steps.at(-1);
  const action = async (kind: string, id?: string, params?: object) => {
    setBusy(id ?? "queue");
    const ok = await run("queueAction", { threadId: state.activeThreadId, action: kind, ...(id ? { runId: id } : {}), ...params });
    setBusy(null); return ok;
  };
  if (!queue?.entries.length && !tasks) return null;
  return <div className="conversation-activity">
    {queue?.entries.length ? <section className="queue-section">
      <button className="activity-summary" aria-label={`${queueOpen ? "Collapse" : "Expand"} queued messages`} aria-expanded={queueOpen} onClick={() => setQueueOpen(!queueOpen)}><ListOrderedIcon size={14} /><span>Queued{queue.held ? " · Paused" : ""}</span><span className="activity-count">{queue.entries.length}</span><ChevronDownIcon size={13} className={queueOpen ? "expanded" : ""} /></button>
      {queue.held ? <button className="text-button queue-resume" disabled={busy !== null} onClick={() => { void action("resume"); }}><PlayIcon size={12} /> Resume queue</button> : null}
      {queueOpen ? <div className="queue-list" onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={(event) => { if (!dragging || event.target !== event.currentTarget) return; event.preventDefault(); void action("reorder", dragging, { beforeRunId: null }); setDragging(null); }}>
        {queue.entries.map((entry) => <div className={`queued-message${dragging === entry.runId ? " dragging" : ""}`} key={entry.runId} onDragOver={(event) => { if (dragging && dragging !== entry.runId) event.preventDefault(); }} onDrop={(event) => { if (!dragging || dragging === entry.runId) return; event.preventDefault(); event.stopPropagation(); void action("reorder", dragging, { beforeRunId: entry.runId }); setDragging(null); }}>
          <button className="queue-grip icon-button" title="Drag to reorder; use arrow keys to move" aria-label="Reorder queued message" disabled={!queue.canReorder || busy !== null} draggable={queue.canReorder && busy === null} onDragStart={(event) => { event.dataTransfer.setData("application/x-t3-queued-run", entry.runId); event.dataTransfer.effectAllowed = "move"; setDragging(entry.runId); }} onDragEnd={() => setDragging(null)} onKeyDown={(event) => {
            const index = queue.entries.indexOf(entry);
            if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); void action("reorder", entry.runId, { beforeRunId: queue.entries[index - 1]!.runId }); }
            if (event.key === "ArrowDown" && index < queue.entries.length - 1) { event.preventDefault(); void action("reorder", entry.runId, { beforeRunId: queue.entries[index + 2]?.runId ?? null }); }
          }}><GripVerticalIcon size={13} /></button>
          {editing?.id === entry.runId ? <div className="queue-editor"><textarea aria-label="Edit queued message" value={editing.text} disabled={busy === entry.runId} onChange={(event) => setEditing({ ...editing, text: event.target.value })} /><div><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy !== null || !editing.text.trim()} onClick={() => { void action("edit", entry.runId, { text: editing.text }).then((ok) => { if (ok) setEditing(null); }); }}>Save queued message</button></div></div>
            : <><span className="queued-preview" title={`${entry.text}${entry.attachmentNames.length ? `\n${entry.attachmentNames.join(", ")}` : ""}`}>{entry.attachmentNames.length ? <small>{entry.attachmentNames.length} attachment{entry.attachmentNames.length > 1 ? "s" : ""} · </small> : null}{entry.text}</span>
              <button className="icon-button" aria-label="Edit queued message" disabled={busy !== null} onClick={() => setEditing({ id: entry.runId, text: entry.text })}><PencilIcon size={13} /></button>
              <button className="queue-steer" aria-label="Steer with queued message" title="Send to the running turn now" disabled={!queue.canSteer || busy !== null} onClick={() => { void action("steer", entry.runId); }}><CornerUpRightIcon size={13} /><span>Steer</span></button>
              <button className="icon-button" aria-label="Cancel queued message" disabled={busy !== null} onClick={() => { void action("cancel", entry.runId); }}><XIcon size={13} /></button></>}
        </div>)}
      </div> : null}
    </section> : null}
    {tasks && current ? <section className="tasks-section"><button className="activity-summary" aria-label={`${tasksOpen ? "Collapse" : "Expand"} tasks: ${completed} of ${tasks.steps.length} complete`} aria-expanded={tasksOpen} onClick={() => setTasksOpen(!tasksOpen)}><ListTodoIcon size={14} /><span>Tasks</span><strong title={current.text}>{current.text}</strong><span className="activity-count">{completed}/{tasks.steps.length}</span>{tasks.steps.length <= 10 ? <span className="task-segments" aria-hidden="true">{tasks.steps.map((step, index) => <i className={step.status} key={index} />)}</span> : null}<ChevronDownIcon size={13} className={tasksOpen ? "expanded" : ""} /></button>
      {tasksOpen ? <ol className="task-list">{tasks.steps.map((step, index) => <li key={index} className={step.status}>{step.status === "completed" ? <CheckIcon size={13} /> : step.status === "running" ? <CircleDotIcon size={13} /> : <CircleIcon size={13} />}<span>{step.text}</span><small>{step.status === "running" ? "Running" : step.status === "completed" ? "Completed" : "Pending"}</small></li>)}</ol> : null}
    </section> : null}
  </div>;
}
