import { defineConfig } from "tsdown";

// Extension host bundle. ESM ("type": "module"); `vscode` is provided by the
// host at runtime. Vendored @t3tools/* workspace packages are bundled in.
export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: false,
  sourcemap: true,
  platform: "node",
  shims: true,
  // Workspace packages export TypeScript. VS Code must load compiled code,
  // without depending on pnpm symlinks or Node's TypeScript loader.
  deps: { neverBundle: ["vscode"], alwaysBundle: [/^(?!vscode$|node:)[^./]/], onlyImport: ["vscode"], onlyBundle: false },
});
