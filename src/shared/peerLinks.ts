import { EnvironmentId, managedCapabilityDenial, type AuthMcpClientAccess, type ServerConfig } from "@t3tools/contracts";
import { linkRequestAnswerInput, type LinkRequestItem } from "@t3tools/client-runtime/link-request";

export const peerAccessLabels: Record<AuthMcpClientAccess, string> = { "read-only": "Read only", "approval-required": "Supervised", "auto-accept-edits": "Auto accept edits", auto: "Auto", "full-access": "Full access" };
export const linkedEnvironmentsExplanation = "Let agents here work on your other machines, and theirs here. Turn it on for each machine, then link them in Connections. While it is off, nothing new starts over a link; tasks already running finish.";
type LinkConfig = Partial<Pick<ServerConfig, "environment" | "settings" | "managedPolicy">> | null | undefined;
export function peerLinksDenial(config: LinkConfig): string | undefined {
  return managedCapabilityDenial(config?.managedPolicy, "remoteClients")
    ?? (config?.environment?.capabilities.peerLinks !== true ? "This T3 server does not offer linked environments."
      : !config.settings?.linkedEnvironmentsEnabled ? `Enable Linked environments in T3 Code Settings → Labs. ${linkedEnvironmentsExplanation}` : undefined);
}
export interface PeerMachine {
  readonly environmentId: string; readonly label: string; readonly urls: ReadonlyArray<string>;
  readonly linked: boolean; readonly paired: boolean;
}
export interface PeerLinksState {
  readonly environmentId: string; readonly denial?: string; readonly loaded: boolean; readonly error?: string;
  readonly links: ReadonlyArray<{ readonly environmentId: string; readonly label: string; readonly status: string; readonly access: AuthMcpClientAccess; readonly paired: boolean }>;
  readonly machines: ReadonlyArray<PeerMachine>;
}
/** Loopback routes are client-local; another T3 server must not be sent there. */
export function peerReachableUrls(urls: ReadonlyArray<string>): string[] {
  return [...new Set(urls.filter(value => {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !["localhost", "[::1]", "0.0.0.0", "[::]"].includes(url.hostname.toLowerCase()) && !/^127\./.test(url.hostname); } catch { return false; }
  }))];
}
/** One payload builder shared by the picker and its deterministic checks. */
export function peerChoiceAnswer(item: Pick<LinkRequestItem, "id" | "threadId" | "environmentId" | "label" | "url">, machine: PeerMachine | undefined, address: string, pairingCode: string, access: AuthMcpClientAccess) {
  return linkRequestAnswerInput(item, machine?.linked ? { type: "use-existing", environmentId: EnvironmentId.make(machine.environmentId) } : {
    type: "link", target: machine ? { environmentId: EnvironmentId.make(machine.environmentId), label: machine.label, urls: machine.urls.length ? machine.urls : [address.trim()] }
      : item.environmentId ? { environmentId: item.environmentId, label: item.label?.trim() || "a machine", urls: [address.trim()] } : { url: address }, pairingCode, access,
  });
}
