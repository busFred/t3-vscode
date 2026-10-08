import type { HostStateSnapshot } from "../../shared/bridge";
import { ThreadList } from "./ThreadList";
import { AccountUsage } from "./AccountUsage";
import { ProviderSetupNotice } from "./ServerSetup";

export function SidebarView({ state, onAppearance, usageRequest }: { readonly state: HostStateSnapshot; readonly onAppearance: () => void; readonly usageRequest: { accountKey?: string } | null }) {
  return <div className="sidebar-view">
    <AccountUsage state={state} request={usageRequest} />
    <ProviderSetupNotice state={state} />
    <ThreadList state={state} onAppearance={onAppearance} />
  </div>;
}
