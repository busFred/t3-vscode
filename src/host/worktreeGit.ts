import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { WorktreeEnvironmentCheckoutIdentity } from '../shared/worktreeEnvironment';
import { normalizeGitRemoteUrl } from '@t3tools/shared/git';

const LIMIT = 32 * 1024 * 1024;
function git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}, input?: Buffer): Promise<Buffer> {
  return new Promise((resolveResult, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, GIT_TERMINAL_PROMPT: '0' };
    // Ambient Git routing must never redirect a checkout operation to another repository.
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
      if (!(key in extraEnv)) delete env[key];
    }
    const child = execFile('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], {
      cwd, env, encoding: 'buffer', timeout: 30_000, maxBuffer: LIMIT,
    }, (error, stdout, stderr) => error ? reject(new Error(`Git ${args[0]} failed: ${stderr.toString().trim() || error.message}`)) : resolveResult(stdout));
    child.stdin?.end(input);
  });
}
const out = async (cwd: string, args: string[]) => (await git(cwd, args)).toString('utf8').trim();
export async function currentBranch(cwd: string): Promise<string> { return out(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']); }

/** Normalized `upstream` and `origin` remotes: the remotes T3 derives a project's repository identity from. */
export async function repositoryRemoteKeys(path: string): Promise<string[]> {
  const keys = await Promise.all(['upstream', 'origin'].map((name) => out(path, ['remote', 'get-url', name]).then(normalizeGitRemoteUrl, () => null)));
  return keys.filter((key): key is string => !!key);
}
export interface LocalWorktree { path: string; branch: string; head?: string; root: boolean; missing: boolean; locked: boolean }
export async function repositoryIdentity(path: string): Promise<{ root: string; commonDir: string } | null> {
  try {
    const commonDir = await realpath(await out(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    const records = (await git(path, ['worktree', 'list', '--porcelain', '-z'])).toString().split('\0');
    const root = records.find((field) => field.startsWith('worktree '))?.slice(9);
    if (!root) return null;
    return { root: await realpath(root).catch(() => resolve(root)), commonDir };
  } catch { return null; }
}
export async function listLocalWorktrees(projectRoot: string): Promise<LocalWorktree[]> {
  const identity = await repositoryIdentity(projectRoot);
  if (!identity) throw new Error('Not a Git project');
  const records = (await git(projectRoot, ['worktree', 'list', '--porcelain', '-z'])).toString().split('\0\0');
  const result: LocalWorktree[] = [];
  for (const record of records) {
    const fields = record.split('\0');
    const path = fields.find((field) => field.startsWith('worktree '))?.slice(9);
    if (!path) continue;
    const canonical = await realpath(path).catch(() => resolve(path));
    const head = fields.find(field => field.startsWith('HEAD '))?.slice(5, 17);
    result.push({ path: canonical, branch: fields.find((field) => field.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') ?? '', ...(head ? { head } : {}), root: canonical === identity.root,
      missing: !(await lstat(path).catch(() => null)), locked: fields.some((field) => field === 'locked' || field.startsWith('locked ')) });
  }
  return result;
}
async function checkout(projectRoot: string, path: string): Promise<string> {
  const [project, target] = await Promise.all([repositoryIdentity(projectRoot), repositoryIdentity(path)]);
  if (!project || !target || project.commonDir !== target.commonDir) throw new Error('Checkout belongs to a different Git project');
  const canonical = await realpath(path);
  const top = await realpath(await out(path, ['rev-parse', '--show-toplevel']));
  if (canonical !== top || !(await listLocalWorktrees(projectRoot)).some((tree) => tree.path === canonical && !tree.missing)) throw new Error('Path is not a registered Git checkout root');
  return canonical;
}
/** Capture the Git administration directory, which survives worktree moves. */
export async function worktreeCleanupIdentity(projectRoot: string, path: string): Promise<WorktreeEnvironmentCheckoutIdentity> {
  const canonical = await checkout(projectRoot, path), repository = await repositoryIdentity(projectRoot);
  if (!repository || canonical === repository.root) throw new Error('The root checkout has no worktree environment ownership');
  const gitDir = await realpath(await out(canonical, ['rev-parse', '--absolute-git-dir']));
  if (dirname(gitDir) !== join(repository.commonDir, 'worktrees')) throw new Error('Unsupported worktree administration directory');
  const parentPath = await realpath(dirname(canonical));
  const [parent, common, administration] = await Promise.all([stat(parentPath), stat(repository.commonDir), stat(gitDir)]);
  return { commonDir: repository.commonDir, gitDir, parentPath, parentDevice: String(parent.dev), commonDevice: String(common.dev), commonInode: String(common.ino),
    gitDevice: String(administration.dev), gitInode: String(administration.ino) };
}
const definitelyAbsent = async (path: string) => lstat(path).then(() => false, (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return true;
  throw error;
});
/** Absence alone is insufficient: require the original, reachable Git/parent identity too. */
export async function worktreeRemovalConfirmed(projectRoot: string, path: string, identity?: WorktreeEnvironmentCheckoutIdentity): Promise<boolean> {
  if (!identity || dirname(path) !== identity.parentPath || dirname(identity.gitDir) !== join(identity.commonDir, 'worktrees')) return false;
  try {
    if (await realpath(projectRoot) !== projectRoot || await realpath(identity.parentPath) !== identity.parentPath) return false;
    await access(identity.parentPath, constants.R_OK | constants.X_OK);
    const repository = await repositoryIdentity(projectRoot);
    if (!repository || repository.commonDir !== identity.commonDir || repository.root === path) return false;
    const [parent, common] = await Promise.all([stat(identity.parentPath), stat(identity.commonDir)]);
    if (!parent.isDirectory() || String(parent.dev) !== identity.parentDevice || String(common.dev) !== identity.commonDevice || String(common.ino) !== identity.commonInode) return false;
    // A moved, locked or merely unavailable checkout retains its administration directory.
    if (!(await definitelyAbsent(path)) || !(await definitelyAbsent(identity.gitDir))) return false;
    return !(await listLocalWorktrees(projectRoot)).some(tree => tree.path === path);
  } catch { return false; } // Disconnected drives and permission failures never authorize deletion.
}
async function baseline(path: string, requested?: string): Promise<string> {
  let ref = requested;
  if (!ref) {
    for (const candidate of ['refs/heads/main', 'refs/heads/master']) {
      try { await out(path, ['rev-parse', '--verify', `${candidate}^{commit}`]); ref = candidate; break; } catch { /* Try the next conventional branch. */ }
    }
    ref ??= 'HEAD';
  }
  if (ref.startsWith('-') || ref.includes('\0')) throw new Error('Invalid base reference');
  const commit = await out(path, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return out(path, ['merge-base', 'HEAD', commit]);
}
async function safeFile(root: string, file: string): Promise<string> {
  if (!file || isAbsolute(file) || file.includes('\0') || file.includes('\\') || file.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('Unsafe checkout file path');
  const full = resolve(root, file);
  if (relative(root, full).startsWith(`..${sep}`)) throw new Error('File escapes checkout');
  let cursor = root;
  for (const part of file.split('/')) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error('Symlink paths cannot be transferred');
    if (stat && cursor === full && !stat.isFile()) throw new Error('Only regular files can be transferred');
  }
  return full;
}
async function regularBaseline(path: string, baseRef: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const entries = (await git(path, ['ls-tree', '-z', baseRef, '--', ...files])).toString().split('\0');
  if (entries.some((entry) => entry && !entry.startsWith('100644 ') && !entry.startsWith('100755 '))) throw new Error('Only regular Git files can be transferred');
}
export async function worktreeChanges(input: { projectRoot: string; path: string; baseRef?: string }): Promise<{ baseRef: string; files: Array<{ path: string; additions: number; deletions: number }> }> {
  const path = await checkout(input.projectRoot, input.path);
  const baseRef = await baseline(path, input.baseRef);
  const stats = (await git(path, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', baseRef, '--'])).toString();
  const files = stats.split('\0').filter(Boolean).map((record) => {
    const first = record.indexOf('\t'); const second = record.indexOf('\t', first + 1);
    return { path: record.slice(second + 1), additions: Number(record.slice(0, first)) || 0, deletions: Number(record.slice(first + 1, second)) || 0 };
  });
  for (const file of (await git(path, ['ls-files', '--others', '--exclude-standard', '-z'])).toString().split('\0').filter(Boolean)) {
    const full = resolve(path, file);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) { files.push({ path: file, additions: 0, deletions: 0 }); continue; }
    await safeFile(path, file);
    if (stat.size > LIMIT) throw new Error('File exceeds diff size limit');
    const content = await readFile(full);
    if (content.length > LIMIT) throw new Error('File exceeds diff size limit');
    files.push({ path: file, additions: content.includes(0) ? 0 : content.length ? content.toString().split('\n').length - (content.at(-1) === 10 ? 1 : 0) : 0, deletions: 0 });
  }
  return { baseRef, files };
}
export async function readWorktreeDiffFile(input: { projectRoot: string; path: string; baseRef: string; file: string }): Promise<{ before: string; after: string; binary?: boolean }> {
  const path = await checkout(input.projectRoot, input.path);
  const full = await safeFile(path, input.file);
  const baseRef = await baseline(path, input.baseRef);
  await regularBaseline(path, baseRef, [input.file]);
  const entry = await git(path, ['ls-tree', '-z', baseRef, '--', input.file]);
  const before = entry.length ? await git(path, ['show', `${baseRef}:${input.file}`]) : Buffer.alloc(0);
  if (((await lstat(full).catch(() => null))?.size ?? 0) > LIMIT) throw new Error('File exceeds diff size limit');
  const after = await readFile(full).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
  if (after.length > LIMIT) throw new Error('File exceeds diff size limit');
  return { before: before.toString(), after: after.toString(), ...(before.includes(0) || after.includes(0) ? { binary: true } : {}) };
}
async function checkoutStamp(path: string): Promise<string> {
  return `${await out(path, ['rev-parse', 'HEAD'])}\0${await out(path, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')}\0${(await repositoryIdentity(path))?.commonDir}`;
}
/** Parse line counts straight from the patch headers; this touches no working tree. */
export async function patchNumstat(cwd: string, patch: Buffer): Promise<string> {
  return (await git(cwd, ['apply', '--numstat', '-z', '-'], {}, patch)).toString('utf8');
}
export async function applyWorktreeFiles(input: { projectRoot: string; path: string; destination: string; baseRef?: string; files: string[]; allowAlreadyApplied?: boolean }): Promise<Buffer> {
  const source = await checkout(input.projectRoot, input.path);
  const destination = await checkout(input.projectRoot, input.destination);
  if (source === destination) throw new Error('Source and destination must be distinct checkouts');
  if (!input.files.length) throw new Error('Select at least one file');
  const files = [...new Set(input.files)];
  const sourceStamp = await checkoutStamp(source); const destinationStamp = await checkoutStamp(destination);
  const changes = await worktreeChanges(input);
  const allowed = new Set(changes.files.map((file) => file.path));
  for (const file of files) {
    if (!allowed.has(file)) throw new Error('Selected file is not a current checkout change');
    await safeFile(source, file); await safeFile(destination, file);
  }
  await regularBaseline(source, changes.baseRef, files);
  const temporary = await mkdtemp(join(tmpdir(), 't3-worktree-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(temporary, 'index') };
    await git(source, ['read-tree', changes.baseRef], env);
    await git(source, ['add', '-A', '--', ...files], env);
    const patch = await git(source, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', changes.baseRef, '--', ...files], env);
    if (!patch.length) throw new Error('Selected files have no transferable changes');
    let alreadyApplied = false;
    try { await git(destination, ['apply', '--check', '--binary', '--whitespace=nowarn', '-'], {}, patch); }
    catch (error) {
      // Handoff retries may follow a committed copy and a lost metadata response.
      // Accept only a fully reversible identical patch; partial/conflicting edits still fail.
      if (!input.allowAlreadyApplied) throw error;
      await git(destination, ['apply', '--reverse', '--check', '--binary', '--whitespace=nowarn', '-'], {}, patch);
      alreadyApplied = true;
    }
    if (sourceStamp !== await checkoutStamp(source) || destinationStamp !== await checkoutStamp(destination)) throw new Error('Checkout branch or project changed during transfer');
    for (const file of files) { await safeFile(source, file); await safeFile(destination, file); }
    if (!alreadyApplied) await git(destination, ['apply', '--binary', '--whitespace=nowarn', '-'], {}, patch);
    return patch;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function readWorktreeStatus(path: string): Promise<{ tracked: boolean; untracked: boolean; ignored: boolean; dirty: boolean }> {
  const fields = (await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored'])).toString().split('\0');
  let tracked = false; let untracked = false; let ignored = false;
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]; if (!field) continue;
    if (field.startsWith('?? ')) untracked = true;
    else if (field.startsWith('!! ')) ignored = true;
    else { tracked = true; if (field.slice(0, 2).includes('R') || field.slice(0, 2).includes('C')) index++; }
  }
  return { tracked, untracked, ignored, dirty: tracked || untracked };
}
export async function copyWorktreeConfig(projectRoot: string, worktreePath: string): Promise<void> {
  const identity = await repositoryIdentity(projectRoot);
  if (!identity) throw new Error('Not a Git project');
  const destination = await checkout(projectRoot, worktreePath);
  if (destination === identity.root) return;
  for (const entry of await readdir(identity.root, { withFileTypes: true })) {
    if (!entry.isFile() || !(entry.name === '.env' || entry.name.startsWith('.env.'))) continue;
    const source = await safeFile(identity.root, entry.name);
    try { await safeFile(destination, entry.name); } catch { continue; }
    await copyFile(source, join(destination, entry.name), constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  }
}
export async function restoreCheckout(projectRoot: string, path: string, branch: string): Promise<void> {
  const tree = (await listLocalWorktrees(projectRoot)).find((entry) => entry.path === resolve(path));
  if (!tree || tree.root || tree.branch !== branch || !branch || tree.locked) throw new Error('Checkout identity does not match the requested branch');
  if (!tree.missing) { await checkout(projectRoot, path); return; }
  if (await lstat(path).catch(() => null)) throw new Error('Checkout path already exists');
  const parent = await realpath(dirname(path));
  if (join(parent, relative(dirname(path), path)) !== resolve(path)) throw new Error('Checkout parent contains a symlink');
  const identity = await repositoryIdentity(projectRoot);
  if (!identity) throw new Error('Not a Git project');
  const registrations = join(identity.commonDir, 'worktrees');
  for (const name of await readdir(registrations)) {
    const gitDir = join(registrations, name);
    const registered = (await readFile(join(gitDir, 'gitdir'), 'utf8')).trim();
    if (resolve(registered) !== join(resolve(path), '.git')) continue;
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim();
    if (head !== `ref: refs/heads/${branch}`) throw new Error('Registered checkout branch changed');
    await mkdir(path);
    await writeFile(join(path, '.git'), `gitdir: ${gitDir}\n`, { flag: 'wx' });
    await git(path, ['reset', '--hard', 'HEAD']);
    return;
  }
  throw new Error('Missing checkout registration');
}
