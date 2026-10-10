import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const environment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
export function turnBaselineRef(threadId: string, messageId: string) {
  return `refs/t3/vscode/turn-start/${createHash("sha256").update(JSON.stringify([threadId, messageId])).digest("hex")}`;
}
/** Snapshot saved files without touching the user's index, branch or working tree. */
export async function captureTurnBaseline(cwd: string, threadId: string, messageId: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "t3-turn-start-"));
  const index = join(directory, "index");
  const git = async (args: string[], isolated = false) => (await exec("git", ["-C", cwd, ...args], {
    env: { ...environment(), ...(isolated ? { GIT_INDEX_FILE: index } : {}) }, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  try {
    const indexPath = await git(["rev-parse", "--git-path", "index"]);
    try { await copyFile(resolve(cwd, indexPath), index); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await git(["read-tree", "--empty"], true); }
    await git(["add", "--all", "--", ":/"], true);
    const tree = await git(["write-tree"], true);
    // A tree ref keeps the snapshot alive across extension reloads and Git GC.
    await git(["update-ref", turnBaselineRef(threadId, messageId), tree, ""]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function findTurnBaseline(cwd: string, threadId: string, messageId: string): Promise<string | null> {
  const ref = turnBaselineRef(threadId, messageId);
  try {
    await exec("git", ["-C", cwd, "rev-parse", "--verify", `${ref}^{tree}`], { env: environment(), timeout: 15_000 });
    return ref;
  } catch { return null; }
}
