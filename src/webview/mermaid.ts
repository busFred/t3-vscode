/** Lazy, separate bundle: ordinary chats do not load Mermaid's diagram engines. */
import mermaid from "mermaid";
import DOMPurify from "dompurify";
import type { VisualTheme } from "./visualTheme";

const cache = new Map<string, Promise<string>>(); let queue: Promise<unknown> = Promise.resolve(); let sequence = 0;
const remoteCss = /url\(\s*(?!['"]?#)[^)]*\)/gi;
DOMPurify.addHook("uponSanitizeElement", (node, data) => { if (data.tagName === "style" && node.textContent) node.textContent = node.textContent.replace(remoteCss, "none"); });
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => { if (data.attrName === "style") data.attrValue = data.attrValue.replace(remoteCss, "none"); });

export function render(source: string, theme: VisualTheme): Promise<string> {
  const key = `${JSON.stringify(theme)}\n${source}`;
  const cached = cache.get(key); if (cached) return cached;
  const pending = queue.then(async () => {
    const id = `t3-mermaid-${++sequence}`;
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, maxTextSize: 50_000, maxEdges: 500,
        secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "themeCSS"], htmlLabels: false, flowchart: { htmlLabels: false },
        theme: "base", fontFamily: theme.variables["--font-sans"] ?? "sans-serif", themeVariables: { darkMode: theme.appearance === "dark", background: theme.background, primaryColor: theme.variables["--card"], primaryTextColor: theme.foreground, primaryBorderColor: theme.foreground, lineColor: theme.foreground, textColor: theme.foreground, secondaryColor: theme.variables["--muted"], tertiaryColor: theme.background } });
      const { svg } = await mermaid.render(id, source);
      return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_ATTR: ["href", "xlink:href", "src", "srcset"], FORBID_TAGS: ["a", "img", "image", "script", "foreignObject"] });
    } finally { document.getElementById(`d${id}`)?.remove(); }
  });
  queue = pending.catch(() => undefined); cache.set(key, pending);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return pending;
}
