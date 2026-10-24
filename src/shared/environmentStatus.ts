/** Presentation of paired T3 machines for the sidebar's Environments section. */

export type RemoteConnectionState = "connecting" | "connected" | "error" | "expired" | "disabled";
export type EnvironmentDisplayStatus = "connected" | "connecting" | "reconnecting" | "expiring" | "expired" | "disabled";
export type EnvironmentIndicator = "ok" | "warn" | "error";
export interface EnvironmentRow {
  readonly environmentId: string; readonly label: string; readonly host: string; readonly serverVersion?: string;
  readonly status: EnvironmentDisplayStatus; readonly detail?: string; readonly expiresAt: number | null;
  /** The user ignored this exact problem; it no longer colours the section's dot. */
  readonly ignored: boolean;
}

/** T3 pairings last a fixed 30 days; warn during the last three. */
export const EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export function environmentDisplayStatus(input: { readonly state: RemoteConnectionState; readonly enabled: boolean; readonly expiresAt: number | null }, now: number): EnvironmentDisplayStatus {
  if (!input.enabled || input.state === "disabled") return "disabled";
  if (input.state === "expired") return "expired";
  if (input.state === "error") return "reconnecting";
  if (input.state === "connecting") return "connecting";
  return input.expiresAt !== null && input.expiresAt - now <= EXPIRY_WARNING_MS ? "expiring" : "connected";
}

/** The worst problem nobody ignored: an expired pairing outranks a temporary one. Disabled machines never count. */
export function environmentIndicator(rows: ReadonlyArray<Pick<EnvironmentRow, "status" | "ignored">>): EnvironmentIndicator {
  const open = rows.filter((row) => !row.ignored);
  if (open.some((row) => row.status === "expired")) return "error";
  return open.some((row) => row.status === "reconnecting" || row.status === "expiring") ? "warn" : "ok";
}

export function expiryLabel(expiresAt: number, now: number): string {
  const hours = Math.max(0, Math.floor((expiresAt - now) / 3_600_000));
  if (hours >= 48) return `Expires in ${Math.floor(hours / 24)} days`;
  if (hours >= 24) return "Expires in 1 day";
  return hours >= 1 ? `Expires in ${hours} hour${hours === 1 ? "" : "s"}` : "Expires within an hour";
}
