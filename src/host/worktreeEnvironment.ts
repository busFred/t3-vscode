import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { hostname } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WORKTREE_ENVIRONMENT_PROFILE,
  type WorktreeEnvironmentProfile,
  type WorktreeEnvironmentRecord,
  type WorktreeEnvironmentProgress,
  type WorktreeEnvironmentCheckoutIdentity,
} from "../shared/worktreeEnvironment";

const MAX_LOG = 16_384;
const MARKER = ".t3-vscode-owned.json";
const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_METADATA_BYTES = 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const exists = async (value: string) => fs.lstat(value).then(() => true, (error: unknown) => {
  if (errorCode(error) === "ENOENT") return false;
  throw error;
});
const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error("Environment preparation cancelled");
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const scrub = (value: string) => value
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
  .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
  .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
  .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9_]+)\b/g, "[redacted]")
  .slice(-MAX_LOG);
export const sanitizeEnvironmentDiagnostic = scrub;

export interface EnvironmentCommand {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}
export interface EnvironmentCommandResult { stdout: string; stderr: string }
export type EnvironmentRunner = (command: EnvironmentCommand, signal?: AbortSignal) => Promise<EnvironmentCommandResult>;
export interface WorktreeEnvironmentDependencies {
  runner?: EnvironmentRunner;
  lockTimeoutMs?: number;
}

/** Shared lease for whole host operations, independent of Conda's narrower preparation lock. */
export async function acquireWorktreeLease(storageRoot: string, identity: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  cancelled(signal);
  const locks = path.join(storageRoot, "operation-leases");
  await fs.mkdir(locks, { recursive: true, mode: 0o700 });
  const lock = path.join(locks, hash(identity));
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(lock);
      try { await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ token, host: hostname(), pid: process.pid }), { flag: "wx", mode: 0o600 }); }
      catch (error) { await fs.rm(lock, { recursive: true, force: true }); throw error; }
      let released = false;
      return async () => {
        if (released) return;
        const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")) as { token?: string };
        if (owner.token !== token) throw new Error("Preparation lease ownership changed");
        await fs.rm(lock, { recursive: true }); released = true;
      };
    } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
    try {
      const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")) as { token?: unknown; host?: unknown; pid?: unknown };
      let dead = false;
      if (owner.host === hostname() && typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0
        && typeof owner.token === "string" && /^[a-f0-9-]{36}$/.test(owner.token)) {
        try { process.kill(owner.pid, 0); } catch (error) { dead = errorCode(error) === "ESRCH"; }
        if (dead) {
          // Retaining this nonempty tombstone makes racing stale observers' rename fail,
          // so none can accidentally take a subsequently acquired live lease.
          await fs.rename(lock, `${lock}.dead-${owner.token}`);
          continue;
        }
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "") && !(error instanceof SyntaxError)) throw error;
    }
    throw new Error("Another window is preparing this checkout; wait for it to finish");
  }
  throw new Error("Preparation lease is busy; retry later");
}
export interface PrepareWorktreeEnvironment {
  scope: string;
  projectRoot: string;
  worktreePath: string;
  onProgress?: (progress: WorktreeEnvironmentProgress) => void;
  signal?: AbortSignal;
  checkoutIdentity?: WorktreeEnvironmentCheckoutIdentity;
}
export interface ReconcileWorktreeEnvironment {
  scope: string;
  projectRoot: string;
  worktreePath: string;
  now?: number;
  assertCleanupSafe: () => Promise<boolean>;
}

/** Bounded output and process lifetime, with no shell interpolation except explicit custom setup. */
export const runEnvironmentCommand: EnvironmentRunner = (command, signal) => new Promise((resolve, reject) => {
  cancelled(signal);
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    ...(command.env ? { env: { ...process.env, ...command.env } } : {}),
    detached: process.platform !== "win32",
  });
  let stdout = "";
  let stderr = "";
  let stopped = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (force: boolean) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      else child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch { /* Already exited. */ }
  };
  const stop = () => { stopped = true; kill(false); killTimer ??= setTimeout(() => kill(true), 1500); };
  const timeout = setTimeout(stop, 20 * 60_000);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  child.stdout.on("data", (data: Buffer) => { stdout = (stdout + data.toString()).slice(-MAX_LOG); });
  child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-MAX_LOG); });
  const cleanup = () => { clearTimeout(timeout); clearTimeout(killTimer); signal?.removeEventListener("abort", stop); };
  child.on("error", (error) => { cleanup(); reject(error); });
  child.on("close", (code) => {
    cleanup();
    if (stopped) reject(new Error(signal?.aborted ? "Environment preparation cancelled" : "Environment command timed out"));
    else if (code !== 0) reject(new Error(`Environment command failed (${code}): ${scrub(stderr || stdout)}`));
    else resolve({ stdout, stderr });
  });
});

const relativePath = (value: unknown, field: string, allowRoot = false): string => {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || path.isAbsolute(value)
      || value.includes("\\") || value.split("/").some((part) => part === "..") || (!allowRoot && value === ".")) {
    throw new Error(`${field} must be a relative path inside the checkout`);
  }
  return value;
};

export function parseWorktreeEnvironmentProfile(input: unknown): WorktreeEnvironmentProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Python environment profile");
  const value = { ...DEFAULT_WORKTREE_ENVIRONMENT_PROFILE, ...input } as Record<string, unknown>;
  if (typeof value.enabled !== "boolean" || typeof value.autoCleanup !== "boolean" || !["directory", "named"].includes(String(value.location))
      || !["file", "clone"].includes(String(value.seed))) throw new Error("Invalid Python environment profile options");
  const string = (key: string) => {
    const item = value[key];
    if (typeof item !== "string" || item.includes("\0") || item.length > 4096) throw new Error(`Invalid ${key}`);
    return item;
  };
  const namePrefix = string("namePrefix");
  const cloneFrom = string("cloneFrom");
  const condaExecutable = string("condaExecutable");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(namePrefix)) throw new Error("Invalid environment name prefix");
  if (!cloneFrom.trim() || cloneFrom.startsWith("-") || !condaExecutable.trim() || condaExecutable.startsWith("-")) throw new Error("Invalid Conda executable or clone source");
  if (!Array.isArray(value.editable) || value.editable.length > 100) throw new Error("Invalid editable package paths");
  const customSetup = string("customSetup");
  if (scrub(customSetup) !== customSetup) throw new Error("Do not put credentials in the setup command");
  return {
    enabled: value.enabled, autoCleanup: value.autoCleanup, location: value.location as "directory" | "named", namePrefix,
    directory: relativePath(value.directory, "directory"), seed: value.seed as "file" | "clone",
    specification: relativePath(value.specification, "specification"), cloneFrom, customSetup,
    editable: value.editable.map((item) => relativePath(item, "editable package", true)), condaExecutable,
  };
}

function checkoutIdentity(input: unknown, checkout: string): WorktreeEnvironmentCheckoutIdentity {
  const value = input as WorktreeEnvironmentCheckoutIdentity;
  if (!value || ["commonDir", "gitDir", "parentPath"].some(key => {
    const item = value[key as keyof WorktreeEnvironmentCheckoutIdentity];
    return typeof item !== "string" || !path.isAbsolute(item) || item.includes("\0") || item.length > 4096 || path.resolve(item) !== item;
  }) || ["parentDevice", "commonDevice", "commonInode"].some(key => {
    const item = value[key as keyof WorktreeEnvironmentCheckoutIdentity];
    return typeof item !== "string" || !/^\d{1,40}$/.test(item);
  })
    || value.parentPath !== path.dirname(checkout)
    || (value.gitDevice === undefined) !== (value.gitInode === undefined)
    || (value.gitDevice !== undefined && (typeof value.gitDevice !== "string" || !/^\d{1,40}$/.test(value.gitDevice) || typeof value.gitInode !== "string" || !/^\d{1,40}$/.test(value.gitInode)))) throw new Error("Invalid captured checkout identity");
  return { commonDir: value.commonDir, gitDir: value.gitDir, parentPath: value.parentPath,
    parentDevice: value.parentDevice, commonDevice: value.commonDevice, commonInode: value.commonInode,
    ...(value.gitDevice === undefined ? {} : { gitDevice: value.gitDevice, gitInode: value.gitInode! }) };
}

const dependencyProfile = (profile: WorktreeEnvironmentProfile) => {
  const { autoCleanup: _cleanupOnly, ...dependencies } = profile;
  return JSON.stringify(dependencies);
};

const VERIFICATION_SCRIPT = `import sys,json,os,importlib.metadata as m
sources=[]
for d in m.distributions():
 text=d.read_text('direct_url.json')
 if text:
  u=json.loads(text)
  if u.get('dir_info',{}).get('editable'): sources.append(u.get('url',''))
print(json.dumps({'executable':os.path.realpath(sys.executable),'prefix':os.path.realpath(sys.prefix),'editable':sources}))`;

export class WorktreeEnvironmentManager {
  private readonly storageRoot: string;
  private readonly runner: EnvironmentRunner;
  private readonly lockTimeoutMs: number;

  constructor(storageRoot: string, deps: WorktreeEnvironmentDependencies = {}) {
    this.storageRoot = path.resolve(storageRoot);
    this.runner = deps.runner ?? runEnvironmentCommand;
    this.lockTimeoutMs = deps.lockTimeoutMs ?? 30_000;
  }

  private async atomic(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private profilePath(scope: string) { this.checkScope(scope); return path.join(this.storageRoot, "profiles", `${hash(scope)}.json`); }
  private checkScope(scope: string) { if (typeof scope !== "string" || !scope.trim() || scope.length > 4096) throw new Error("Invalid project scope"); }
  private identity(scope: string, checkout: string) { this.checkScope(scope); return hash(`${scope}\0${checkout}`).slice(0, 24); }
  // Different service/project scopes must not concurrently claim the same checkout directory.
  private lockIdentity(checkout: string) { return hash(checkout).slice(0, 24); }
  private recordPath(id: string) { return path.join(this.storageRoot, "environments", `${id}.json`); }
  private async readMetadata(file: string): Promise<unknown> {
    const parent = await fs.lstat(path.dirname(file));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("Metadata directory must not be a symlink");
    const entry = await fs.lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_METADATA_BYTES) throw new Error("Metadata must be a bounded regular file");
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) throw new Error("Metadata must be a bounded regular file");
      const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_METADATA_BYTES) throw new Error("Metadata exceeds its size limit");
      return JSON.parse(buffer.subarray(0, length).toString("utf8"));
    } finally { await handle.close(); }
  }
  private async canonical(checkout: string, missing = false) {
    if (!path.isAbsolute(checkout) || checkout.includes("\0")) throw new Error("Checkout must be an absolute path");
    try { return await fs.realpath(checkout); } catch (error) {
      if (missing && errorCode(error) === "ENOENT") return path.resolve(checkout);
      throw error;
    }
  }

  async getProfile(scope: string): Promise<WorktreeEnvironmentProfile> {
    try { return parseWorktreeEnvironmentProfile(await this.readMetadata(this.profilePath(scope))); }
    catch (error) { if (errorCode(error) === "ENOENT") return parseWorktreeEnvironmentProfile({}); throw error; }
  }
  async saveProfile(scope: string, input: unknown): Promise<WorktreeEnvironmentProfile> {
    const profile = parseWorktreeEnvironmentProfile(input);
    await this.atomic(this.profilePath(scope), profile);
    return profile;
  }

  private validateRecord(value: unknown, scope: string, checkout: string): WorktreeEnvironmentRecord {
    if (typeof checkout !== "string" || !path.isAbsolute(checkout) || path.resolve(checkout) !== checkout) throw new Error("Invalid environment checkout metadata");
    const record = value as WorktreeEnvironmentRecord;
    const id = this.identity(scope, checkout);
    if (!record || record.version !== 1 || record.id !== id || record.scope !== scope || record.worktreePath !== checkout
        || typeof record.projectRoot !== "string" || !path.isAbsolute(record.projectRoot) || typeof record.reserved !== "boolean"
        || !["preparing", "ready", "failed", "cancelled", "removed"].includes(record.status)
        || !Array.isArray(record.diagnostics) || record.diagnostics.some((item) => typeof item !== "string")) throw new Error("Invalid environment ownership metadata");
    const profile = parseWorktreeEnvironmentProfile(record.profile);
    const capturedIdentity = record.checkoutIdentity === undefined ? undefined : checkoutIdentity(record.checkoutIdentity, checkout);
    if (record.missingSince !== undefined && (typeof record.missingSince !== "string" || !Number.isFinite(Date.parse(record.missingSince)) || new Date(record.missingSince).toISOString() !== record.missingSince)) throw new Error("Invalid cleanup grace timestamp");
    const target = profile.location === "directory" ? path.join(checkout, profile.directory) : `${profile.namePrefix}-${id}`;
    if (record.location !== profile.location || record.target !== target || (record.prefix !== null && (typeof record.prefix !== "string" || !path.isAbsolute(record.prefix)))
        || (record.location === "directory" && record.prefix !== target)
        || (record.location === "named" && record.prefix !== null && path.basename(record.prefix) !== target)) throw new Error("Invalid environment target metadata");
    return { ...record, profile, ...(capturedIdentity ? { checkoutIdentity: capturedIdentity } : {}) };
  }
  async get(scope: string, worktreePath: string): Promise<WorktreeEnvironmentRecord | null> {
    const checkout = await this.canonical(worktreePath, true);
    try { return this.validateRecord(await this.readMetadata(this.recordPath(this.identity(scope, checkout))), scope, checkout); }
    catch (error) { if (errorCode(error) === "ENOENT") return null; throw error; }
  }
  async list(scope: string, projectRoot: string): Promise<WorktreeEnvironmentRecord[]> {
    this.checkScope(scope);
    const project = await this.canonical(projectRoot, true);
    const directory = path.join(this.storageRoot, "environments");
    let names: string[];
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Environment metadata directory must not be a symlink");
      names = await fs.readdir(directory);
    } catch (error) { if (errorCode(error) === "ENOENT") return []; throw error; }
    if (names.length > 10_000) throw new Error("Environment metadata enumeration exceeds its size limit");
    const records: WorktreeEnvironmentRecord[] = [];
    let total = 0;
    for (const name of names.sort()) {
      if (!/^[a-f0-9]{24}\.json$/.test(name)) continue;
      const file = path.join(directory, name);
      total += (await fs.lstat(file)).size;
      if (total > 32 * MAX_METADATA_BYTES) throw new Error("Environment metadata enumeration exceeds its size limit");
      const value = await this.readMetadata(file) as WorktreeEnvironmentRecord;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid environment metadata");
      if (value.scope !== scope || value.projectRoot !== project) continue;
      const record = this.validateRecord(value, scope, value.worktreePath);
      if (name !== `${record.id}.json`) throw new Error("Environment metadata filename does not match its identity");
      records.push(record);
    }
    return records;
  }

  /** Atomic mkdir excludes other extension processes; only provably dead local owners are recovered. */
  private async locked<T>(id: string, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    const locks = path.join(this.storageRoot, "locks");
    await fs.mkdir(locks, { recursive: true, mode: 0o700 });
    const lock = path.join(locks, id);
    const token = randomUUID();
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      cancelled(signal);
      try {
        await fs.mkdir(lock);
        try { await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), token, time: Date.now() }), { mode: 0o600, flag: "wx" }); }
        catch (error) { await fs.rm(lock, { recursive: true, force: true }); throw error; }
        break;
      } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
      // The recovery gate serializes stale-owner inspection and replacement across windows.
      let gate: fs.FileHandle | undefined;
      try {
        gate = await fs.open(`${lock}.recovery`, "wx", 0o600);
        const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")) as { pid: number; host: string; time: number };
        if (owner.host === hostname() && Number.isInteger(owner.pid) && owner.pid > 0 && Date.now() - owner.time > 60_000) {
          let dead = false;
          try { process.kill(owner.pid, 0); } catch (error) { dead = errorCode(error) === "ESRCH"; }
          if (dead) {
            const tombstone = `${lock}.${randomUUID()}.stale`;
            await fs.rename(lock, tombstone);
            await fs.rm(tombstone, { recursive: true, force: true });
          }
        }
      } catch (error) { if (!["EEXIST", "ENOENT"].includes(errorCode(error) ?? "") && !(error instanceof SyntaxError)) throw error; }
      finally { if (gate) { await gate.close(); await fs.rm(`${lock}.recovery`, { force: true }); } }
      if (Date.now() >= deadline) throw new Error("Another window is preparing this worktree environment; retry later");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try { return await action(); }
    finally {
      const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")) as { token: string };
      if (owner.token === token) await fs.rm(lock, { recursive: true, force: true });
    }
  }

  private async safeChild(checkout: string, relative: string, mustExist: boolean, allowRoot = false): Promise<string> {
    const target = path.join(checkout, relative);
    if (!inside(checkout, target) || (!allowRoot && target === checkout)) throw new Error("Environment path escapes checkout");
    if (target === checkout) return target;
    let current = checkout;
    for (const part of path.relative(checkout, target).split(path.sep)) {
      current = path.join(current, part);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new Error("Environment paths must not use symlinks");
      } catch (error) { if (errorCode(error) !== "ENOENT") throw error; if (mustExist) throw error; }
    }
    return target;
  }
  private owner(record: WorktreeEnvironmentRecord) { return { version: 1, id: record.id, scope: record.scope, worktreePath: record.worktreePath, target: record.target }; }
  private async owned(record: WorktreeEnvironmentRecord): Promise<boolean> {
    if (!record.prefix || !(await exists(record.prefix))) return false;
    if ((await fs.lstat(record.prefix)).isSymbolicLink()) throw new Error("Environment prefix must not be a symlink");
    try {
      return JSON.stringify(await this.readMetadata(path.join(record.prefix, MARKER))) === JSON.stringify(this.owner(record));
    } catch (error) { if (errorCode(error) === "ENOENT") return false; throw error; }
  }
  private async namedPrefix(profile: WorktreeEnvironmentProfile, target: string, cwd: string, signal?: AbortSignal): Promise<string | null> {
    const result = await this.runner({ executable: profile.condaExecutable, args: ["env", "list", "--json"], cwd }, signal);
    const parsed = JSON.parse(result.stdout) as { envs?: unknown };
    if (!Array.isArray(parsed.envs) || parsed.envs.some((item) => typeof item !== "string" || !path.isAbsolute(item))) throw new Error("Invalid Conda environment listing");
    const matches = (parsed.envs as string[]).filter((item) => path.basename(item) === target);
    if (matches.length > 1) throw new Error("Ambiguous named environment; refusing to select one");
    return matches[0] ?? null;
  }

  /** A removed checkout can receive a different Git admin basename while its named env is retained. */
  private async recaptureRetainedIdentity(record: WorktreeEnvironmentRecord, next: WorktreeEnvironmentCheckoutIdentity, projectRoot: string, signal?: AbortSignal): Promise<WorktreeEnvironmentCheckoutIdentity | null> {
    const previous = record.checkoutIdentity;
    if (!previous || record.location !== "named" || !record.prefix
      || previous.commonDir !== next.commonDir || previous.commonDevice !== next.commonDevice || previous.commonInode !== next.commonInode
      || previous.parentPath !== next.parentPath || previous.parentDevice !== next.parentDevice
      || path.dirname(previous.gitDir) !== path.join(previous.commonDir, "worktrees")
      || path.dirname(next.gitDir) !== path.join(next.commonDir, "worktrees")) return null;
    const directoryMatches = async (directory: string, device: string, inode?: string) => {
      const stat = await fs.lstat(directory);
      return stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(directory) === directory
        && stat.dev.toString() === device && (inode === undefined || stat.ino.toString() === inode);
    };
    try {
      if (!(await directoryMatches(next.commonDir, previous.commonDevice, previous.commonInode))
        || !(await directoryMatches(next.parentPath, previous.parentDevice))) return null;
      const currentAdmin = await fs.lstat(next.gitDir);
      if (!currentAdmin.isDirectory() || currentAdmin.isSymbolicLink() || await fs.realpath(next.gitDir) !== next.gitDir
        || (next.gitDevice !== undefined && (currentAdmin.dev.toString() !== next.gitDevice || currentAdmin.ino.toString() !== next.gitInode))) return null;
      try {
        const oldAdmin = await fs.lstat(previous.gitDir);
        // An unchanged admin directory also covers a moved original checkout: never take its env.
        if (oldAdmin.isSymbolicLink() || previous.gitDevice === undefined || previous.gitInode === undefined
          || (oldAdmin.dev.toString() === previous.gitDevice && oldAdmin.ino.toString() === previous.gitInode)) return null;
      } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
      if (!(await this.owned(record)) || await fs.realpath(record.prefix) !== record.prefix
        || await this.namedPrefix(record.profile, record.target, projectRoot, signal) !== record.prefix
        || !(await this.owned(record)) || await fs.realpath(record.prefix) !== record.prefix) return null;
      return { ...next, gitDevice: currentAdmin.dev.toString(), gitInode: currentAdmin.ino.toString() };
    } catch (error) { cancelled(signal); return null; }
  }

  async prepare(options: PrepareWorktreeEnvironment): Promise<WorktreeEnvironmentRecord> {
    const checkout = await this.canonical(options.worktreePath);
    const projectRoot = await this.canonical(options.projectRoot);
    let capturedIdentity = options.checkoutIdentity === undefined ? undefined : checkoutIdentity(options.checkoutIdentity, checkout);
    const id = this.identity(options.scope, checkout);
    return this.locked(this.lockIdentity(checkout), options.signal, async () => {
      const profile = await this.getProfile(options.scope);
      if (!profile.enabled) throw new Error("Project Python environment profile is disabled");
      let record = await this.get(options.scope, checkout);
      let needsSetup = !record || record.status !== "ready" || dependencyProfile(record.profile) !== dependencyProfile(profile);
      const target = profile.location === "directory" ? await this.safeChild(checkout, profile.directory, false) : `${profile.namePrefix}-${id}`;
      if (record && (record.projectRoot !== projectRoot || record.target !== target || record.location !== profile.location)) throw new Error("Existing worktree environment has a different owner or location; remove it before changing location");
      if (record?.checkoutIdentity && capturedIdentity) {
        const { gitDevice: oldDevice, gitInode: oldInode, ...previousBase } = record.checkoutIdentity;
        const { gitDevice: newDevice, gitInode: _newInode, ...nextBase } = capturedIdentity;
        const sameBase = JSON.stringify(previousBase) === JSON.stringify(nextBase);
        if (sameBase && oldDevice !== undefined && newDevice === undefined) capturedIdentity = { ...capturedIdentity, gitDevice: oldDevice, gitInode: oldInode! };
        const enrichLegacyIdentity = sameBase && oldDevice === undefined && newDevice !== undefined;
        if (!enrichLegacyIdentity && JSON.stringify(record.checkoutIdentity) !== JSON.stringify(capturedIdentity)
          && !(record.status === "removed" && (!record.prefix || await this.prefixMissing(record)))) {
          const recaptured = await this.recaptureRetainedIdentity(record, capturedIdentity, projectRoot, options.signal);
          if (!recaptured) throw new Error("The captured checkout identity changed; refusing to reuse its environment");
          capturedIdentity = recaptured;
          needsSetup = true;
        }
      }
      record ??= { version: 1, id, scope: options.scope, projectRoot, worktreePath: checkout, location: profile.location,
        target, prefix: profile.location === "directory" ? target : null, status: "preparing", reserved: false,
        profile, updatedAt: new Date().toISOString(), diagnostics: [] };
      record.profile = profile;
      if (capturedIdentity) record.checkoutIdentity = capturedIdentity;
      delete record.missingSince;
      const current = record;
      const save = async () => { current.updatedAt = new Date().toISOString(); await this.atomic(this.recordPath(id), current); };
      const progress = (stage: WorktreeEnvironmentProgress["stage"], message: string) => {
        current.diagnostics.push(message);
        current.diagnostics = current.diagnostics.slice(-30);
        options.onProgress?.({ stage, message });
      };
      const run = async (args: string[]) => {
        cancelled(options.signal);
        const output = await this.runner({ executable: profile.condaExecutable, args, cwd: checkout }, options.signal);
        if (output.stderr) current.diagnostics.push(scrub(output.stderr));
        cancelled(options.signal);
        return output;
      };
      const selector = () => [current.location === "directory" ? "--prefix" : "--name", current.target];
      let creating = false;
      try {
        cancelled(options.signal);
        if (current.location === "named") current.prefix = await this.namedPrefix(profile, target, checkout, options.signal);
        const present = current.prefix !== null && await exists(current.prefix);
        const isOwned = present && await this.owned(current);
        if (present && !isOwned) throw new Error("Existing environment is not owned by this extension; refusing to reuse it");
        current.status = "preparing";
        await save();
        if (!present) {
          progress("create", "Creating the worktree Python environment");
          if (profile.seed === "file") await this.safeChild(checkout, profile.specification, true);
          if (profile.seed === "clone" && (profile.cloneFrom === current.target || (path.isAbsolute(profile.cloneFrom) && current.prefix && path.resolve(profile.cloneFrom) === current.prefix))) throw new Error("Cannot clone an environment onto itself");
          current.reserved = true;
          await save();
          creating = true;
          await run(profile.seed === "file"
            ? ["env", "create", ...selector(), "--file", path.join(checkout, profile.specification), "--yes"]
            : ["create", ...selector(), "--clone", profile.cloneFrom, "--yes"]);
          if (current.location === "named") current.prefix = await this.namedPrefix(profile, target, checkout, options.signal);
          if (!current.prefix || !(await exists(current.prefix))) throw new Error("Conda did not create the expected environment");
          if ((await fs.lstat(current.prefix)).isSymbolicLink()) throw new Error("Environment prefix must not be a symlink");
          await fs.writeFile(path.join(current.prefix, MARKER), JSON.stringify(this.owner(current)), { flag: "wx", mode: 0o600 });
          creating = false;
          await save();
        }
        if ((needsSetup || !present) && profile.customSetup.trim()) {
          progress("setup", "Running project setup inside the worktree environment");
          await run(["run", ...selector(), "--no-capture-output", "bash", "-c", profile.customSetup]);
        }
        const editable: string[] = [];
        for (const relative of profile.editable) {
          const packagePath = await this.safeChild(checkout, relative, true, true);
          editable.push(packagePath);
          if (needsSetup || !present) {
            progress("editable", `Installing editable package ${relative}`);
            await run(["run", ...selector(), "python", "-m", "pip", "install", "--no-deps", "--editable", packagePath]);
          }
        }
        progress("verify", "Verifying Python and editable package sources");
        const verification = JSON.parse((await run(["run", ...selector(), "python", "-c", VERIFICATION_SCRIPT])).stdout) as { executable?: unknown; prefix?: unknown; editable?: unknown };
        if (!current.prefix || verification.prefix !== current.prefix || typeof verification.executable !== "string"
            || !inside(current.prefix, verification.executable) || verification.executable === current.prefix || !Array.isArray(verification.editable)) throw new Error("Python executable does not belong to the worktree environment");
        const sources = await Promise.all(verification.editable.map(async (url: unknown) => {
          if (typeof url !== "string" || !url.startsWith("file:")) throw new Error("Editable package has an invalid source URL");
          const source = fileURLToPath(url);
          if (!inside(checkout, source)) throw new Error("Editable package still points outside this worktree; repair the project setup");
          const canonicalSource = await fs.realpath(source);
          if (!inside(checkout, canonicalSource)) throw new Error("Editable package still points outside this worktree through a symlink");
          return canonicalSource;
        }));
        if (editable.some((item) => !sources.includes(item))) throw new Error("An editable package was not installed from this worktree");
        current.status = "ready";
        progress("ready", "Worktree Python environment is ready");
        await save();
        return current;
      } catch (error) {
        // Preserve partial creations with an ownership marker so an explicit retry/removal is safe.
        if (creating) {
          try {
            if (current.location === "named") current.prefix = await this.namedPrefix(profile, target, checkout, AbortSignal.timeout(2000));
            if (current.prefix && await exists(current.prefix) && !(await fs.lstat(current.prefix)).isSymbolicLink()) {
              await fs.writeFile(path.join(current.prefix, MARKER), JSON.stringify(this.owner(current)), { flag: "wx", mode: 0o600 });
            }
          } catch { /* Keep the original diagnostic; never overwrite an existing marker. */ }
        }
        current.status = options.signal?.aborted ? "cancelled" : "failed";
        current.diagnostics.push(scrub(error instanceof Error ? error.message : String(error)));
        current.diagnostics = current.diagnostics.slice(-30);
        await save();
        throw error;
      }
    });
  }

  private async saveRecord(record: WorktreeEnvironmentRecord, now = Date.now()): Promise<void> {
    record.updatedAt = new Date(now).toISOString();
    await this.atomic(this.recordPath(record.id), record);
  }

  private async markRemoved(record: WorktreeEnvironmentRecord, now = Date.now()): Promise<void> {
    record.status = "removed";
    record.reserved = false;
    delete record.missingSince;
    await this.saveRecord(record, now);
  }

  /** Missing descendants of an unreachable parent do not prove that an environment disappeared. */
  private async prefixMissing(record: WorktreeEnvironmentRecord): Promise<boolean> {
    if (!record.prefix) return false;
    try {
      const stat = await fs.lstat(record.prefix);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Environment prefix is not a regular directory");
      return false;
    } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    const immediateParent = path.dirname(record.prefix);
    const reachable = async (directory: string, device?: string) => {
      const stat = await fs.lstat(directory);
      return stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(directory) === directory
        && (device === undefined || stat.dev.toString() === device);
    };
    try { if (await reachable(immediateParent)) return true; }
    catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    const identity = record.checkoutIdentity;
    if (identity && inside(record.worktreePath, record.prefix)) {
      try { if (await reachable(identity.parentPath, identity.parentDevice)) return true; }
      catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    }
    throw new Error("Cannot confirm environment removal while its parent is missing, changed or unreadable");
  }

  /** Caller holds the environment lock. A false final guard stops before destructive work. */
  private async removeOwned(record: WorktreeEnvironmentRecord, projectRoot: string, beforeMutation: () => Promise<boolean> = async () => true): Promise<boolean> {
    const assertOwnedPrefix = async () => {
      if (!record.prefix || !(await this.owned(record)) || await fs.realpath(record.prefix) !== record.prefix) throw new Error("Environment ownership or canonical prefix changed; refusing removal");
    };
    if (record.location === "directory") await this.safeChild(record.worktreePath, record.profile.directory, false);
    if (record.prefix && await exists(record.prefix)) {
      if (!(await this.owned(record))) throw new Error("Environment ownership could not be verified; refusing removal");
      if (record.location === "directory") {
        if (!(await beforeMutation())) return false;
        await assertOwnedPrefix();
        await fs.rm(record.prefix, { recursive: true });
      } else {
        const prefix = await this.namedPrefix(record.profile, record.target, projectRoot);
        if (prefix !== record.prefix || await fs.realpath(prefix) !== record.prefix) throw new Error("Named environment moved; refusing removal");
        if (!(await beforeMutation())) return false;
        await assertOwnedPrefix();
        await this.runner({ executable: record.profile.condaExecutable, args: ["env", "remove", "--prefix", record.prefix, "--yes"], cwd: projectRoot });
        // Conda can leave non-package files (including our ownership marker) behind.
        if (await exists(record.prefix)) {
          if (!(await this.owned(record))) throw new Error("Named environment cleanup left an unowned directory; refusing deletion");
          if (!(await beforeMutation())) return false;
          await assertOwnedPrefix();
          await fs.rm(record.prefix, { recursive: true });
        }
      }
    }
    if (!(await beforeMutation())) return false;
    await this.markRemoved(record);
    return true;
  }

  /** Explicit checkout-removal cleanup. Retains identity for later restoration. */
  async remove(options: { scope: string; projectRoot: string; worktreePath: string }): Promise<void> {
    const checkout = await this.canonical(options.worktreePath, true);
    const projectRoot = await this.canonical(options.projectRoot, true);
    await this.locked(this.lockIdentity(checkout), undefined, async () => {
      const record = await this.get(options.scope, checkout);
      if (!record) return;
      if (record.projectRoot !== projectRoot) throw new Error("Environment belongs to another project");
      await this.removeOwned(record, projectRoot);
    });
  }

  /** Reconcile only an owned environment. This never removes a checkout or Git registration. */
  async reconcile(options: ReconcileWorktreeEnvironment): Promise<WorktreeEnvironmentRecord | null> {
    const checkout = await this.canonical(options.worktreePath, true);
    const projectRoot = await this.canonical(options.projectRoot, true);
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error("Invalid cleanup time");
    return this.locked(this.lockIdentity(checkout), undefined, async () => {
      const record = await this.get(options.scope, checkout);
      if (!record) return null;
      if (record.projectRoot !== projectRoot) throw new Error("Environment belongs to another project");
      if (record.status === "removed") return record;
      const safe = await options.assertCleanupSafe();
      if (await this.prefixMissing(record)) {
        await options.assertCleanupSafe(); // Cancellation/service switches must stop metadata updates too.
        await this.markRemoved(record, now);
        return record;
      }
      const clearGrace = async () => {
        if (record.missingSince !== undefined) {
          await options.assertCleanupSafe();
          delete record.missingSince;
          await this.saveRecord(record, now);
        }
        return record;
      };
      const profile = await this.getProfile(options.scope);
      if (!profile.autoCleanup || !safe || !record.checkoutIdentity || await exists(checkout) || !record.prefix) return clearGrace();
      const finalSafe = async () => {
        if (!(await options.assertCleanupSafe())) return false;
        if (!(await this.getProfile(options.scope)).autoCleanup || await exists(checkout)) return false;
        return options.assertCleanupSafe();
      };
      if (record.missingSince === undefined) {
        if (!(await finalSafe())) return clearGrace();
        record.missingSince = new Date(now).toISOString();
        await this.saveRecord(record, now);
        return record;
      }
      if (now - Date.parse(record.missingSince) < CLEANUP_GRACE_MS) return record;
      if (!(await this.removeOwned(record, projectRoot, finalSafe))) return clearGrace();
      return record;
    });
  }

  describe(record: WorktreeEnvironmentRecord, command = "python", args: string[] = []) {
    const valid = this.validateRecord(record, record.scope, record.worktreePath);
    if (valid.status !== "ready") throw new Error("Worktree Python environment is not ready");
    if (!command || command.includes("\0") || args.some((item) => item.includes("\0"))) throw new Error("Invalid environment command");
    const invocation: EnvironmentCommand = {
      executable: valid.profile.condaExecutable,
      args: ["run", valid.location === "directory" ? "--prefix" : "--name", valid.target, "--no-capture-output", command, ...args],
      cwd: valid.worktreePath,
    };
    return {
      ...invocation,
      terminalCommand: [invocation.executable, ...invocation.args].map(quote).join(" "),
      agentInstructions: `Project Python environment: ${valid.target}. Run Python/package commands from ${valid.worktreePath} using ${[valid.profile.condaExecutable, "run", valid.location === "directory" ? "--prefix" : "--name", valid.target].map(quote).join(" ")} <command>. This applies only to explicitly wrapped commands; other agent commands are not automatically activated.`,
    };
  }
}
