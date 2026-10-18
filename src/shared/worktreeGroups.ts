import type { HostStateSnapshot, ProjectSummary, ThreadSummary } from "./bridge.js";
import type { WorktreeChoice, WorktreeSummary } from "./worktrees.js";
import { sessionTree, type SessionTreeNode } from "./sessionTree.js";

/** Backend paths are canonical; tolerate separator/trailing-slash differences in older snapshots. */
export function checkoutPath(path: string): string {
  const forward = path.replaceAll("\\", "/");
  const normal = forward.replace(/\/+$/, "") || (forward.startsWith("/") ? "/" : "");
  return /^[a-z]:(?:\/|$)/i.test(normal) ? normal.toLowerCase() : normal;
}

/** Keep the supplied checkout spelling; containment always respects directory boundaries. */
export function checkoutForWorkingDirectory(path: string, checkoutPaths: ReadonlyArray<string>): string | undefined {
  const working = checkoutPath(path);
  let match: string | undefined; let longest = -1;
  for (const candidate of checkoutPaths) {
    const checkout = checkoutPath(candidate);
    if (!checkout) continue;
    if (working === checkout) return candidate;
    const prefix = checkout.endsWith("/") ? checkout : `${checkout}/`;
    if (working.startsWith(prefix) && checkout.length > longest) { match = candidate; longest = checkout.length; }
  }
  return match;
}

export function existingCheckoutChoice(item: WorktreeSummary): WorktreeChoice {
  const projectCheckout = item.projectCheckoutPath ?? item.projectRoot;
  return (projectCheckout ? checkoutPath(item.path) === checkoutPath(projectCheckout) : item.root)
    ? { type: "root" } : { type: "existing", path: item.path };
}

export interface RepositoryCheckout {
  readonly item: WorktreeSummary;
  readonly sources: ReadonlyArray<WorktreeSummary>;
  readonly sessions: ReadonlyArray<ThreadSummary>;
}
export interface RepositoryGroup {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly checkouts: ReadonlyArray<RepositoryCheckout>;
}

export function worktreeRepositoryGroups(state: Pick<HostStateSnapshot, "projects" | "threads" | "worktrees">): ReadonlyArray<RepositoryGroup> {
  const items = state.worktrees?.items ?? [];
  const projectGroups = new Map(state.projects.map((project) => [project.id, items.find((item) => item.projectId === project.id && item.repositoryId)?.repositoryId]));
  const groups = new Map<string, ProjectSummary[]>();
  for (const project of state.projects) {
    const repository = projectGroups.get(project.id);
    const id = repository ? `repository:${repository}` : `project:${project.id}`;
    groups.set(id, [...groups.get(id) ?? [], project]);
  }
  return [...groups].map(([id, projects]) => {
    const projectIds = new Set(projects.map((project) => project.id));
    const paths = new Map<string, WorktreeSummary[]>();
    for (const item of items) if (projectIds.has(item.projectId)) {
      const path = checkoutPath(item.path);
      paths.set(path, [...paths.get(path) ?? [], item]);
    }
    const sessions = new Map<string, ThreadSummary[]>();
    const seen = new Set<string>();
    for (const thread of state.threads) {
      if (!projectIds.has(thread.projectId) || seen.has(thread.id)) continue;
      const project = projects.find((project) => project.id === thread.projectId);
      const effectivePath = thread.worktreePath ?? project?.workspaceRoot;
      // Missing worktreePath means the owning service project's root, which can be linked.
      const effectiveKey = effectivePath ? checkoutPath(effectivePath) : undefined;
      // Exact paths remain authoritative over stale IDs; canonical backend membership
      // must beat lexical containment when a nested symlink points to another checkout.
      const exact = effectiveKey !== undefined && paths.has(effectiveKey) ? effectiveKey : undefined;
      const membership = [...paths].find(([, sources]) => sources.some((source) => source.projectId === thread.projectId && source.threadIds.includes(thread.id)))?.[0];
      const projectCheckout = !thread.worktreePath ? items.find((item) => item.projectId === thread.projectId && item.projectCheckoutPath)?.projectCheckoutPath : undefined;
      const containing = effectivePath ? checkoutForWorkingDirectory(effectivePath, [...paths.keys()]) : undefined;
      const path = exact ?? membership ?? (projectCheckout === undefined ? undefined : checkoutPath(projectCheckout)) ?? containing;
      if (!path || !paths.has(path)) continue;
      sessions.set(path, [...sessions.get(path) ?? [], thread]);
      seen.add(thread.id);
    }
    // Establish lineage repository-wide before grouping. A child can use another
    // checkout while remaining beneath its ordinary parent, just as in Sessions.
    const threadPaths = new Map([...sessions].flatMap(([path, threads]) => threads.map((thread) => [thread.id, path] as const)));
    const displayedSessions = new Map<string, ThreadSummary[]>();
    const flatten = (node: SessionTreeNode): ThreadSummary[] => [node.thread, ...node.children.flatMap(flatten)];
    const repositoryThreads = [...new Map(state.threads.filter((thread) => projectIds.has(thread.projectId)).map((thread) => [thread.id, thread])).values()];
    for (const node of sessionTree(repositoryThreads)) {
      const path = threadPaths.get(node.thread.id);
      if (path) displayedSessions.set(path, [...displayedSessions.get(path) ?? [], ...flatten(node)]);
    }
    const mainPath = items.find((item) => projectIds.has(item.projectId) && item.root)?.path;
    const projectCheckout = (project: ProjectSummary) => items.find((item) => item.projectId === project.id && item.projectCheckoutPath)?.projectCheckoutPath
      ?? checkoutForWorkingDirectory(project.workspaceRoot, [...paths.keys()]);
    const mainProject = projects.find((project) => { const checkout = projectCheckout(project); return mainPath && checkout && checkoutPath(checkout) === checkoutPath(mainPath); });
    const checkouts = [...paths].map(([path, sources]): RepositoryCheckout => {
      // A newly registered linked-root service project must not silently change existing setup ownership.
      const representative = sources.find((source) => source.projectId === mainProject?.id)
        ?? sources.find((source) => { const project = projects.find((project) => project.id === source.projectId); const checkout = project ? projectCheckout(project) : source.projectCheckoutPath; return checkout && checkoutPath(checkout) === path; }) ?? sources[0]!;
      return { item: { ...representative, active: sources.some((source) => source.active), missing: sources.every((source) => source.missing), ...(sources.some((source) => source.openInWindow !== undefined) ? { openInWindow: sources.some((source) => source.openInWindow) } : {}), threadIds: (sessions.get(path) ?? []).map((thread) => thread.id) }, sources, sessions: displayedSessions.get(path) ?? [] };
    }).sort((a, b) => Number(b.item.root) - Number(a.item.root));
    const main = checkouts.find((checkout) => checkout.item.root)?.item;
    const project = mainProject ?? projects.find((project) => main && checkoutPath(project.workspaceRoot) === checkoutPath(main.path)) ?? projects[0]!;
    return { id, title: project.title, path: main?.path ?? project.workspaceRoot, projects, checkouts };
  });
}

export function worktreeVisibilityScope(state: Pick<HostStateSnapshot, "home" | "environment" | "workspaceRoots">): string {
  return JSON.stringify([state.environment?.environmentId ?? "", state.home, [...state.workspaceRoots].map(checkoutPath).sort()]);
}
