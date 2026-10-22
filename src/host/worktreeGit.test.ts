import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { applyWorktreeFiles, currentBranch, copyWorktreeConfig, listLocalWorktrees, readWorktreeDiffFile, readWorktreeStatus, repositoryIdentity, restoreCheckout, worktreeChanges, worktreeCleanupIdentity, worktreeRemovalConfirmed } from './worktreeGit';
const exec = promisify(execFile);
test('currentBranch resolves the checkpoint checkout branch, including a separate worktree', async (t) => {
  const f = await fixture(); t.after(f.close);
  assert.equal(await currentBranch(f.root), 'main');
  assert.equal(await currentBranch(f.source), 'source');
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 't3-git-test-'));
  const root = join(home, 'main'); const source = join(home, 'source'); const destination = join(home, 'destination');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, env })).stdout.trim();
  await exec('git', ['init', '-b', 'main', root], { env });
  await git(root, 'config', 'user.name', 'Test'); await git(root, 'config', 'user.email', 'test@example.invalid');
  await writeFile(join(root, 'selected.txt'), 'base\n'); await writeFile(join(root, 'other.txt'), 'untouched\n');
  await writeFile(join(root, '.gitignore'), '.env*\nignored\n');
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'base');
  await git(root, 'worktree', 'add', '-b', 'source', source); await git(root, 'worktree', 'add', '-b', 'destination', destination);
  return { home, root, source, destination, git, close: () => rm(home, { recursive: true, force: true }) };
}
test('environment cleanup requires removed Git metadata and reachable original repository/storage identities', async () => {
  const f = await fixture();
  try {
    const identity = await worktreeCleanupIdentity(f.root, f.source);
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, identity), false);
    await rm(f.source, { recursive: true });
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, identity), false, 'a missing but still registered checkout is retained');
    await f.git(f.root, 'worktree', 'prune', '--expire', 'now');
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, identity), true);
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, { ...identity, parentDevice: 'different' }), false);
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, { ...identity, commonInode: 'different' }), false);
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, { ...identity, commonDir: f.home }), false);
    assert.equal(await worktreeRemovalConfirmed(join(f.home, 'unmounted'), f.source, identity), false);
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source), false, 'legacy records without removal evidence stay untouched');
    await symlink(f.destination, f.source);
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, identity), false, 'a replacement/symlink is not an absent checkout');
  } finally { await f.close(); }
});
test('moved worktrees keep their environment despite disappearing from their old path', async () => {
  const f = await fixture();
  try {
    const identity = await worktreeCleanupIdentity(f.root, f.source);
    await f.git(f.root, 'worktree', 'move', f.source, join(f.home, 'moved'));
    assert.equal(await worktreeRemovalConfirmed(f.root, f.source, identity), false);
    await assert.rejects(worktreeCleanupIdentity(f.root, f.root), /root checkout/);
  } finally { await f.close(); }
});
test('repository identity, detached and missing worktrees, missing restoration', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await repositoryIdentity(f.source), await repositoryIdentity(f.root));
    await f.git(f.source, 'checkout', '--detach');
    assert.equal((await listLocalWorktrees(f.root)).find((entry) => entry.path === f.source)?.branch, '');
    await rm(f.destination, { recursive: true });
    assert.equal((await listLocalWorktrees(f.root)).find((entry) => entry.path === f.destination)?.missing, true);
    await restoreCheckout(f.root, f.destination, 'destination');
    assert.equal(await readFile(join(f.destination, 'selected.txt'), 'utf8'), 'base\n');
    assert.equal(await f.git(f.destination, 'branch', '--show-current'), 'destination');
  } finally { await f.close(); }
});
test('selected changes combine commits, index, working files and untracked without ignored files', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, 'selected.txt'), 'committed\n'); await f.git(f.source, 'commit', '-am', 'source change');
    await writeFile(join(f.source, 'selected.txt'), 'staged\n'); await f.git(f.source, 'add', 'selected.txt');
    await writeFile(join(f.source, 'selected.txt'), 'working\n');
    await writeFile(join(f.source, 'new file.txt'), 'new\n'); await writeFile(join(f.source, 'ignored'), 'secret');
    await writeFile(join(f.destination, 'other.txt'), 'destination edit\n');
    await f.git(f.destination, 'add', 'other.txt');
    const sourceIndex = await f.git(f.source, 'diff', '--cached'); const destinationIndex = await f.git(f.destination, 'diff', '--cached');
    const changes = await worktreeChanges({ projectRoot: f.root, path: f.source });
    assert.deepEqual(changes.files.map((entry) => entry.path).sort(), ['new file.txt', 'selected.txt']);
    assert.deepEqual(await readWorktreeDiffFile({ projectRoot: f.root, path: f.source, baseRef: changes.baseRef, file: 'selected.txt' }), { before: 'base\n', after: 'working\n' });
    await applyWorktreeFiles({ projectRoot: f.root, path: f.source, destination: f.destination, baseRef: changes.baseRef, files: ['selected.txt', 'new file.txt'] });
    assert.equal(await readFile(join(f.destination, 'selected.txt'), 'utf8'), 'working\n');
    assert.equal(await readFile(join(f.destination, 'new file.txt'), 'utf8'), 'new\n');
    assert.equal(await readFile(join(f.destination, 'other.txt'), 'utf8'), 'destination edit\n');
    assert.equal(await f.git(f.source, 'diff', '--cached'), sourceIndex);
    assert.equal(await f.git(f.destination, 'diff', '--cached'), destinationIndex);
    assert.equal(await f.git(f.source, 'branch', '--show-current'), 'source');
    assert.deepEqual(await readWorktreeStatus(f.source), { tracked: true, untracked: true, ignored: true, dirty: true });
  } finally { await f.close(); }
});
test('conflicting transfer is atomic, and foreign checkout and symlink paths are rejected', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, 'selected.txt'), 'source\n'); await writeFile(join(f.destination, 'selected.txt'), 'conflict\n');
    await writeFile(join(f.source, 'new.txt'), 'new\n');
    await assert.rejects(applyWorktreeFiles({ projectRoot: f.root, path: f.source, destination: f.destination, files: ['selected.txt', 'new.txt'] }));
    await assert.rejects(readFile(join(f.destination, 'new.txt')));
    assert.equal(await readFile(join(f.destination, 'selected.txt'), 'utf8'), 'conflict\n');
    await assert.rejects(applyWorktreeFiles({ projectRoot: f.root, path: f.source, destination: f.source, files: ['selected.txt'] }), /distinct/);
    await assert.rejects(applyWorktreeFiles({ projectRoot: f.root, path: f.source, destination: f.home, files: ['selected.txt'] }), /different Git project/);
    await symlink(join(f.root, 'selected.txt'), join(f.destination, 'new.txt'));
    await assert.rejects(applyWorktreeFiles({ projectRoot: f.root, path: f.source, destination: f.destination, files: ['new.txt'] }), /Symlink/);
    await assert.rejects(readWorktreeDiffFile({ projectRoot: f.root, path: f.source, baseRef: 'main', file: '../selected.txt' }), /Unsafe/);
  } finally { await f.close(); }
});
test('config copy skips existing files and symlinks and only includes root env files', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, '.env'), 'root-secret'); await writeFile(join(f.root, '.env.local'), 'local-secret');
    await symlink(join(f.root, 'selected.txt'), join(f.root, '.env.link'));
    await writeFile(join(f.destination, '.env'), 'destination-secret');
    await symlink(join(f.root, 'selected.txt'), join(f.destination, '.env.local'));
    await copyWorktreeConfig(f.root, f.destination);
    assert.equal(await readFile(join(f.destination, '.env'), 'utf8'), 'destination-secret');
    assert.equal(await readFile(join(f.root, 'selected.txt'), 'utf8'), 'base\n');
    await assert.rejects(readFile(join(f.destination, '.env.link')));
    await copyWorktreeConfig(f.root, f.source);
    assert.equal(await readFile(join(f.source, '.env.local'), 'utf8'), 'local-secret');
  } finally { await f.close(); }
});
test('binary changes, deletions and literal unusual file names transfer without renames', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'binary.dat'), Buffer.from([0, 1, 2]));
    await f.git(f.root, 'add', 'binary.dat'); await f.git(f.root, 'commit', '-m', 'binary base');
    await f.git(f.source, 'merge', '--ff-only', 'main'); await f.git(f.destination, 'merge', '--ff-only', 'main');
    await writeFile(join(f.source, 'binary.dat'), Buffer.from([0, 3, 4]));
    await rm(join(f.source, 'selected.txt'));
    const unusual = 'tab\tnewline\n[file].txt';
    await writeFile(join(f.source, unusual), 'literal\n');
    const changes = await worktreeChanges({ projectRoot: f.root, path: f.source });
    assert.equal(changes.files.find((file) => file.path === 'selected.txt')?.deletions, 1);
    assert.equal((await readWorktreeDiffFile({ projectRoot: f.root, path: f.source, baseRef: changes.baseRef, file: 'binary.dat' })).binary, true);
    await applyWorktreeFiles({ projectRoot: f.root, path: f.source, destination: f.destination, files: ['binary.dat', 'selected.txt', unusual] });
    assert.deepEqual(await readFile(join(f.destination, 'binary.dat')), Buffer.from([0, 3, 4]));
    await assert.rejects(readFile(join(f.destination, 'selected.txt')));
    assert.equal(await readFile(join(f.destination, unusual), 'utf8'), 'literal\n');
  } finally { await f.close(); }
});
