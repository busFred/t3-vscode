import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { htmlVisualHeight, type HtmlVisual as HtmlVisualData, type ChatAssetSource } from "../../shared/chatVisuals";
import { useChatAsset } from "./ChatMedia";
import { useVisualTheme } from "../visualTheme";
import { useActions } from "../actions";

export function HtmlVisual({ visual, threadId, source }: { visual: HtmlVisualData; threadId: string; source: ChatAssetSource }) {
  const run = useActions(); const frame = useRef<HTMLIFrameElement>(null); const wrapper = useRef<HTMLDivElement>(null);
  const { asset, error, retry } = useChatAsset(threadId, source, { kind: "html" });
  const theme = useVisualTheme(); const [width, setWidth] = useState(728); const [loaded, setLoaded] = useState(false);
  const initialTheme = useRef(theme);
  useEffect(() => {
    const element = wrapper.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const updateTheme = () => frame.current?.contentWindow?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: theme.appearance, styles: { variables: theme.variables } } }, "*");
  useEffect(() => { if (loaded) updateTheme(); }, [theme, loaded]);
  useEffect(() => {
    const open = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const request = event.data as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: { url?: unknown } };
      if (request.jsonrpc !== "2.0" || request.method !== "ui/open-link" || (typeof request.id !== "string" && typeof request.id !== "number") || typeof request.params?.url !== "string" || !/^https?:\/\//i.test(request.params.url)) return;
      void run("openLink", { href: request.params.url, threadId }).then((ok) => {
        frame.current?.contentWindow?.postMessage({ jsonrpc: "2.0", id: request.id, ...(ok ? { result: {} } : { error: { code: -32000, message: "Could not open link." } }) }, "*");
      });
    };
    window.addEventListener("message", open); return () => window.removeEventListener("message", open);
  }, [run, threadId]);
  useEffect(() => { initialTheme.current = theme; setLoaded(false); }, [asset?.url]);
  const themeHash = `#t3-theme=${encodeURIComponent(JSON.stringify({ appearance: initialTheme.current.appearance, variables: initialTheme.current.variables }))}`;
  return <div ref={wrapper} className="html-visual" data-chat-visual="html">
    {error ? <div className="visual-failure" role="status">{error}<button className="text-button" onClick={retry}>Retry</button></div> : asset ? <>
      <iframe ref={frame} src={`${asset.url}${themeHash}`} title={visual.title} className="html-visual-frame" style={{ height: htmlVisualHeight(visual, width) }} sandbox="allow-scripts allow-forms allow-popups allow-modals" referrerPolicy="no-referrer" onLoad={() => { setLoaded(true); updateTheme(); }} />
      <div className="visual-actions"><span>{visual.title}</span><button className="icon-button" title="Reload visualization" aria-label="Reload visualization" onClick={retry}><RefreshCwIcon size={13} /></button><button className="icon-button" title="Open visualization in browser" aria-label="Open visualization in browser" onClick={() => { void run("openLink", { href: `${asset.url}${themeHash}`, threadId }); }}><ExternalLinkIcon size={13} /></button></div>
    </> : <div className="visual-loading" role="status">Loading {visual.title}…</div>}
  </div>;
}
