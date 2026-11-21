export { parseSideChatCommand } from "@t3tools/shared/composerTrigger";

export function sideChatDisabledReason(input: {
  sideChat?: boolean;
  subagent?: boolean;
  capability: boolean | undefined;
  hasUserMessage: boolean;
  worktreePending?: boolean;
}): string | null {
  if (input.sideChat) return "Side chats cannot start side chats.";
  if (input.subagent) return "Subagent threads cannot start side chats.";
  if (input.capability === undefined) return "Side chats are not ready yet. Try again in a moment.";
  if (!input.capability) return "Update this environment's T3 Code server to use side chats.";
  if (!input.hasUserMessage) return "Side chats start after the first message.";
  if (input.worktreePending) return "Available once the thread's worktree is set up.";
  return null;
}
