import { defineConfig } from "tsdown";

// M0 wire spike: same dependency surface as the extension host, run under
// plain node against an isolated dev server (see docs/t3-vscode-architecture.md §9).
export default defineConfig({
  entry: { spike: "scripts/spike.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist-spike",
  sourcemap: false,
  platform: "node",
  shims: true,
  deps: { alwaysBundle: [/^[^./]/], onlyImport: [], onlyBundle: false },
});
