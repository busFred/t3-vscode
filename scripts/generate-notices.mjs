/** Retain the bundled production dependencies' license texts in local VSIX builds. */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const { stdout } = await promisify(execFile)("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: root, encoding: "utf8" });
const inventory = JSON.parse(stdout);
const packages = Object.values(inventory).flat().sort((a, b) => a.name.localeCompare(b.name));
const sections = ["Third-party software notices\n\nT3 Code's license and copyright notice are in vendor/LICENSE.t3code."];
for (const entry of packages) {
  for (const directory of entry.paths) {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter((file) => file.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(file.name)).map((file) => file.name).sort();
    if (!files.length) throw new Error(`No license text found for ${entry.name}; retain its notice before packaging.`);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const texts = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
    sections.push(`${entry.name}@${manifest.version}\nLicense: ${entry.license}\n\n${texts.join("\n\n").trim()}`);
  }
}
await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist/THIRD_PARTY_NOTICES.txt"), `${sections.join("\n\n------------------------------------------------------------\n\n")}\n`);
console.log(`Retained notices for ${packages.length} production dependencies.`);
