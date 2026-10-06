import { useEffect, useState } from "react";

/** Same variable names consumed by T3 html_render pages, sourced from VS Code. */
export function nativeVisualTheme() {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const foreground = get("--foreground", "#27272a"); const background = get("--background", "#fcfcfc");
  const dark = document.documentElement.classList.contains("dark");
  const cssColor = (value: string) => {
    // Resolve nested CSS variable values into standalone colors for another document.
    const probe = document.createElement("span"); probe.style.color = value; document.body.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  };
  const names = ["background", "foreground", "muted", "muted-foreground", "card", "border", "input", "ring", "primary", "primary-foreground", "code-background", "destructive", "warning"];
  const variables: Record<string, string> = Object.fromEntries(names.map((name) => [`--${name}`, cssColor(get(`--${name}`, foreground))]));
  Object.assign(variables, {
    "--card-foreground": variables["--foreground"], "--popover": variables["--card"], "--popover-foreground": variables["--foreground"],
    "--secondary": variables["--muted"], "--secondary-foreground": variables["--foreground"], "--accent": variables["--primary"], "--accent-foreground": variables["--foreground"],
    "--accent-surface": variables["--muted"], "--accent-surface-foreground": variables["--foreground"], "--destructive-foreground": variables["--destructive"], "--destructive-surface": variables["--muted"],
    "--warning-foreground": variables["--warning"], "--warning-surface": variables["--muted"], "--success": cssColor(get("--vscode-gitDecoration-addedResourceForeground", dark ? "#34d399" : "#047857")),
    "--info": variables["--primary"], "--info-foreground": variables["--primary"], "--code-foreground": variables["--foreground"],
    "--font-sans": getComputedStyle(document.body).fontFamily, "--font-mono": get("--vscode-editor-font-family", "monospace"), "--radius": "3px",
    "--chart-1": variables["--primary"], "--chart-2": dark ? "#2dd4bf" : "#0d9488", "--chart-3": dark ? "#fbbf24" : "#b45309",
    "--chart-4": dark ? "#c084fc" : "#9333ea", "--chart-5": dark ? "#fb7185" : "#be123c", "--chart-6": dark ? "#a3e635" : "#4d7c0f",
  });
  variables["--success-foreground"] = variables["--success"]!;
  return { appearance: dark ? "dark" as const : "light" as const, variables, foreground: cssColor(foreground), background: cssColor(background) };
}
export type VisualTheme = ReturnType<typeof nativeVisualTheme>;
export function useVisualTheme() {
  const [theme, setTheme] = useState(nativeVisualTheme);
  useEffect(() => {
    const changed = () => setTheme(nativeVisualTheme()); const observer = new MutationObserver(changed);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
