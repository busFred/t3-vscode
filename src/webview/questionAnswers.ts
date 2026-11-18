import { unstable_batchedUpdates } from "react-dom";
import type { PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { updateDraft } from "./composerDrafts";
import { carryUnsentAnswersIntoPrompt } from "../shared/unsentAnswers";

/**
 * What was typed into each open question card, outside the card itself: the card unmounts in the same render that
 * removes its request, so by the time a Stop or a provider timeout is seen its own state is already gone.
 * Renderer-local like the composer drafts; an answer leaves here when it is sent or carried to the composer.
 */
type Answers = Record<string, PendingUserInputDraftAnswer>;
const typed = new Map<string, Answers>();
const key = (threadId: string, requestId: string) => JSON.stringify([threadId, requestId]);

export const rememberQuestionAnswers = (threadId: string, requestId: string, answers: Answers): void => { typed.set(key(threadId, requestId), answers); };
export const recalledQuestionAnswers = (threadId: string, requestId: string): Answers | undefined => typed.get(key(threadId, requestId));
export const forgetQuestionAnswers = (threadId: string, requestId: string): void => { typed.delete(key(threadId, requestId)); };

/** The questions each conversation's latest snapshot reported as closed unanswered. */
const closedUnanswered = new Map<string, ReadonlySet<string>>();
export const noteUnansweredQuestions = (threadId: string, requestIds: ReadonlyArray<string>): void => { closedUnanswered.set(threadId, new Set(requestIds)); };

/**
 * An answer whose send failed goes back to its store; if Stop or a timeout already closed that question, the carry
 * has run without it, so it is carried now instead of waiting for a snapshot that will not come.
 */
export function restoreUnsentAnswers(threadId: string, requestId: string, answers: Answers): void {
  rememberQuestionAnswers(threadId, requestId, answers);
  if (closedUnanswered.get(threadId)?.has(requestId)) carryUnsentAnswersToDraft(threadId, [requestId]);
}

/** Drops this conversation's answers for questions that are neither open nor just closed unanswered (answered elsewhere, say). */
export function pruneQuestionAnswers(threadId: string, keep: ReadonlySet<string>): void {
  for (const entry of typed.keys()) {
    const [thread, requestId] = JSON.parse(entry) as [string, string];
    if (thread === threadId && !keep.has(requestId)) typed.delete(entry);
  }
}

/** Takes the typed text of each request out of the store, in question order. */
export function takeUnsentCustomAnswers(threadId: string, requestIds: ReadonlyArray<string>): string[] {
  const texts: string[] = [];
  for (const requestId of requestIds) {
    const answers = typed.get(key(threadId, requestId));
    if (!answers) continue;
    typed.delete(key(threadId, requestId));
    for (const answer of Object.values(answers)) if (answer.customAnswer?.trim()) texts.push(answer.customAnswer);
  }
  return texts;
}

/**
 * Appends the typed answers of requests that closed unanswered to the conversation's composer draft.
 * The append is one native edit when the composer is mounted, so it undoes in a single step and leaves the
 * textarea's earlier typing undoable ("borrow-focus": the field takes focus for the edit only, then gives it back).
 * When no composer is mounted it is a plain draft update, saved with the draft.
 */
export function carryUnsentAnswersToDraft(threadId: string, requestIds: ReadonlyArray<string>): boolean {
  const texts = takeUnsentCustomAnswers(threadId, requestIds);
  if (!texts.length) return false;
  // Not inside React's effect flush, and batched like an event handler. A native edit made while React cannot render
  // makes it put the textarea back to its previous rendered value before it learns of the new draft, which erases
  // the textarea's undo history. From a microtask React can render at the end of the batch, as after a click.
  queueMicrotask(() => unstable_batchedUpdates(() => updateDraft(threadId, (draft) => { const text = carryUnsentAnswersIntoPrompt(draft.text, texts); return text === draft.text ? draft : { ...draft, text }; }, "borrow-focus")));
  return true;
}
