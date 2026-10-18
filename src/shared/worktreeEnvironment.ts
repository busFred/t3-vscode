/** A project opt-in. This does not activate commands executed by the agent service. */
export interface WorktreeEnvironmentProfile {
  enabled: boolean;
  autoCleanup: boolean;
  location: "directory" | "named";
  directory: string;
  namePrefix: string;
  seed: "file" | "clone";
  specification: string;
  cloneFrom: string;
  customSetup: string;
  editable: string[];
  condaExecutable: string;
}

export type WorktreeEnvironmentStatus = "preparing" | "ready" | "failed" | "cancelled" | "removed";

/** Captured while the checkout exists; later cleanup must independently prove it unchanged. */
export interface WorktreeEnvironmentCheckoutIdentity {
  commonDir: string;
  gitDir: string;
  parentPath: string;
  parentDevice: string;
  commonDevice: string;
  commonInode: string;
  gitDevice?: string;
  gitInode?: string;
}

export interface WorktreeEnvironmentRecord {
  version: 1;
  id: string;
  scope: string;
  projectRoot: string;
  worktreePath: string;
  location: "directory" | "named";
  target: string;
  prefix: string | null;
  status: WorktreeEnvironmentStatus;
  /** Reserved before creation, after checking for an unowned environment. */
  reserved: boolean;
  profile: WorktreeEnvironmentProfile;
  updatedAt: string;
  diagnostics: string[];
  checkoutIdentity?: WorktreeEnvironmentCheckoutIdentity;
  missingSince?: string;
}

export interface WorktreeEnvironmentProgress {
  stage: "create" | "setup" | "editable" | "verify" | "ready";
  message: string;
}

export const DEFAULT_WORKTREE_ENVIRONMENT_PROFILE: Readonly<WorktreeEnvironmentProfile> = {
  enabled: false,
  autoCleanup: true,
  location: "directory",
  directory: ".conda-env",
  namePrefix: "t3",
  seed: "file",
  specification: "environment.yml",
  cloneFrom: "cvafa",
  customSetup: "bash ./setup.sh",
  editable: [],
  condaExecutable: "conda",
};
