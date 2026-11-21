import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { parseSideChatCommand } from "@t3tools/shared/composerTrigger";
export { parseSideChatCommand };

/**
 * Where the typed prompt starts. A "Replying to" chip leads the text with its token, while T3 keeps
 * the reply apart from the prompt, so the prompt starts after that token and its space.
 */
export function promptStart(text: string): number {
  const reply = collectComposerContextReferences(text).find((reference) => reference.kind === "response" && reference.start === 0);
  return reply ? reply.end + (text[reply.end] === " " ? 1 : 0) : 0;
}

/** `/side` or `/btw` as the prompt, after any leading reply, which then leads the side chat's message as in T3. */
export function parseSideChatMessage(text: string): { prompt: string } | null {
  const start = promptStart(text);
  const side = parseSideChatCommand(text.slice(start));
  if (!side) return null;
  return { prompt: start ? `${text.slice(0, start).trimEnd()} ${side.prompt}` : side.prompt };
}

/** Why a thread cannot start a side chat, as a short code that travels in every thread summary. */
export type SideChatBlock = "side-chat" | "subagent" | "not-ready" | "unsupported" | "no-message" | "worktree";
const BLOCK_MESSAGES: Record<SideChatBlock, string> = {
  "side-chat": "Side chats cannot start side chats.",
  subagent: "Subagent threads cannot start side chats.",
  "not-ready": "Side chats are not ready yet. Try again in a moment.",
  unsupported: "Update this environment's T3 Code server to use side chats.",
  "no-message": "Side chats start after the first message.",
  worktree: "Available once the thread's worktree is set up.",
};
export function sideChatBlockMessage(block: SideChatBlock | null | undefined): string | null { return block ? BLOCK_MESSAGES[block] : null; }

export function sideChatBlockCode(input: {
  sideChat?: boolean;
  subagent?: boolean;
  capability: boolean | undefined;
  hasUserMessage: boolean;
  worktreePending?: boolean;
}): SideChatBlock | null {
  if (input.sideChat) return "side-chat";
  if (input.subagent) return "subagent";
  if (input.capability === undefined) return "not-ready";
  if (!input.capability) return "unsupported";
  if (!input.hasUserMessage) return "no-message";
  if (input.worktreePending) return "worktree";
  return null;
}

export function sideChatDisabledReason(input: Parameters<typeof sideChatBlockCode>[0]): string | null {
  return sideChatBlockMessage(sideChatBlockCode(input));
}
