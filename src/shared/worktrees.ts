import type { ModelSelection } from "./bridge.js";
import type { WorktreeEnvironmentProfile, WorktreeEnvironmentRecord } from "./worktreeEnvironment.js";

/** Extension view models. The T3 service remains authoritative for threads and checkouts. */
export interface WorktreeChoice {
  readonly type: "root" | "new" | "existing" | "branch" | "pr";
  readonly path?: string;
  readonly branch?: string;
  readonly baseRef?: string;
  readonly reference?: string;
  readonly startFromOrigin?: boolean;
  readonly copyEnv?: boolean;
  readonly runs?: ReadonlyArray<{ readonly modelSelection: ModelSelection; readonly count: number }>;
}
export interface WorktreeSummary {
  readonly id: string;
  readonly projectId: string;
  /** Physical Git identity, independent of the service's project records. */
  readonly repositoryId?: string;
  readonly projectRoot?: string;
  /** Canonical checkout containing the owning service project's working directory. */
  readonly projectCheckoutPath?: string;
  readonly openInWindow?: boolean;
  readonly head?: string;
  readonly path: string;
  readonly branch: string;
  readonly root: boolean;
  readonly missing: boolean;
  readonly locked?: boolean;
  readonly imported?: boolean;
  readonly threadIds: ReadonlyArray<string>;
  readonly active: boolean;
  readonly environment?: WorktreeEnvironmentRecord | null;
  readonly environmentCommand?: string;
  readonly environmentInstructions?: string;
}
export interface ProjectAction {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly icon: string;
  readonly runOnWorktreeCreate: boolean;
  readonly async?: boolean;
  readonly runOnSettle?: boolean;
}
/** How a session reacts when its checkout is on a different branch than the session records. */
export type SessionBranchPolicy = "follow" | "pinned";
export interface WorktreeProjectSettings {
  readonly capabilities?: { readonly worktreesDirectory: boolean; readonly cleanupRetention: boolean; readonly runOnSettle: boolean };
  readonly projectId: string;
  readonly actions: ReadonlyArray<ProjectAction>;
  readonly fileActions: ReadonlyArray<ProjectAction>;
  readonly fileError?: string;
  readonly environment: WorktreeEnvironmentProfile;
  readonly startFromOrigin: boolean;
  readonly branchPrefix: string;
  readonly location: string;
  readonly submodules: "recursive" | "top-level" | "none";
  readonly copyEnv: boolean;
  /** Extension-only project default; sessions may override it. */
  readonly branchPolicy?: SessionBranchPolicy;
  readonly sessionBranchPolicies?: Readonly<Record<string, SessionBranchPolicy>>;
  readonly cleanup: {
    readonly enabled: boolean;
    readonly inactiveDays: number;
    readonly settledDays: number | null;
    readonly merged: boolean;
    readonly unchanged: boolean;
    readonly keepLocalFiles: "any" | "uncommitted" | "tracked";
  };
}
export interface WorktreePreparation {
  readonly updatedAt?: number;
  readonly backgroundRunning?: boolean;
  readonly background?: boolean;
  readonly groupId?: string;
  readonly title?: string;
  readonly id: string;
  readonly projectId: string;
  readonly path?: string;
  readonly branch?: string;
  readonly threadId?: string;
  readonly phase: "running" | "ready" | "failed" | "cancelled";
  readonly stage: string;
  readonly log: string;
  readonly error?: string;
}
export interface WorktreesState {
  readonly loading: boolean;
  readonly error?: string;
  readonly items: ReadonlyArray<WorktreeSummary>;
  readonly branches: ReadonlyArray<{ readonly projectId: string; readonly name: string; readonly path: string | null; readonly remote: boolean }>;
  readonly settings: ReadonlyArray<WorktreeProjectSettings>;
  readonly preparations: ReadonlyArray<WorktreePreparation>;
}
export interface WorktreeReview {
  readonly projectId: string;
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly additions: number; readonly deletions: number }>;
}
