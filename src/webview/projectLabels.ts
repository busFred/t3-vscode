import type { HostStateSnapshot, ProjectSummary } from "../shared/bridge";

/** Repeated project names are replaced by their machine; multi-root choices retain distinct titles. */
export function projectOptionLabel(state: Pick<HostStateSnapshot, "projects" | "environments" | "environment">, project: ProjectSummary): string {
  const sameTitle = state.projects.filter((item) => item.title === project.title).length > 1;
  const machine = project.environmentLabel ?? state.environments?.local?.label ?? state.environment?.label ?? "This computer";
  return sameTitle ? (state.projects.some((other) => other.id !== project.id && other.title === project.title && (other.environmentId ?? other.environmentLabel) === (project.environmentId ?? project.environmentLabel)) ? `${project.title} · ${project.workspaceRoot}` : machine) : project.environmentLabel ? `${project.title} · ${machine}` : project.title;
}
