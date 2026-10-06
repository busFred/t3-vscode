import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ReviewDiffFileContentsInput, ReviewDiffFileContentsResult } from "@t3tools/contracts";

const run = promisify(execFile);
// The server's review API reads the working tree even when given headRef.
// This same-machine editor adapter reads immutable Git blobs instead; T3 still
// owns the checkpoint range and the list of files that may be opened.
export async function readCheckpointFiles(input: ReviewDiffFileContentsInput): Promise<ReviewDiffFileContentsResult> {
  const read = async (ref: string | null, path: string) => {
    if (!ref?.startsWith("refs/t3/") || !/^refs\/t3\/[\w./-]+$/.test(ref) || path.startsWith("/") || path.split("/").includes("..") || path.includes("\0")) throw new Error("Invalid saved checkpoint file.");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].includes(key)));
    const { stdout } = await run("git", ["-C", input.cwd, "cat-file", "blob", `${ref}:${path}`], { env, encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    if (stdout.includes("\0")) throw new Error("This saved file is binary and cannot be opened as a text diff.");
    return stdout;
  };
  const [oldContents, newContents] = await Promise.all([
    input.changeType === "new" ? "" : read(input.baseRef, input.oldPath),
    input.changeType === "deleted" ? "" : read(input.headRef, input.newPath),
  ]);
  return { oldContents, newContents };
}
