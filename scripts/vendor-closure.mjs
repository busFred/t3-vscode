// Usage: node closure.mjs <upstreamPackagesDir> <entry pkg:subpath>...
// Prints reachable files grouped by package, and external (non-@t3tools) bare imports.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
const root = process.argv[2];
const stop = new Set(["contracts", "shared", "client-runtime"]); // already vendored whole
const seen = new Set(); const ext = new Set(); const queue = [];
const pkgJson = (p) => JSON.parse(readFileSync(`${root}/${p}/package.json`, "utf8"));
function resolveSpec(spec) {
  const m = spec.match(/^@t3tools\/([^/]+)(\/.*)?$/); if (!m) return null;
  const [_, pkg, sub] = m; if (stop.has(pkg)) return "STOP";
  const e = pkgJson(pkg).exports?.["." + (sub ?? "")];
  const target = typeof e === "string" ? e : e?.default ?? e?.import ?? e?.types;
  if (!target) throw new Error(`no export ${spec}`);
  return resolve(root, pkg, target);
}
function resolveRel(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const c of [base, base.replace(/\.js$/, ".ts"), base + ".ts", base + "/index.ts"]) if (existsSync(c) && c.endsWith(".ts")) return c;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}
for (const entry of process.argv.slice(3)) { const r = resolveSpec(entry); if (r && r !== "STOP") queue.push(r); }
while (queue.length) {
  const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith(".")) queue.push(resolveRel(f, spec));
    else if (spec.startsWith("@t3tools/")) { const r = resolveSpec(spec); if (r !== "STOP") queue.push(r); }
    else ext.add(spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"));
  }
}
const byPkg = {};
for (const f of seen) { const rel = relative(root, f); const p = rel.split("/")[0]; (byPkg[p] ??= []).push(rel.slice(p.length + 1)); }
for (const [p, fs] of Object.entries(byPkg)) { const lines = fs.reduce((n, x) => n + readFileSync(`${root}/${p}/${x}`, "utf8").split("\n").length, 0); console.log(`${p} files=${fs.length} lines=${lines}`); }
console.log("external:", [...ext].sort().join(" "));
if (process.env.LIST) for (const f of [...seen].sort()) console.log(relative(root, f));
