import type { HostStateSnapshot } from "../../shared/bridge";

export function defaultWorktreeBase(state: HostStateSnapshot, projectId: string): string {
  if (state.worktrees?.branches.some((branch) => branch.projectId === projectId && branch.name === "main" && !branch.remote)) return "main";
  return state.worktrees?.items.find((item) => item.projectId === projectId && item.root)?.branch || "HEAD";
}
export function defaultWorktreeDestination(state: HostStateSnapshot, projectId: string, source: string): string {
  const items = state.worktrees?.items.filter((item) => item.projectId === projectId && !item.missing && item.path !== source) ?? [];
  const normal = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");
  return items.find((item) => state.workspaceRoots.some((root) => normal(root) === normal(item.path)))?.path ?? items.find((item) => item.root)?.path ?? "";
}
