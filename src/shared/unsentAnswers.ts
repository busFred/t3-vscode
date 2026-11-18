/**
 * Typed question answers that were never sent (T3 0.1.10): when Stop cancels an open question, or the provider
 * times it out, the text the person wrote moves to the conversation's composer draft instead of vanishing.
 */
const SEPARATOR = "\n\n";

/** `prompt` with `customAnswer` appended after a blank line; nothing changes for an empty answer. */
export function carryDisplacedCustomAnswerIntoPrompt(prompt: string, customAnswer: string | undefined): string {
  const displaced = customAnswer?.trim() ?? "";
  if (displaced.length === 0) return prompt;
  if (prompt.trim().length === 0) return displaced;
  return `${prompt.trimEnd()}${SEPARATOR}${displaced}`;
}

/** Carries each answer in order, so several unsent questions land as separate paragraphs. */
export function carryUnsentAnswersIntoPrompt(prompt: string, customAnswers: ReadonlyArray<string | undefined>): string {
  return customAnswers.reduce<string>((next, answer) => carryDisplacedCustomAnswerIntoPrompt(next, answer), prompt);
}
