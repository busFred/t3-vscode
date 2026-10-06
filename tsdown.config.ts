import { defineConfig } from "tsdown";

// Extension host bundle. ESM ("type": "module"); `vscode` is provided by the
// host at runtime. Vendored @t3tools/* workspace packages are bundled in.
export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  sourcemap: true,
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
