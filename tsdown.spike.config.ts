import { defineConfig } from "tsdown";

// M0 wire spike: same dependency surface as the extension host, run under
// plain node against an isolated dev server (see docs/t3-vscode-architecture.md §9).
export default defineConfig({
  entry: { spike: "scripts/spike.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist-spike",
  sourcemap: false,
  external: ["vscode"],
  banner: {
    js: [
      "import { createRequire } from 'module';",
      "import { fileURLToPath } from 'url';",
      "import { dirname } from 'path';",
      "const require = createRequire(import.meta.url);",
      "const __filename = fileURLToPath(import.meta.url);",
      "const __dirname = dirname(__filename);",
    ].join("\n"),
  },
});
