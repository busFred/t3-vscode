import { useDateTimeFormat, useTimeFormat } from "../timeFormat";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, RefreshCwIcon, Settings2Icon } from "lucide-react";
import { collectExternalUsageLinks, formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { HostStateSnapshot } from "../../shared/bridge";
import { accountWindows, groupOf, groupTitle, limitPresentations, perAccountRows, pooledAccount, soonestReset, usageGroups, usageNotices, type AccountRow, type AccountsDisplay, type UsageGroup } from "../../shared/usage";
import { meterResetLabel } from "../../shared/usageMeter";
import { ProviderIcon } from "./ProviderIcon";
import { useActions } from "../actions";

export function AccountUsage({ state, request }: { readonly state: HostStateSnapshot; readonly request: { accountKey?: string } | null }) {
  const timeOptions = useTimeFormat();
  const { dateTime } = useDateTimeFormat();
  const details = useRef<HTMLDetailsElement>(null);
  const groups = useMemo(() => usageGroups(state), [state.environment, state.providers, state.usageLimitSources]);
  const [key, setKey] = useState<string>();
  const [display, setDisplay] = useState<AccountsDisplay>(state.usagePanelAccounts ?? "pooled");
  useEffect(() => setDisplay(state.usagePanelAccounts ?? "pooled"), [state.usagePanelAccounts]);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!request || !details.current) return;
    // A status meter names an account or a provider; either opens its provider.
    if (request.accountKey) setKey(groupOf(groups, request.accountKey)?.key ?? request.accountKey);
    details.current.open = true;
    details.current.querySelector<HTMLSelectElement>("select")?.focus();
  }, [request]);
  const activeInstance = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
  const group = groupOf(groups, key) ?? groups.find((group) => group.accounts.some((account) => account.instanceIds.includes(activeInstance ?? ""))) ?? groups[0];
  const now = Date.now();
  const account = group ? pooledAccount(group, now) : undefined;
  const checkedAt = account?.limits.checkedAt;
  const several = (group?.reporting.length ?? 0) > 1;
  const perAccount = several && display === "perAccount";
  const notices = usageNotices(state, group?.driver);
  const links = collectExternalUsageLinks(limitPresentations(state));
  const run = useActions();
  const chooseDisplay = (value: AccountsDisplay) => { setDisplay(value); void run("setUsagePanelAccounts", { value }); };
  // Two lines at most: value and reset share one, the bar owns the other, and an unreported window keeps only its label.
  const limit = (group: UsageGroup, window: ServerProviderUsageWindow | null, label: string) => {
    const reset = window ? meterResetLabel(window.resetsAt, now) : "";
    const first = several && window ? soonestReset(group, window, now) : undefined;
    const resetTitle = window ? [formatResetsIn(window, now), first ? `soonest: ${first.email || first.label}` : ""].filter(Boolean).join(" · ") : "";
    return <div className="account-limit" key={window?.id ?? label}><div><span>{label}</span>{window
      ? <span className="account-limit-value"><span>{remainingPercent(window)}% left</span>{reset ? <small title={resetTitle || undefined}>{reset}</small> : null}</span>
      : <span className="account-limit-missing" title="This account does not report usage">unavailable</span>}</div>
      {window ? <div className="account-limit-bar" role="meter" aria-label={`${account?.label} ${label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingPercent(window)}><i style={{ width: `${remainingPercent(window)}%` }} /></div> : null}</div>;
  };
  // Every account gets the same bar length and slot in each window, so a column reads as one account.
  const accountRows = (row: AccountRow) => <div className="account-limit" key={row.window?.id ?? row.label}><div><span>{row.label}</span></div>
    <div className="account-limit-accounts">{row.columns.map(({ account, window }) => {
      const name = account.email || account.label;
      const reset = window ? meterResetLabel(window.resetsAt, now) : "";
      const title = window ? [`${name} · ${remainingPercent(window)}% left`, formatResetsIn(window, now)].filter(Boolean).join(" · ") : `${name} · not reported`;
      return <div className="account-limit-account" key={account.key} title={title}>
        <div className="account-limit-bar" role="meter" aria-label={`${name} ${row.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window ? remainingPercent(window) : undefined}>{window ? <i style={{ width: `${remainingPercent(window)}%` }} /> : null}</div>
        <span className="account-limit-value">{window ? <>{remainingPercent(window)}%{reset ? <small>{reset}</small> : null}</> : <span className="account-limit-missing">—</span>}</span>
      </div>;
    })}</div></div>;
  return <details className="account-usage" ref={details}>
    <summary><ChevronDownIcon size={12} /><strong>ACCOUNT & USAGE</strong></summary>
    <div className="account-usage-body">
      {group ? <>
        <label className="usage-account-choice"><ProviderIcon brand={group.brand} /><select aria-label="Usage provider" value={group.key} onChange={(event) => setKey(event.target.value)}>{groups.map((group) => <option value={group.key} key={group.key}>{groupTitle(group)}</option>)}</select></label>
      </> : null}
      <div className="account-usage-update"><small role="status">{refreshing ? "Refreshing limits…" : checkedAt ? <>Updated <time dateTime={checkedAt} title={dateTime(new Date(checkedAt))}>{new Date(checkedAt).toLocaleTimeString(undefined, timeOptions)}</time></> : "No update reported"}</small>
        {several ? <select className="usage-display-choice" aria-label="Multiple accounts" title="How to show several accounts" value={display} onChange={(event) => chooseDisplay(event.target.value as AccountsDisplay)}><option value="pooled">Pooled</option><option value="perAccount">Per account</option></select> : null}
        <button className="icon-button" aria-label="Refresh usage" title="Refresh usage" disabled={refreshing} onClick={() => { setRefreshing(true); void run("refreshUsage").finally(() => setRefreshing(false)); }}><RefreshCwIcon size={13} /></button><button className="icon-button" aria-label="Status meters" title="Status meters" onClick={() => { void run("configureUsage"); }}><Settings2Icon size={13} /></button></div>
      {group && account ? <>
        {group.plan ? <p className="account-plan subtle">{group.plan}</p> : null}
        {perAccount ? perAccountRows(group, now).map(accountRows) : accountWindows(account).map((row) => limit(group, row.window, row.label))}
      </> : <p className="subtle">No provider accounts reported yet.</p>}
      {notices.map((notice) => <p className="usage-notice" key={notice}>{notice}</p>)}
      {links.map((link) => <button key={link.url} className="text-button provider-usage-link" onClick={() => { void run("openLink", { href: link.url }); }}>{link.label}</button>)}
    </div>
  </details>;
}
