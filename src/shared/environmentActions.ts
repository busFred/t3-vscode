/** Which actions each Environments row offers, kept pure so it can be tested without rendering. */
import type { EnvironmentDisplayStatus, EnvironmentRow } from "./environmentStatus";

export type EnvironmentActionName = "add" | "pairAgain" | "enable" | "disable" | "reconnect" | "remove" | "ignore" | "unignore";
export type EnvironmentIconAction = "reconnect" | "disable" | "remove";

export interface EnvironmentRowActions {
  /** Text buttons shown beside the status, in order. */
  readonly text: ReadonlyArray<"pairAgain" | "enable" | "ignore" | "unignore">;
  /** Hover icon buttons, in order. */
  readonly icons: ReadonlyArray<EnvironmentIconAction>;
}

const ALL_ICONS: ReadonlyArray<EnvironmentIconAction> = ["reconnect", "disable", "remove"];

export function environmentRowActions(row: Pick<EnvironmentRow, "status" | "ignored">): EnvironmentRowActions {
  const ignore = row.ignored ? "unignore" as const : "ignore" as const;
  const status: EnvironmentDisplayStatus = row.status;
  switch (status) {
    // Reconnect restarts the retry now instead of waiting out the backoff, so it stays useful while reconnecting.
    case "connected": return { text: [], icons: ALL_ICONS };
    case "connecting": return { text: [], icons: [] };
    case "reconnecting": return { text: [ignore], icons: ALL_ICONS };
    case "expiring": return { text: ["pairAgain", ignore], icons: ALL_ICONS };
    // A pairing that expired cannot be revived by retrying; only a new link helps.
    case "expired": return { text: ["pairAgain", ignore], icons: ["disable", "remove"] };
    case "disabled": return { text: ["enable"], icons: ["remove"] };
  }
}

/** The status to store in the catalog for an ignore or unignore (null clears it); throws when there is nothing to ignore. */
export function ignoreChange(action: "ignore" | "unignore", shown: EnvironmentDisplayStatus | undefined): "reconnecting" | "expiring" | "expired" | null {
  if (action === "unignore") return null;
  // Only the problem showing now is ignored; a different one later still counts.
  if (shown !== "reconnecting" && shown !== "expiring" && shown !== "expired") throw new Error("This machine has nothing to ignore.");
  return shown;
}
