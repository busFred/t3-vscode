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
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const texts = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
    // These pinned npm releases omit a standalone license file. Keep their
    // declared license and copyright text without changing installed packages.
    if (!texts.length && entry.name === "lru_map" && manifest.version === "0.4.1" && manifest.license === "MIT") {
      const readme = await readFile(join(directory, "README.md"), "utf8");
      const start = readme.indexOf("# MIT license");
      if (start < 0) throw new Error("lru_map's README license is missing.");
      texts.push(readme.slice(start));
    }
    if (!texts.length && entry.name === "@pierre/theming" && manifest.version === "0.0.2" && manifest.license.toLowerCase() === "apache-2.0") {
      texts.push(await readFile(join(root, "vendor/LICENSE.pierre-theming"), "utf8"));
    }
    if (!texts.length) throw new Error(`No license text found for ${entry.name}; retain its notice before packaging.`);
    sections.push(`${entry.name}@${manifest.version}\nLicense: ${entry.license}\n\n${texts.join("\n\n").trim()}`);
  }
}
await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist/THIRD_PARTY_NOTICES.txt"), `${sections.join("\n\n------------------------------------------------------------\n\n")}\n`);
console.log(`Retained notices for ${packages.length} production dependencies.`);
