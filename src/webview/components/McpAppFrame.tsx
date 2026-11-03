import { version } from "../../../package.json";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { makeMcpAppHost, McpAppHostRefusal, mcpAppStyleVariables, type McpAppHost } from "@t3tools/client-runtime/mcp-apps";
import { clampMcpAppHeight, MCP_APP_DEFAULT_HEIGHT, MCP_APP_MAX_HEIGHT, mcpAppAllowAttribute, type McpAppReference } from "@t3tools/shared/mcpApp";
import type { ChatAssetSource } from "../../shared/chatVisuals";
import type { McpAppRequests } from "../../shared/mcpApps";
import { bridge } from "../bridge-client";
import { useVisualTheme } from "../visualTheme";
import { useChatAsset } from "./ChatMedia";

export function McpAppFrame(props: { app: McpAppReference; threadId: string; source: ChatAssetSource; revision: string; fallback: ReactNode }) {
  const { app, threadId, source, revision, fallback } = props;
  const initialApp = useRef(app);
  const theme = useVisualTheme();
  const { asset, error, retry } = useChatAsset(threadId, source, { kind: "mcp-app" });
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<string>();
  const [height, setHeight] = useState(MCP_APP_DEFAULT_HEIGHT);
  const [width, setWidth] = useState(728);
  const [toolDefinition, setToolDefinition] = useState<unknown>();
  const [toolCall, setToolCall] = useState<McpAppRequests["tool-call"]["output"]>();
  const box = useRef<HTMLDivElement>(null); const frame = useRef<HTMLIFrameElement | null>(null); const host = useRef<McpAppHost | null>(null);
  const loads = useRef(0); const ready = useRef(false);
  const live = useRef({ theme, width, toolDefinition, toolCall }); live.current = { theme, width, toolDefinition, toolCall };
  const request = useCallback(<M extends keyof McpAppRequests>(appMethod: M, input: McpAppRequests[M]["input"]) =>
    bridge.request<McpAppRequests[M]["output"]>("mcpAppRequest", { threadId, ...source, appMethod, input }), [threadId, source.sourceThreadId, source.itemId]);
  useEffect(() => {
    let cancelled = false;
    void request("tool-call", {}).then((call) => { if (!cancelled) setToolCall(call); }, (cause: unknown) => { if (!cancelled) setFailure(cause instanceof Error ? cause.message : "Unable to load app output."); });
    void request("tools/info", { name: app.tool }).then((info) => { if (!cancelled) setToolDefinition(info.tool); }, () => {});
    return () => { cancelled = true; };
  }, [request, app.tool, revision, generation]);
  useEffect(() => { if (toolCall) host.current?.setToolCall(toolCall); }, [toolCall, generation, asset?.url]);
  useEffect(() => { host.current?.updateHostContext(); }, [theme, width, toolDefinition]);
  useEffect(() => {
    const element = box.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.round(entry.contentRect.width)); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const attachFrame = useCallback((element: HTMLIFrameElement | null) => {
    if (!element) { void host.current?.teardown(); host.current = null; frame.current = null; return; }
    frame.current = element; loads.current = 0; ready.current = false;
    const handle = makeMcpAppHost({
      app: initialApp.current, hostVersion: version,
      post: (message) => element.contentWindow?.postMessage(message, "*"),
      hostContext: () => ({
        theme: live.current.theme.appearance, styles: { variables: mcpAppStyleVariables(live.current.theme.variables) },
        displayMode: "inline", availableDisplayModes: ["inline"],
        containerDimensions: { width: live.current.width, maxHeight: MCP_APP_MAX_HEIGHT }, platform: "desktop",
        locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(live.current.toolDefinition === undefined ? {} : { toolInfo: { tool: live.current.toolDefinition } }),
      }),
      callTool: (input) => request("tools/call", input),
      readResource: (input) => request("resources/read", input),
      updateModelContext: (input) => request("ui/update-model-context", input),
      openLink: async (url) => {
        if (document.activeElement !== element || !navigator.userActivation?.isActive) throw new McpAppHostRefusal("Links open only from a click in the app.");
        await request("ui/open-link", { url });
      },
      sendMessage: (text) => request("ui/message", { text }),
      requestDisplayMode: async () => "inline",
      downloadFile: async (files) => {
        try {
          await request("ui/download-file", { files: files.map((file) => ({ name: file.name, ...(file._tag === "embedded" ? { bytes: Array.from(file.bytes) } : { uri: file.uri }) })) });
        } catch (cause) { throw new McpAppHostRefusal(cause instanceof Error ? cause.message : "Unable to save file."); }
      },
      onRequestTeardown: () => { void handle.teardown().then(() => setFailure(`The ${app.server} app was closed.`)); },
      onSizeChanged: (size) => { if (size.height !== undefined) setHeight(clampMcpAppHeight(size.height)); },
    });
    host.current = handle;
    if (live.current.toolCall) handle.setToolCall(live.current.toolCall);
    const receive = (event: MessageEvent) => {
      if (event.source === null || event.source !== element.contentWindow) return;
      handle.receive(event.data);
      if (event.data?.jsonrpc === "2.0" && event.data.method === "ui/notifications/initialized") ready.current = true;
    };
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); void handle.teardown(); if (host.current === handle) host.current = null; frame.current = null; };
  }, [request]);
  useEffect(() => {
    if (!asset || error || failure) return;
    const timer = setTimeout(() => { if (!ready.current) { host.current?.dispose(); setFailure(`Unable to initialize the ${app.server} app.`); } }, 20_000);
    return () => clearTimeout(timer);
  }, [asset?.url, error, failure, generation, app.server]);
  const failed = error ?? failure;
  return <div ref={box} className="html-visual" data-chat-visual="mcp-app">
    {failed ? <><div className="visual-failure" role="status">{failed}<button className="text-button" onClick={() => { setFailure(undefined); setGeneration((n) => n + 1); retry(); }}>Show app</button></div>{fallback}</> : asset ?
      <iframe key={`${asset.url}:${generation}`} ref={attachFrame} src={asset.url} title={`${app.server} app`} className="html-visual-frame"
        style={{ height, colorScheme: theme.appearance }} sandbox="allow-scripts allow-forms" allow={mcpAppAllowAttribute(app.permissions)} referrerPolicy="no-referrer"
        onError={() => { host.current?.dispose(); setFailure(`Unable to load the ${app.server} app.`); }}
        onLoad={() => { if (++loads.current > 1) { host.current?.dispose(); setFailure(`The ${app.server} app left its page and was stopped.`); } }} />
      : <div className="visual-loading" role="status">Loading {app.server} app…</div>}
  </div>;
}
