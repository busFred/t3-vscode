import type { HostStateSnapshot, ProjectSummary } from "../shared/bridge";

/** A project's title plus its machine, so projects with the same name on several machines stay distinguishable. */
export function projectOptionLabel(state: Pick<HostStateSnapshot, "projects" | "environments" | "environment">, project: ProjectSummary): string {
  const sameTitle = state.projects.filter((item) => item.title === project.title).length > 1;
  const machine = project.environmentLabel ?? state.environments?.local?.label ?? state.environment?.label ?? "This computer";
  return sameTitle || project.environmentLabel ? `${project.title} · ${machine}` : project.title;
}
