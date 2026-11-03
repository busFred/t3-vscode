/** Build an installer into one predictable directory; never installs the extension. */
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativeUndoGateFailure } from "./nativeUndoGate.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
console.log(`Preparing ${manifest.version} (${manifest.preview ? "prerelease" : "release"}).`);
// Native undo after paste/quote keeps regressing and only real VS Code shows it; see AGENTS.md "Protected behavior".
const undoGate = await nativeUndoGateFailure(root);
if (undoGate) {
  const waiver = process.env.T3_VSCODE_NATIVE_UNDO_WAIVER?.trim();
  if (!waiver) {
    console.error(`Refusing to package: ${undoGate}\nRun an isolated T3 server, then: node scripts/verify-edh.mjs --base-dir <isolated-home> --undo-only\n(Only the owner may waive this, with T3_VSCODE_NATIVE_UNDO_WAIVER="<reason>", recorded in the release notes.)`);
    process.exit(1);
  }
  console.warn(`Native-undo gate WAIVED: ${waiver}`);
}
const output = join(root, "target-installer");
await mkdir(output, { recursive: true });
const cli = createRequire(import.meta.url).resolve("@vscode/vsce/vsce");
const child = spawn(process.execPath, [cli, "package", "--no-dependencies", ...(manifest.preview ? ["--pre-release"] : []), "--out", output], { cwd: root, stdio: "inherit" });
process.exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
