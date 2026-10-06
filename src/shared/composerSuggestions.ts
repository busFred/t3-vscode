/** T3 composer matching adapted for a textarea and the extension-host bridge. */
import type { ServerProvider } from "@t3tools/contracts";
import { getProviderSkillsForSlashMenu, getProviderSlashCommandsForSlashMenu, resolveProviderSkillsForCwd, resolveProviderSlashCommandsForCwd } from "@t3tools/client-runtime/providerSkills";
import { normalizeSearchQuery, scoreQueryMatch } from "@t3tools/shared/searchRanking";
import { detectComposerTrigger as detectTrigger, type ComposerTrigger } from "@t3tools/shared/composerTrigger";
import type { ComposerSuggestion, ThreadSummary } from "./bridge.js";

export function detectComposerTrigger(text: string, cursor: number): ComposerTrigger | null {
  const trigger = detectTrigger(text, cursor);
  // Web offers /model as a local action in the same command list.
  return trigger?.kind === "slash-model" ? { ...trigger, kind: "slash-command", query: "model" } : trigger;
}
export function slashSuggestions(provider: ServerProvider | undefined, cwd: string | null, query: string, atPromptStart: boolean): ComposerSuggestion[] {
  const skills = provider ? getProviderSkillsForSlashMenu(resolveProviderSkillsForCwd(provider, cwd), true) : [];
  const commands = provider ? getProviderSlashCommandsForSlashMenu(resolveProviderSlashCommandsForCwd(provider, cwd), skills) : [];
  const items: ComposerSuggestion[] = [
    { id: "model", kind: "model", value: "", label: "/model", description: "Switch response model for this thread" },
    { id: "usage", kind: "usage", value: "", label: "/usage-limits", description: "Show this provider's usage limits" },
    ...(atPromptStart ? commands.filter((command) => command.name !== "model" && command.name !== "usage-limits").map((command) => ({ id: `command:${command.name}`, kind: "command" as const, value: `/${command.name} `, label: `/${command.name}`, description: command.description ?? command.input?.hint ?? "Run provider command" })) : []),
    ...skills.map((skill) => ({ id: `skill:${skill.name}`, kind: "skill" as const, value: `$${skill.name} `, label: `/skill:${skill.name}`, description: skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : "") })),
  ];
  const normalized = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalized) return items;
  return items.flatMap((item) => {
    const value = item.label.slice(1).toLowerCase();
    const score = scoreQueryMatch({ value, query: normalized, exactBase: 0, prefixBase: 2, boundaryBase: 4, includesBase: 6, fuzzyBase: 100, boundaryMarkers: ["-", "_", "/", ":"] });
    const descriptionScore = scoreQueryMatch({ value: item.description.toLowerCase(), query: normalized, exactBase: 20, prefixBase: 22, boundaryBase: 24, includesBase: 26 });
    const scores = [score, descriptionScore].filter((value): value is number => value !== null);
    return scores.length ? [{ item, score: Math.min(...scores) }] : [];
  }).sort((a, b) => a.score - b.score || a.item.id.localeCompare(b.item.id)).map(({ item }) => item);
}
/** Like T3's sidebar: title/PR matches precede server-provided message matches. */
export function searchThreads(threads: ReadonlyArray<ThreadSummary>, query: string, contentIds: ReadonlySet<string>): ThreadSummary[] {
  const normalized = query.trim().toLowerCase();
  const title = threads.filter((thread) => [thread.title, ...thread.searchTerms ?? []].some((term) => term.toLowerCase().includes(normalized)));
  const titleIds = new Set(title.map((thread) => thread.id));
  return [...title, ...threads.filter((thread) => !titleIds.has(thread.id) && contentIds.has(thread.id))];
}
