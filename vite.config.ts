import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

// Webview bundle: single IIFE file (dist/webview.js) with all CSS injected at
// runtime — the host-generated HTML carries no <link> tags, so the CSP stays
// tight (mirrors kimi-code/apps/vscode).
export default defineConfig({
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],
  build: {
    lib: {
      entry: "src/webview/main.tsx",
      formats: ["iife"],
      fileName: () => "webview.js",
      name: "t3vscode",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    target: "es2022",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
