import { useCallback, useEffect, useRef, useState } from "react";
import type { HostStateSnapshot } from "../shared/bridge";
import { resolveSearchPreferences, type SearchPreferences } from "../shared/sessionSearchPresentation";
import { useActions } from "./actions";

/** Optimistic panel controls; only preferences are shared, never the query or selected match. */
export function useSearchPreferences(state: HostStateSnapshot) {
  const remote = resolveSearchPreferences(state.searchPreferences);
  const latest = useRef(remote); latest.current = remote;
  const pending = useRef<Partial<SearchPreferences>>({});
  const [preferences, setPreferences] = useState(remote);
  const run = useActions();
  useEffect(() => { setPreferences({ ...latest.current, ...pending.current }); }, [remote.layout, remote.contextLines, remote.order, remote.resultsHeight]);
  const update = useCallback((patch: Partial<SearchPreferences>) => {
    pending.current = { ...pending.current, ...patch };
    setPreferences((previous) => ({ ...previous, ...patch }));
    void run("setSearchPreferences", patch).then((ok) => {
      for (const key of Object.keys(patch) as Array<keyof SearchPreferences>) if (pending.current[key] === patch[key]) delete pending.current[key];
      if (!ok) setPreferences({ ...latest.current, ...pending.current });
    });
  }, [run]);
  return [preferences, update] as const;
}
