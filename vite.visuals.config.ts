import { defineConfig } from "vite";
export default defineConfig({
  build: { lib: { entry: "src/webview/mermaid.ts", formats: ["iife"], fileName: () => "mermaid.js", name: "T3Mermaid" }, outDir: "dist", emptyOutDir: false, sourcemap: false, target: "es2022" },
  define: { "process.env.NODE_ENV": '"production"' },
});
