/** Public setup guidance only; connection credentials remain in the host. */
export interface ConnectionProblem {
  readonly kind: "missing-runtime" | "server-stopped" | "unreachable" | "incompatible" | "cli-missing" | "pairing" | "connection";
  readonly serviceManaged?: boolean;
}

export interface ConnectionSetup {
  readonly startCommand: string;
  readonly serveCommand: string;
  /** Service commands are offered only for the normal home on supported hosts. */
  readonly serviceSupported: boolean;
  readonly startupHint?: string;
  readonly problem?: ConnectionProblem;
}
