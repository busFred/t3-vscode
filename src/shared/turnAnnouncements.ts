/**
 * What a screen reader should hear while a turn runs (T3 0.1.9's activity announcements), so the
 * reader does not have to leave the composer to follow along.
 *
 * Deliberately terse and deduplicated: a live region that repeats itself, or narrates every
 * streaming token, is worse than silence. Callers announce only when the returned text changes.
 */

export interface AnnouncementItem {
  readonly type: string;
  /** The row's presented label, such as a command line or tool title. */
  readonly label?: string | null;
  readonly status?: string | null;
  readonly streaming?: boolean;
}

export interface AnnouncementState {
  /** The conversation's own run is active. */
  readonly running: boolean;
  /** Newest last; only the tail matters. */
  readonly items: ReadonlyArray<AnnouncementItem>;
  readonly pendingApprovals?: number;
  readonly pendingQuestions?: number;
  readonly pendingSecrets?: number;
}

const WORKING = new Set(["running", "pending"]);

/** A tool/work row's phrase. Falls back to the item type where nothing named it. */
function workPhrase(item: AnnouncementItem): string {
  const label = item.label?.trim();
  if (label) return label;
  switch (item.type) {
    case "command_execution": return "Running a command";
    case "file_change": return "Editing files";
    case "file_search": return "Searching files";
    case "web_search": return "Searching the web";
    case "reasoning": return "Thinking";
    case "subagent": return "Delegating to a subagent";
    default: return "Working";
  }
}

/**
 * The single most useful thing to say right now, or null for silence.
 *
 * Anything waiting on the person wins: that is the only state where the reader must act. Otherwise
 * a finished assistant message is announced, then whatever work is in flight.
 */
export function turnAnnouncement(state: AnnouncementState): string | null {
  const secrets = state.pendingSecrets ?? 0;
  const approvals = state.pendingApprovals ?? 0;
  const questions = state.pendingQuestions ?? 0;
  if (secrets > 0) return "A secret is requested";
  if (approvals > 0) return approvals === 1 ? "Approval needed" : `${approvals} approvals needed`;
  if (questions > 0) return questions === 1 ? "A question is waiting" : `${questions} questions are waiting`;

  const last = state.items.at(-1);
  if (!last) return state.running ? "Working" : null;

  // A streaming message is announced once it settles; narrating each chunk would never stop.
  if (last.type === "assistant_message") {
    if (last.streaming === true) return state.running ? "Replying" : null;
    return "Assistant replied";
  }
  if (last.type === "error") return "The turn failed";
  if (last.type === "run_interrupt_request" || last.type === "run_interrupt") return "The turn was interrupted";

  if (WORKING.has(last.status ?? "") || state.running) return workPhrase(last);
  return state.running ? "Working" : null;
}
