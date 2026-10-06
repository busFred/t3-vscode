/** Limits use T3's account deduplication and pooled quota presentation. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { collectExternalUsageLinks, collectLimitAccounts, collectLimitNotices, collectLimitPools, displayLimitWindows, formatResetsIn, remainingPercent, type LimitPresentations } from "@t3tools/shared/usageLimits";
import { RefreshCwIcon, XIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";

export function UsagePanel({ state, onClose }: { readonly state: HostStateSnapshot; readonly onClose: () => void }) {
  const run = useActions();
  const close = useRef<HTMLButtonElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const nodes = [...document.querySelectorAll<HTMLElement>('.usage-panel button:not(:disabled), .usage-panel a[href]')];
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => { window.removeEventListener("keydown", keyboard, true); previous?.focus(); };
  }, [onClose]);
  const presentations = useMemo<LimitPresentations>(() => state.environment ? new Map([[state.environment.environmentId as EnvironmentId, { entry: { target: { label: state.environment.label } }, serverConfig: { providers: state.providers, usageLimitSources: state.usageLimitSources } }]]) : new Map(), [state.environment, state.providers, state.usageLimitSources]);
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const notices = collectLimitNotices(presentations);
  const links = collectExternalUsageLinks(presentations);
  return <div className="usage-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="usage-panel" role="dialog" aria-modal="true" aria-labelledby="usage-title">
      <header><h2 id="usage-title">Usage <span>/ Limits</span></h2><button className="icon-button" aria-label="Refresh usage" disabled={refreshing} onClick={() => { setRefreshing(true); void run("refreshUsage").finally(() => { setRefreshing(false); setNow(Date.now()); }); }}><RefreshCwIcon size={15} /></button><button ref={close} className="icon-button" aria-label="Close usage" onClick={onClose}><XIcon size={16} /></button></header>
      <div className="usage-body">
        {refreshing ? <p role="status">Refreshing limits…</p> : null}
        {pools.map((pool) => <section className={`usage-provider usage-${pool.driver}`} key={pool.driver}>
          <h3>{state.providers.find((provider) => provider.driver === pool.driver)?.displayName ?? pool.driver}</h3>
          {displayLimitWindows(pool).map((window) => <div className="usage-window" key={`${window.kind}:${window.id}`}>
            <div className="usage-remaining"><span>{window.label}</span><strong>{Math.round(window.remainingPercent)}% <small>left</small></strong></div>
            <div className="usage-accounts">{window.columns.map(({ account, window: member }, index) => member ? <div key={account.key}>
              <div className="usage-bar" role="meter" aria-label={`${account.displayName ?? account.driver} ${member.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingPercent(member)}><span style={{ width: `${remainingPercent(member)}%` }}><small>{index + 1}</small></span></div>
              <div className="usage-account-label"><span>{account.displayName ?? account.driver} {remainingPercent(member)}%</span><small>{formatResetsIn(member, now)}</small></div>
            </div> : null)}</div>
          </div>)}
        </section>)}
        {notices.map((notice) => <p className="usage-notice" key={notice}>{notice}</p>)}
        {links.map((link) => <button key={link.url} className="text-button" onClick={() => { void run("openLink", { href: link.url }); }}>{link.label}</button>)}
        {!pools.length && !notices.length ? <p>No subscription limits have been reported by this server. Refresh to check again.</p> : null}
      </div>
    </section>
  </div>;
}
