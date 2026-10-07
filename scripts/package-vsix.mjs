/** Build an installer into one predictable directory; never installs the extension. */
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
console.log(`Preparing ${manifest.version} (${manifest.preview ? "prerelease" : "release"}).`);
const output = join(root, "target-installer");
await mkdir(output, { recursive: true });
const cli = createRequire(import.meta.url).resolve("@vscode/vsce/vsce");
const child = spawn(process.execPath, [cli, "package", "--no-dependencies", ...(manifest.preview ? ["--pre-release"] : []), "--out", output], { cwd: root, stdio: "inherit" });
process.exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
