import { useDateTimeFormat, useTimeFormat } from "../timeFormat";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, RefreshCwIcon, Settings2Icon } from "lucide-react";
import { collectExternalUsageLinks, collectLimitNotices, formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { HostStateSnapshot } from "../../shared/bridge";
import { accountWindows, limitPresentations, usageAccounts } from "../../shared/usage";
import { meterResetLabel } from "../../shared/usageMeter";
import { ProviderIcon } from "./ProviderIcon";
import { useActions } from "../actions";

export function AccountUsage({ state, request }: { readonly state: HostStateSnapshot; readonly request: { accountKey?: string } | null }) {
  const timeOptions = useTimeFormat();
  const { dateTime } = useDateTimeFormat();
  const details = useRef<HTMLDetailsElement>(null);
  const accounts = useMemo(() => usageAccounts(state), [state.environment, state.providers, state.usageLimitSources]);
  const [key, setKey] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!request || !details.current) return;
    if (request.accountKey) setKey(request.accountKey);
    details.current.open = true;
    details.current.querySelector<HTMLSelectElement>("select")?.focus();
  }, [request]);
  const activeInstance = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
  const account = accounts.find((account) => account.key === key) ?? accounts.find((account) => account.instanceIds.includes(activeInstance ?? "")) ?? accounts[0];
  const checkedAt = account?.limits.checkedAt;
  const windows = account ? accountWindows(account) : [];
  const presentations = limitPresentations(state);
  const notices = collectLimitNotices(presentations);
  const links = collectExternalUsageLinks(presentations);
  const run = useActions();
  // Two lines at most: value and reset share one, the bar owns the other, and an unreported window keeps only its label.
  const limit = (window: ServerProviderUsageWindow | null, label: string) => {
    const reset = window ? meterResetLabel(window.resetsAt, Date.now()) : "";
    return <div className="account-limit" key={window?.id ?? label}><div><span>{label}</span>{window
      ? <span className="account-limit-value"><span>{remainingPercent(window)}% left</span>{reset ? <small title={formatResetsIn(window, Date.now()) ?? undefined}>{reset}</small> : null}</span>
      : <span className="account-limit-missing" title="Not reported by this account">not reported</span>}</div>
      {window ? <div className="account-limit-bar" role="meter" aria-label={`${account?.label} ${label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingPercent(window)}><i style={{ width: `${remainingPercent(window)}%` }} /></div> : null}</div>;
  };
  return <details className="account-usage" ref={details}>
    <summary><ChevronDownIcon size={12} /><strong>ACCOUNT & USAGE</strong></summary>
    <div className="account-usage-body">
      {account ? <>
        <label className="usage-account-choice"><ProviderIcon brand={account.brand} /><select aria-label="Usage account" value={account.key} onChange={(event) => setKey(event.target.value)}>{accounts.map((account) => <option value={account.key} key={account.key}>{account.label}{account.email && account.email !== account.label ? ` · ${account.email}` : ""}</option>)}</select></label>
      </> : null}
      <div className="account-usage-update"><small role="status">{refreshing ? "Refreshing limits…" : checkedAt ? <>Updated <time dateTime={checkedAt} title={dateTime(new Date(checkedAt))}>{new Date(checkedAt).toLocaleTimeString(undefined, timeOptions)}</time></> : "No update reported"}</small><button className="icon-button" aria-label="Refresh usage" title="Refresh usage" disabled={refreshing} onClick={() => { setRefreshing(true); void run("refreshUsage").finally(() => setRefreshing(false)); }}><RefreshCwIcon size={13} /></button><button className="icon-button" aria-label="Status meters" title="Status meters" onClick={() => { void run("configureUsage"); }}><Settings2Icon size={13} /></button></div>
      {account ? <>
        {account.plan ? <p className="account-plan subtle">{account.plan}</p> : null}
        {windows.map((row) => limit(row.window, row.label))}
        {account.limits.unavailable?.message ? <p className="usage-notice">{account.limits.unavailable.message}</p> : null}
      </> : <p className="subtle">No provider accounts reported yet.</p>}
      {notices.map((notice) => <p className="usage-notice" key={notice}>{notice}</p>)}
      {links.map((link) => <button key={link.url} className="text-button provider-usage-link" onClick={() => { void run("openLink", { href: link.url }); }}>{link.label}</button>)}
    </div>
  </details>;
}
