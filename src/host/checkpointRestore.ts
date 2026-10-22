import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Git access is injected so the attribution/dry-run/execute logic is testable without a real repository. */
export type GitRunner = (cwd: string, args: ReadonlyArray<string>, options?: { readonly input?: Buffer; readonly env?: Readonly<Record<string, string>> }) => Promise<Buffer>;
function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}
export const execGit: GitRunner = (cwd, args, options) => new Promise((resolveResult, reject) => {
  const child = execFile("git", ["-C", cwd, ...args], { env: { ...gitEnvironment(), ...options?.env }, encoding: "buffer", timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
    (error, stdout, stderr) => error ? reject(new Error(`Git ${args[0]} failed: ${stderr.toString().trim() || error.message}`)) : resolveResult(stdout));
  child.stdin?.end(options?.input);
});

export interface RestoreIo {
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly writeFile: (path: string, data: Buffer) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
}
export const nodeIo: RestoreIo = {
  readFile: (path) => readFile(path),
  writeFile: (path, data) => writeFile(path, data),
  mkdir: async (path) => { await mkdir(path, { recursive: true }); },
};

function parseNumstat(buffer: Buffer): Array<{ path: string; additions: number; deletions: number }> {
  return buffer.toString("utf8").split("\0").filter(Boolean).map((record) => {
    const first = record.indexOf("\t"), second = record.indexOf("\t", first + 1);
    return { path: record.slice(second + 1), additions: Number(record.slice(0, first)) || 0, deletions: Number(record.slice(first + 1, second)) || 0 };
  });
}

export interface RestoreAttributionFile {
  readonly path: string;
  readonly agent?: { readonly additions: number; readonly deletions: number };
  readonly you?: { readonly additions: number; readonly deletions: number; readonly untracked?: boolean };
}
/** A file is "agent" when the checkpoint-to-latest-agent-checkpoint range touched it, "you" when the working tree still differs from that latest checkpoint. */
export async function restoreAttribution(git: GitRunner, input: { readonly cwd: string; readonly checkpointRef: string; readonly latestRef: string }): Promise<RestoreAttributionFile[]> {
  const [agentRaw, youRaw, untrackedRaw] = await Promise.all([
    git(input.cwd, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames=0", "--numstat", "-z", input.checkpointRef, input.latestRef, "--"]),
    git(input.cwd, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames=0", "--numstat", "-z", input.latestRef, "--"]),
    git(input.cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const files = new Map<string, RestoreAttributionFile>();
  for (const entry of parseNumstat(agentRaw)) files.set(entry.path, { path: entry.path, agent: { additions: entry.additions, deletions: entry.deletions } });
  for (const entry of parseNumstat(youRaw)) files.set(entry.path, { ...files.get(entry.path), path: entry.path, you: { additions: entry.additions, deletions: entry.deletions } });
  for (const path of untrackedRaw.toString("utf8").split("\0").filter(Boolean)) if (!files.has(path)) files.set(path, { path, you: { additions: 0, deletions: 0, untracked: true } });
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export type RestoreVerdict = "clean" | "conflict";
/** Tests whether each tracked file's working-tree edits still apply cleanly on top of the checkpoint, without touching the working tree or index. */
export async function restoreDryRun(git: GitRunner, input: { readonly cwd: string; readonly checkpointRef: string; readonly latestRef: string; readonly paths: ReadonlyArray<string> }): Promise<Record<string, RestoreVerdict>> {
  const verdicts: Record<string, RestoreVerdict> = {};
  if (!input.paths.length) return verdicts;
  const directory = await mkdtemp(join(tmpdir(), "t3-restore-dry-run-"));
  try {
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    await git(input.cwd, ["read-tree", input.checkpointRef], { env });
    for (const path of input.paths) {
      const patch = await git(input.cwd, ["diff", "--no-ext-diff", "--no-textconv", "--binary", input.latestRef, "--", path]);
      if (!patch.length) { verdicts[path] = "clean"; continue; }
      // `--check` with `--3way` always reports success even on a real conflict, so this applies for real
      // into the isolated index (never the actual repo) and reads the outcome from the exit code instead.
      try { await git(input.cwd, ["apply", "--3way", "--cached", "--binary", "-"], { env, input: patch }); verdicts[path] = "clean"; }
      catch { verdicts[path] = "conflict"; }
    }
    return verdicts;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** `git clean -e` takes gitignore globs: anchor the path and escape its metacharacters so a kept file such as `weird[1].txt` survives. */
export function cleanExcludePattern(path: string): string { return `/${path.replace(/[\\*?\[\]!#]/g, (char) => `\\${char}`)}`; }
export interface RestoreExecuteFile { readonly path: string; readonly outcome: "applied" | "conflict" | "kept-untracked"; readonly yoursPath?: string }
const storageKey = (path: string) => path.replace(/\//g, "__");
/**
 * Restore order: snapshot kept files' current bytes and diffs first, then the destructive
 * `restore`/`clean` pair, then re-apply kept edits. A patch that fails 3-way merge leaves the
 * checkpoint's version in place and the pre-restore bytes beside it as `<path>.yours`; no stash
 * is created (kept simple — see docs/feature-history.md for the tradeoff).
 */
export async function restoreExecute(git: GitRunner, io: RestoreIo, input: {
  readonly cwd: string; readonly checkpointRef: string; readonly latestRef: string;
  readonly keepTracked: ReadonlyArray<string>; readonly keepUntracked: ReadonlyArray<string>; readonly storageDir: string;
}): Promise<ReadonlyArray<RestoreExecuteFile>> {
  await io.mkdir(input.storageDir);
  const patches = new Map<string, Buffer>();
  for (const path of input.keepTracked) {
    await io.writeFile(join(input.storageDir, storageKey(path)), await io.readFile(join(input.cwd, path)));
    patches.set(path, await git(input.cwd, ["diff", "--no-ext-diff", "--no-textconv", "--binary", input.latestRef, "--", path]));
  }
  await git(input.cwd, ["restore", "--source", input.checkpointRef, "--worktree", "--staged", "--", "."]);
  await git(input.cwd, ["clean", "-fd", ...input.keepUntracked.flatMap((path) => ["-e", cleanExcludePattern(path)])]);
  const results: RestoreExecuteFile[] = [];
  for (const path of input.keepTracked) {
    const patch = patches.get(path)!;
    if (!patch.length) { results.push({ path, outcome: "applied" }); continue; }
    try { await git(input.cwd, ["apply", "--3way", "--binary", "-"], { input: patch }); results.push({ path, outcome: "applied" }); }
    catch {
      await git(input.cwd, ["checkout", input.checkpointRef, "--", path]);
      const yoursPath = `${path}.yours`;
      await io.writeFile(join(input.cwd, yoursPath), await io.readFile(join(input.storageDir, storageKey(path))));
      results.push({ path, outcome: "conflict", yoursPath });
    }
  }
  for (const path of input.keepUntracked) results.push({ path, outcome: "kept-untracked" });
  return results;
}
