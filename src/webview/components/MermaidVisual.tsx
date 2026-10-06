import { useEffect, useState } from "react";
import { Maximize2Icon } from "lucide-react";
import { useVisualTheme, type VisualTheme } from "../visualTheme";
import { openVisual } from "./ChatMedia";

type Engine = { render: (source: string, theme: VisualTheme) => Promise<string> };
declare global { interface Window { T3Mermaid?: Engine } }
let engine: Promise<Engine> | null = null;
function loadEngine(): Promise<Engine> {
  if (window.T3Mermaid) return Promise.resolve(window.T3Mermaid);
  return engine ??= new Promise<Engine>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = document.body.dataset.mermaidUrl ?? new URL("/mermaid.js", window.location.href).href;
    script.onload = () => window.T3Mermaid ? resolve(window.T3Mermaid) : reject(new Error("Diagram renderer did not load."));
    script.onerror = () => { script.remove(); engine = null; reject(new Error("Diagram renderer could not be loaded.")); };
    document.head.append(script);
  });
}
export function MermaidVisual({ source, streaming = false }: { source: string; streaming?: boolean }) {
  const theme = useVisualTheme(); const [result, setResult] = useState<{ key: string; svg?: string; error?: string }>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const key = `${JSON.stringify(theme)}\n${source}`;
  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    void loadEngine().then((engine) => engine.render(source, theme)).then((svg) => { if (!cancelled) setResult({ key, svg }); }, (cause: unknown) => { if (!cancelled) setResult({ key, error: cause instanceof Error ? cause.message : "Invalid Mermaid diagram." }); });
    return () => { cancelled = true; };
  }, [key, streaming, attempt]);
  const svg = result.key === key ? result.svg : undefined; const error = result.key === key ? result.error : undefined;
  return <div className="mermaid-visual" data-chat-visual="mermaid">
    {svg ? <><div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /><button className="icon-button expand-visual" aria-label="Expand diagram" title="Expand diagram" onClick={() => openVisual({ title: "Mermaid diagram", svg })}><Maximize2Icon size={13} /></button></> : <>
      <p className={error ? "visual-failure" : "visual-loading"} role="status">{streaming ? "Diagram will render when the response finishes." : error ? "Could not render this diagram. Its source is available below." : "Rendering diagram…"}{error ? <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button> : null}</p><pre><code>{source}</code></pre>
    </>}
  </div>;
}
