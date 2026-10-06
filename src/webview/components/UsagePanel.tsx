/** Account-specific limits; no averaging across independent subscriptions. */
import { useEffect, useMemo, useRef, useState } from "react";
import { collectExternalUsageLinks, collectLimitNotices, formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";
import { RefreshCwIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { accountWindows, limitPresentations, meterLabels, usageAccounts } from "../../shared/usage";
import { useActions } from "../actions";
import { ProviderIcon } from "./ProviderIcon";

export function UsagePanel({ state, onClose, accountKey, embedded = false }: { readonly state: HostStateSnapshot; readonly onClose: () => void; readonly accountKey?: string; readonly embedded?: boolean }) {
  const run = useActions();
  const close = useRef<HTMLButtonElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [key, setKey] = useState(accountKey);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (accountKey) setKey(accountKey); }, [accountKey]);
  useEffect(() => {
    if (embedded) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const nodes = [...document.querySelectorAll<HTMLElement>('.usage-panel button:not(:disabled), .usage-panel select, .usage-panel a[href]')];
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => { window.removeEventListener("keydown", keyboard, true); previous?.focus(); };
  }, [onClose, embedded]);
  const accounts = useMemo(() => usageAccounts(state), [state.environment, state.providers, state.usageLimitSources]);
  const active = state.threads.find((thread) => thread.id === state.activeThreadId)?.modelSelection.instanceId ?? state.draft.modelSelection?.instanceId;
  const account = accounts.find((account) => account.key === key) ?? accounts.find((account) => account.instanceIds.includes(active ?? "")) ?? accounts[0];
  const presentations = limitPresentations(state);
  const notices = collectLimitNotices(presentations);
  const links = collectExternalUsageLinks(presentations);
  const windows = account ? accountWindows(account) : [];
  return <div className={embedded ? "usage-page" : "usage-overlay"} onPointerDown={(event) => { if (!embedded && event.target === event.currentTarget) onClose(); }}>
    <section className="usage-panel" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="usage-title">
      <header><h2 id="usage-title">Usage <span>/ Limits</span></h2><button className="text-button" onClick={() => { void run("configureUsage"); }}>Status meters…</button><button className="icon-button" aria-label="Refresh usage" disabled={refreshing} onClick={() => { setRefreshing(true); void run("refreshUsage").finally(() => { setRefreshing(false); setNow(Date.now()); }); }}><RefreshCwIcon size={15} /></button>{!embedded ? <button ref={close} className="icon-button" aria-label="Close usage" onClick={onClose}><XIcon size={16} /></button> : null}</header>
      <div className="usage-body">
        {refreshing ? <p role="status">Refreshing limits…</p> : null}
        {account ? <>
          <label className="usage-account-choice"><ProviderIcon brand={account.brand} /><select aria-label="Usage account" value={account.key} onChange={(event) => setKey(event.target.value)}>{accounts.map((account) => <option value={account.key} key={account.key}>{account.label}{account.email && account.email !== account.label ? ` · ${account.email}` : ""}</option>)}</select></label>
          <p className="subtle">{account.plan} {account.limits.checkedAt ? `· Updated ${new Date(account.limits.checkedAt).toLocaleTimeString()}` : ""}</p>
          {windows.map((window, index) => <div className="usage-window" key={meterLabels[index]}><div className="usage-remaining"><span>{window?.label ?? meterLabels[index]}</span><strong>{window ? `${remainingPercent(window)}%` : "—"} {window ? <small>left</small> : null}</strong></div><div className="usage-accounts">{window ? <><div className="usage-bar" role="meter" aria-label={`${account.label} ${window.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingPercent(window)}><span style={{ width: `${remainingPercent(window)}%` }} /></div><div className="usage-account-label"><span>{account.label}</span><small>{formatResetsIn(window, now)}</small></div></> : <p className="subtle">Not reported by this account.</p>}</div></div>)}
          {!account.limits.unavailable ? account.limits.windows.filter((window) => !windows.includes(window)).map((window) => <div className="usage-window" key={window.id}><div className="usage-remaining"><span>{window.label}</span><strong>{remainingPercent(window)}% <small>left</small></strong></div><small>{formatResetsIn(window, now)}</small></div>) : null}
          {account.limits.unavailable?.message ? <p>{account.limits.unavailable.message}</p> : null}
        </> : <p>No subscription limits have been reported by this server. Refresh to check again.</p>}
        {notices.map((notice) => <p className="usage-notice" key={notice}>{notice}</p>)}
        {links.map((link) => <button key={link.url} className="text-button" onClick={() => { void run("openLink", { href: link.url }); }}>{link.label}</button>)}
      </div>
    </section>
  </div>;
}
