import { contextUsageBand, contextUsagePercent, contextUsageTooltip } from "../../shared/contextUsage";
import type { ContextUsageSnapshot } from "../../shared/contextUsage";

const RADIUS = 9.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Hidden entirely until the active thread has a sized usage report (#8144); nothing to reserve, so no layout shift. */
export function ContextMeter({ usage }: { readonly usage: ContextUsageSnapshot | null | undefined }) {
  if (!usage) return null;
  const percent = contextUsagePercent(usage);
  const offset = CIRCUMFERENCE * (1 - percent / 100);
  return <span className="context-meter" data-band={contextUsageBand(percent)} title={contextUsageTooltip(usage, percent)}>
    <svg className="context-meter-ring" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="context-meter-track" cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="3.5" />
      <circle className="context-meter-fill" cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset} />
    </svg>
    <span className="context-meter-percent">{percent}%</span>
  </span>;
}
