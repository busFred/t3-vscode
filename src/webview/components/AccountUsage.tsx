import { useMemo, useState } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import type { HostStateSnapshot } from "../../shared/bridge";
import { accountWindows, meterLabels, usageAccounts } from "../../shared/usage";
import { ProviderIcon } from "./ProviderIcon";
import { useActions } from "../actions";

export function AccountUsage({ state, onDetails }: { readonly state: HostStateSnapshot; readonly onDetails: (key?: string) => void }) {
  const accounts = useMemo(() => usageAccounts(state), [state.environment, state.providers, state.usageLimitSources]);
  const [key, setKey] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const activeInstance = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
  const account = accounts.find((account) => account.key === key) ?? accounts.find((account) => account.instanceIds.includes(activeInstance ?? "")) ?? accounts[0];
  const checkedAt = account?.limits.checkedAt;
  const run = useActions();
  return <details className="account-usage">
    <summary><ChevronDownIcon size={12} /><strong>ACCOUNT & USAGE</strong><span>Remaining</span></summary>
    <div className="account-usage-body">
      {account ? <>
        <label className="usage-account-choice"><ProviderIcon brand={account.brand} /><select aria-label="Usage account" value={account.key} onChange={(event) => setKey(event.target.value)}>{accounts.map((account) => <option value={account.key} key={account.key}>{account.label}{account.email && account.email !== account.label ? ` · ${account.email}` : ""}</option>)}</select></label>
      </> : null}
      <div className="account-usage-update"><small role="status">{refreshing ? "Refreshing limits…" : checkedAt ? <>Updated <time dateTime={checkedAt} title={new Date(checkedAt).toLocaleString()}>{new Date(checkedAt).toLocaleTimeString()}</time></> : "No update reported"}</small><button className="icon-button" aria-label="Refresh usage" title="Refresh usage" disabled={refreshing} onClick={() => { setRefreshing(true); void run("refreshUsage").finally(() => setRefreshing(false)); }}><RefreshCwIcon size={13} /></button></div>
      {account ? <>
        {accountWindows(account).map((window, index) => <div className="account-limit" key={meterLabels[index]}><div><span>{meterLabels[index]}</span><span>{window ? `${remainingPercent(window)}% left` : "—"}</span></div>{window ? <><div className="account-limit-bar"><i style={{ width: `${remainingPercent(window)}%` }} /></div><small>{formatResetsIn(window, Date.now()) || "Reset time not reported"}</small></> : <small>Not reported by this account</small>}</div>)}
      </> : <p className="subtle">No provider accounts reported yet.</p>}
      <div className="account-usage-actions"><button className="text-button" onClick={() => onDetails(account?.key)}>View details</button><button className="text-button" onClick={() => { void run("configureUsage"); }}>Status meters…</button></div>
    </div>
  </details>;
}
