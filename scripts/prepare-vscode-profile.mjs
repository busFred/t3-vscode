import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const exists = async (path) => lstat(path).then(() => true, (error) => {
  if (error.code === "ENOENT") return false;
  throw error;
});
const assertDirectory = async (path) => {
  if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path) {
    throw new Error("Refusing to use a linked development directory: " + path);
  }
};

/** Copy the real Default profile once; all development writes use the copy. */
export async function prepareDefaultProfile({ workspace, sourceUserData, sourceExtensions }) {
  const root = await realpath(resolve(workspace));
  const state = join(root, ".t3");
  await mkdir(state, { recursive: true });
  await assertDirectory(state);
  const userData = join(state, "vscode-profile");
  const extensions = join(userData, "extensions");
  const marker = join(userData, ".t3-vscode-profile.json");
  if (await exists(userData)) {
    await assertDirectory(userData);
    await assertDirectory(join(userData, "User"));
    await assertDirectory(extensions);
    if (!await exists(marker)) throw new Error("Development profile is not owned by this setup: " + userData);
    return { userData, extensions };
  }
  const stage = await mkdtemp(join(state, ".vscode-profile-"));
  try {
    await mkdir(join(stage, "User"));
    await mkdir(join(stage, "extensions"));
    for (const name of ["settings.json", "keybindings.json", "snippets"]) {
      const source = join(sourceUserData, "User", name);
      if (await exists(source)) await cp(source, join(stage, "User", name), { recursive: true, dereference: true });
    }
    const index = join(sourceExtensions, "extensions.json");
    const entries = await exists(index) ? JSON.parse(await readFile(index, "utf8")) : [];
    const sourceRoot = await exists(sourceExtensions) ? await realpath(sourceExtensions) : resolve(sourceExtensions);
    const copied = [];
    for (const entry of entries) {
      const source = await realpath(entry.location.path);
      if (!source.startsWith(sourceRoot + sep)) throw new Error("Extension is outside the source installation: " + source);
      const name = entry.relativeLocation;
      if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
        throw new Error("Invalid extension folder in the Default profile.");
      }
      await cp(source, join(stage, "extensions", name), { recursive: true, dereference: true });
      copied.push({ ...entry, location: { ...entry.location, path: join(extensions, name) }, relativeLocation: name });
    }
    await writeFile(join(stage, "extensions", "extensions.json"), JSON.stringify(copied));
    await writeFile(join(stage, ".t3-vscode-profile.json"), JSON.stringify({ basedOn: "Default", createdAt: new Date().toISOString() }));
    await rename(stage, userData);
    return { userData, extensions };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prepared = await prepareDefaultProfile({
    workspace: fileURLToPath(new URL("..", import.meta.url)),
    sourceUserData: join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Code"),
    sourceExtensions: join(homedir(), ".vscode", "extensions"),
  });
  console.log("Development host uses a copy of Default: " + prepared.userData);
  console.log("Development extensions: " + prepared.extensions);
}
