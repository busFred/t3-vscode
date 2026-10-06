import { useEffect, useState } from "react";
import type { RpcMethod } from "../shared/bridge";
import { bridge } from "./bridge-client";

/** Queries return view-local data; they never replace the shared host snapshot. */
export function useBridgeQuery<T>(method: RpcMethod, params: object, key: string | null, delay = 150) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  const payload = JSON.stringify(params);
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void bridge.request<T>(method, JSON.parse(payload), 60_000).then((data) => {
        if (!cancelled) setResult({ key, data });
      }, (cause: unknown) => { if (!cancelled) setResult({ key, error: cause instanceof Error ? cause.message : String(cause) }); });
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [method, payload, key, delay]);
  return { data: key !== null && result.key === key ? result.data : undefined, error: key !== null && result.key === key ? result.error : undefined,
    pending: key !== null && result.key !== key };
}
