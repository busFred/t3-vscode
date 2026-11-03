/**
 * Packaging gate for native undo. Ctrl+Z after a paste or quote has regressed repeatedly, and only a real VS Code run
 * catches it (browser harnesses cannot reproduce VS Code's execCommand paste or key routing). A passing
 * `verify-edh.mjs --undo-only` records a stamp of the exact source it ran against; `pnpm package` refuses to build
 * when the source has changed since.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STAMP = "target-installer/native-undo-verified.json";

/** Hash of every tracked or untracked (not ignored) file under src/, plus package.json: what the extension is built from. */
export async function computeSourceStamp(root) {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "src", "package.json"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    let contents;
    try { contents = await readFile(join(root, file)); } catch { continue; } // deleted but still indexed
    hash.update(file).update("\0").update(contents).update("\0");
  }
  return hash.digest("hex");
}

export async function recordNativeUndoPass(root, detail = {}) {
  await mkdir(join(root, "target-installer"), { recursive: true });
  await writeFile(join(root, STAMP), `${JSON.stringify({ source: await computeSourceStamp(root), verifiedAt: new Date().toISOString(), ...detail }, null, 2)}\n`);
}

/** Returns null when packaging may proceed, else the reason it may not. */
export async function nativeUndoGateFailure(root) {
  let record;
  try { record = JSON.parse(await readFile(join(root, STAMP), "utf8")); } catch { record = undefined; }
  const current = await computeSourceStamp(root);
  if (!record?.source) return "No real VS Code native-undo verification is recorded for this source.";
  if (record.source !== current) return `The source changed after the last native-undo verification (${record.verifiedAt}).`;
  return null;
}
