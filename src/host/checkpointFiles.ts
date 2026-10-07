import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ReviewDiffFileContentsInput, ReviewDiffFileContentsResult } from "@t3tools/contracts";

const run = promisify(execFile);
function requireCheckpointRef(ref: string | null): asserts ref is string {
  if (!ref?.startsWith("refs/t3/") || !/^refs\/t3\/[\w./-]+$/.test(ref)) throw new Error("Invalid saved checkpoint reference.");
}
function gitEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].includes(key)));
}
// Read the exact range recorded by T3, including unnumbered baselines after
// cancelled runs. Never substitute HEAD or current working files.
export async function readCheckpointDiff(input: { cwd: string; baseRef: string; headRef: string }): Promise<string> {
  requireCheckpointRef(input.baseRef); requireCheckpointRef(input.headRef);
  const { stdout } = await run("git", ["-C", input.cwd, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/", input.baseRef, input.headRef, "--"],
    { env: gitEnvironment(), encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}
// The server's review API reads the working tree even when given headRef.
// This same-machine editor adapter reads immutable Git blobs instead.
export async function readCheckpointFiles(input: ReviewDiffFileContentsInput): Promise<ReviewDiffFileContentsResult> {
  const read = async (ref: string | null, path: string) => {
    requireCheckpointRef(ref);
    if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\0")) throw new Error("Invalid saved checkpoint file.");
    const { stdout } = await run("git", ["-C", input.cwd, "cat-file", "blob", `${ref}:${path}`], { env: gitEnvironment(), encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    if (stdout.includes("\0")) throw new Error("This saved file is binary and cannot be opened as a text diff.");
    return stdout;
  };
  const [oldContents, newContents] = await Promise.all([
    input.changeType === "new" ? "" : read(input.baseRef, input.oldPath),
    input.changeType === "deleted" ? "" : read(input.headRef, input.newPath),
  ]);
  return { oldContents, newContents };
}
