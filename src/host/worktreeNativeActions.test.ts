import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWorktreeNativeAction, type WorktreeNativeCoordinator, type WorktreeNativePort } from './worktreeNativeActions';
import type { TurnDiff } from './turnDiff';

function fixture() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const tree = { path: '/checkout', branch: 'feature', root: false, missing: false, locked: false };
  const coordinator = {
    snapshot: () => ({ preparations: [{ id: 'job', projectId: 'project' }] }),
    requireCheckout: async (project: string, path: string) => { calls.push({ method: 'requireCheckout', args: [project, path] }); if (project !== 'project' || !['/checkout', '/destination'].includes(path)) throw new Error('Unavailable checkout'); return { tree: { ...tree, path } }; },
    command: async (...args: unknown[]) => { calls.push({ method: 'command', args }); return { executable: '/conda', args: ['run', '--name', 'owned', '/bin/sh'], cwd: tree.path, title: 'Test', env: { T3CODE_WORKTREE_PATH: tree.path } }; },
    cancel: (id: string) => { calls.push({ method: 'cancel', args: [id] }); },
    retry: async (id: string) => { calls.push({ method: 'retry', args: [id] }); },
    prepareCheckout: async (...args: unknown[]) => { calls.push({ method: 'prepareCheckout', args }); },
    restore: async (...args: unknown[]) => { calls.push({ method: 'restore', args }); },
    removalDetails: async () => ({ tree, environment: null, ignored: true }),
    remove: async (...args: unknown[]) => { calls.push({ method: 'remove', args }); },
    review: async (...args: unknown[]) => { calls.push({ method: 'review', args }); return { projectId: 'project', path: tree.path, branch: tree.branch, baseRef: 'fixed-base', files: [{ path: 'selected.txt', additions: 2, deletions: 1 }] }; },
    diffFile: async (...args: unknown[]) => { calls.push({ method: 'diffFile', args }); return { before: 'old', after: 'new' }; },
    apply: async (...args: unknown[]) => { calls.push({ method: 'apply', args }); },
    gitAction: async (...args: unknown[]) => { calls.push({ method: 'gitAction', args }); },
  } as unknown as WorktreeNativeCoordinator;
  let approved = true;
  const port: WorktreeNativePort = {
    confirm: async (...args) => { calls.push({ method: 'confirm', args }); return approved; },
    openWindow: async (...args) => { calls.push({ method: 'openWindow', args }); },
    terminal: async (...args) => { calls.push({ method: 'terminal', args }); },
    openDiff: async (diff, load) => { calls.push({ method: 'openDiff', args: [diff] }); const contents = await load(diff.files[0]!); assert.deepEqual(contents, { oldContents: 'old', newContents: 'new' }); },
  };
  const run = (action: string, extra: Record<string, unknown> = {}) => runWorktreeNativeAction(coordinator, { projectId: 'project', path: '/checkout', action, ...extra }, port);
  return { calls, coordinator, port, run, approve: (value: boolean) => { approved = value; } };
}
test('checkout terminal and project actions retain native argv, environment and cwd', async () => {
  const f = fixture();
  await f.run('terminal'); await f.run('runAction', { actionId: 'test' }); await f.run('open');
  assert.deepEqual(f.calls.filter((call) => call.method === 'command').map((call) => call.args), [['project', '/checkout', undefined], ['project', '/checkout', 'test']]);
  const terminal = f.calls.find((call) => call.method === 'terminal')!.args[0] as Record<string, unknown>;
  assert.deepEqual(terminal.args, ['run', '--name', 'owned', '/bin/sh']); assert.equal(terminal.cwd, '/checkout');
  assert.deepEqual(terminal.env, { T3CODE_WORKTREE_PATH: '/checkout' });
  assert.deepEqual(f.calls.find((call) => call.method === 'openWindow')?.args, ['/checkout']);
  await assert.rejects(f.run('open', { path: '/foreign' }), /Unavailable/);
});
test('cancel and retry operate directly and cannot borrow another project preparation', async () => {
  const f = fixture();
  await f.run('cancel', { preparationId: 'job' });
  await runWorktreeNativeAction(f.coordinator, { projectId: 'project', action: 'retry', preparationId: 'job' }, f.port, { retry: async (id) => { f.calls.push({ method: 'hostRetry', args: [id] }); } });
  assert.deepEqual(f.calls.map((call) => call.method), ['cancel', 'hostRetry']);
  await assert.rejects(f.run('cancel', { projectId: 'other', preparationId: 'job' }), /selected project/);
});
test('removal confirmation names checkout and ignored files and respects cancellation', async () => {
  const f = fixture();
  f.approve(false); await f.run('remove'); assert.equal(f.calls.some((call) => call.method === 'remove'), false);
  const detail = f.calls.find((call) => call.method === 'confirm')!.args[1] as string;
  assert.match(detail, /\/checkout/); assert.match(detail, /Ignored files.*permanently deleted/); assert.match(detail, /branch and conversation history are retained/);
  f.approve(true); await f.run('remove'); assert.deepEqual(f.calls.find((call) => call.method === 'remove')?.args, ['project', '/checkout']);
});
test('apply confirms selected files and destination and passes resolved review baseline', async () => {
  const f = fixture();
  await f.run('apply', { destination: '/destination', files: ['selected.txt'], baseRef: 'main' });
  const confirmation = f.calls.find((call) => call.method === 'confirm')!.args[1] as string;
  assert.match(confirmation, /To: \/destination/); assert.match(confirmation, /selected.txt/);
  assert.deepEqual(f.calls.find((call) => call.method === 'apply')?.args, ['project', '/checkout', '/destination', ['selected.txt'], 'fixed-base']);
  await assert.rejects(f.run('apply', { destination: '/checkout', files: ['selected.txt'] }), /different checkouts/);
  await assert.rejects(f.run('apply', { destination: '/destination', files: ['stale.txt'] }), /no longer part/);
  const cancelled = fixture(); cancelled.approve(false); await cancelled.run('apply', { destination: '/destination', files: ['selected.txt'] });
  assert.equal(cancelled.calls.some((call) => call.method === 'apply'), false);
});
test('review reuses virtual diff loader with truthful label and fixed base', async () => {
  const f = fixture(); await f.run('review', { baseRef: 'main' });
  const diff = f.calls.find((call) => call.method === 'openDiff')!.args[0] as TurnDiff;
  assert.equal(diff.displayLabel, 'Worktree changes'); assert.equal(diff.baseRef, 'fixed-base');
  assert.deepEqual(f.calls.find((call) => call.method === 'diffFile')?.args, ['project', '/checkout', 'fixed-base', 'selected.txt']);
});
test('preparation and restore use coordinator guards; git requires named operation and confirmation', async () => {
  const f = fixture(); await f.run('prepare'); await f.run('restore');
  assert.deepEqual(f.calls.filter((call) => ['prepareCheckout', 'restore'].includes(call.method)).map((call) => call.args), [['project', '/checkout'], ['project', '/checkout']]);
  await assert.rejects(f.run('git', { operation: 'reset_hard' }), /Invalid Git/);
  await assert.rejects(f.run('git', { operation: 'commit' }), /commit message/);
  f.approve(false); await f.run('git', { operation: 'push' }); assert.equal(f.calls.some((call) => call.method === 'gitAction'), false);
  f.approve(true); await f.run('git', { operation: 'commit', commitMessage: 'Selected change' });
  assert.deepEqual(f.calls.find((call) => call.method === 'gitAction')?.args, ['project', '/checkout', 'commit', 'Selected change']);
});
