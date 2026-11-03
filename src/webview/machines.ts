import type { HostStateSnapshot } from "../shared/bridge";
import type { EnvironmentRow } from "../shared/environmentStatus";
import type { PeerLinksState } from "../shared/peerLinks";
export interface MachineRow {
  readonly environmentId: string; readonly label: string; readonly local: boolean;
  readonly conversations: boolean; readonly conversation?: EnvironmentRow;
  readonly agents?: PeerLinksState["links"][number]; readonly address?: string | undefined;
}
/** Identity, rather than display name or address, joins the two independent capabilities. */
export function mergeMachines(environments: HostStateSnapshot["environments"], peers?: PeerLinksState): MachineRow[] {
  const rows = new Map<string, MachineRow>();
  if (environments?.local) rows.set(peers?.environmentId ?? "local", { environmentId: peers?.environmentId ?? "local", label: environments.local.label, local: true, conversations: true });
  for (const row of environments?.rows ?? []) rows.set(row.environmentId, { environmentId: row.environmentId, label: row.label, local: false, conversations: true, conversation: row });
  for (const link of peers?.links ?? []) {
    const row = rows.get(link.environmentId);
    if (row?.local) continue;
    rows.set(link.environmentId, { ...row, environmentId: link.environmentId, label: row?.label ?? link.label, local: false, conversations: row?.conversations ?? false, agents: link });
  }
  return [...rows.values()].map(row => ({ ...row, address: peers?.machines.find(machine => machine.environmentId === row.environmentId)?.urls[0] }));
}
