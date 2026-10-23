import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as Schema from 'effect/Schema';
import { ProjectId, ServerSettings, ThreadId } from '@t3tools/contracts';
import { v2Project, v2ThreadShell, v2Projection } from '../../vendor/client-runtime/src/state/orchestrationV2TestFixtures';
import { HostState, type HostTransport } from './hostState';
import { FakeTransport, credentials, provider, server, publishText } from './testing/fakeTransport';
import { ComposerDraftStore } from './composerDraftStore';
import { scheduledTaskFixture } from './testing/scheduledTaskFixture';

const exec = promisify(execFile);
async function fixture(t: { after(action: () => Promise<void>): void }) {
  const home = await mkdtemp(join(tmpdir(), 't3-worktree-host-'));
  const root = join(home, 'main'), other = join(home, 'external');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, env })).stdout.trim();
  await exec('git', ['init', '-b', 'main', root], { env });
  await git(root, 'config', 'user.name', 'Fixture'); await git(root, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(root, 'file.py'), 'base\n'); await git(root, 'add', '.'); await git(root, 'commit', '-m', 'base');
  await git(root, 'worktree', 'add', '-b', 'external', other);
  const client = new FakeTransport();
  const selection = { instanceId: provider.instanceId, model: provider.models[0]!.slug };
  client.shell = { ...client.shell, projects: [{ ...v2Project, workspaceRoot: root }], threads: [
    { ...v2ThreadShell, id: ThreadId.make('root-session'), itemCount: 1, modelSelection: selection, activeRunId: null, worktreePath: null, branch: 'main' },
    { ...v2ThreadShell, id: ThreadId.make('other-session'), itemCount: 1, modelSelection: selection, activeRunId: null, worktreePath: other, branch: 'external' },
  ] };
  let settings = Schema.decodeUnknownSync(ServerSettings)({ newWorktreesStartFromOrigin: false, worktreeSubmodules: 'none' });
  let creates = 0, windowRoot = other, refreshMinutes = 10;
  const transport: HostTransport = Object.assign(client, {
    getSettings: async () => settings,
    updateSettings: async (raw: unknown) => { const patch = raw as Partial<typeof settings>; settings = { ...settings, ...patch }; return settings; },
    createWorktree: async (raw: unknown) => {
      const input = raw as { refName: string; newRefName?: string; path?: string | null };
      creates++;
      const path = input.path ?? join(home, `new-${creates}`), branch = input.newRefName ?? input.refName;
      await git(root, 'worktree', 'add', ...(input.newRefName ? ['-b', input.newRefName] : []), path, input.refName);
      return { worktree: { path, refName: branch } } as Awaited<ReturnType<NonNullable<HostTransport['createWorktree']>>>;
    },
  });
  const drafts = new ComposerDraftStore();
  const host = new HostState({ home, credentials, discover: async () => ({ ok: true, server }),
    workspaceRoot: () => windowRoot, draftStore: drafts, worktreeStorageRoot: join(home, 'storage'), worktreeRefreshMinutes: () => refreshMinutes }, transport);
  await host.start(); await host.refreshWorktrees();
  t.after(async () => { await host.dispose(); await rm(home, { recursive: true, force: true }); });
  return { home, root, other, client, host, drafts, selection, git, creates: () => creates,
    window: (path: string) => { windowRoot = path; },
    refreshMinutes: (value: number) => { refreshMinutes = value; host.refreshIntervalsChanged(); },
    setup: (command: string) => { settings = Schema.decodeUnknownSync(ServerSettings)({ newWorktreesStartFromOrigin: false, worktreeSubmodules: 'none',
      defaultProjectScripts: [{ id: 'setup', name: 'Setup', icon: 'configure', command, runOnWorktreeCreate: true, async: false }] }); },
  };
}

test('a worktree window retains project sessions/tasks and new chat defaults to its checkout', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.host.snapshot().threads.map(t => t.id), ['root-session', 'other-session']);
  assert.equal(f.host.snapshot().projects[0]?.workspaceRoot, f.root);
  f.client.scheduledHandler?.([scheduledTaskFixture({ projectId: v2Project.id })]);
  assert.equal(f.host.snapshot().scheduledTasks?.tasks.length, 1);
  f.host.registerView('new', undefined, false); f.host.beginNewChat('new');
  const id = await f.host.newThread(undefined, 'new');
  assert.equal(f.host.snapshot('new').threads.find(t => t.id === id)?.worktreePath, f.other);
  assert.equal(f.client.projectCreates, 0);
});

test('closing an untouched worktree chat deletes only the new conversation, without native checkout cleanup eligibility', async t => {
  const f = await fixture(t);
  f.host.registerView('unused', undefined, false); f.host.beginNewChat('unused');
  await f.host.configureWorktree({ type: 'existing', path: f.other, branch: 'external' }, v2Project.id, 'unused');
  const id = await f.host.newThread(v2Project.id, 'unused');
  await f.host.composerState(id, true, false, 'unused');
  const created = f.client.commands.find(c => c.type === 'thread.create' && c.threadId === id);
  assert.equal(created?.type === 'thread.create' && created.worktreePath, f.other);
  assert.equal(created?.type === 'thread.create' && created.branch, null, 'Untouched chats must not opt a checkout into T3 worktree-on-delete cleanup');
  await f.host.removeView('unused');
  assert(f.client.commands.some(c => c.type === 'thread.delete' && c.threadId === id));
  assert(!f.host.snapshot().threads.some(t => t.id === id));
  assert(f.host.snapshot().threads.some(t => t.id === 'other-session'));
  assert.equal(await readFile(join(f.other, 'file.py'), 'utf8'), 'base\n');
  assert.match(await f.git(f.root, 'worktree', 'list', '--porcelain'), /branch refs\/heads\/external/);
});

test('worktree cleanup retains typed chats, external edits and failed preparation attempts', async t => {
  const f = await fixture(t);
  for (const reason of ['typed-and-cleared', 'external-branch', 'external-message', 'failed-setup']) {
    f.host.registerView(reason, undefined, false); f.host.beginNewChat(reason);
    if (reason === 'failed-setup') await f.host.configureWorktree({ type: 'new', startFromOrigin: false }, v2Project.id, reason);
    const id = await f.host.newThread(v2Project.id, reason);
    await f.host.composerState(id, true, false, reason);
    if (reason === 'typed-and-cleared') await f.host.composerState(id, undefined, true, reason);
    if (reason === 'external-branch') {
      f.client.shell = { ...f.client.shell, threads: f.client.shell.threads.map(thread => thread.id === id ? { ...thread, branch: 'external' } : thread) };
      f.client.shellHandler!({ kind: 'snapshot', snapshot: f.client.shell });
    }
    if (reason === 'external-message') publishText(f.client, id, 'Keep the message sent elsewhere');
    if (reason === 'failed-setup') { f.setup('exit 17'); await assert.rejects(f.host.sendMessage('attempt setup', id, reason)); }
    await f.host.removeView(reason);
    assert(f.host.snapshot().threads.some(thread => thread.id === id), reason);
    assert(!f.client.commands.some(c => c.type === 'thread.delete' && c.threadId === id), reason);
  }
});

test('worktree scans ignore conversation activity/config churn and retain configurable periodic/manual refresh', async t => {
  const f = await fixture(t);
  const internals = f.host as unknown as { worktreePoll: NodeJS.Timeout | null; worktreeRefreshTimer: NodeJS.Timeout | null };
  assert.equal((internals.worktreePoll as unknown as { _idleTimeout: number })._idleTimeout, 600_000);
  f.refreshMinutes(0);
  assert.equal(internals.worktreePoll, null);
  f.refreshMinutes(0.5);
  assert.equal((internals.worktreePoll as unknown as { _idleTimeout: number })._idleTimeout, 30_000);
  f.refreshMinutes(0);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(internals.worktreeRefreshTimer, null);
  for (let i = 1; i <= 3; i++) {
    f.client.shell = { ...f.client.shell, snapshotSequence: f.client.shell.snapshotSequence + 1,
      threads: f.client.shell.threads.map(thread => ({ ...thread, title: `Activity ${i}`, itemCount: thread.itemCount + 1 })) };
    f.client.shellHandler!({ kind: 'snapshot', snapshot: f.client.shell });
    f.client.onConfig?.(f.client.config as Parameters<NonNullable<HostTransport['onConfig']>>[0]);
    assert.equal(internals.worktreeRefreshTimer, null, 'Ordinary conversation/provider updates must not scan Git');
  }
  f.client.shell = { ...f.client.shell, threads: [...f.client.shell.threads,
    { ...v2ThreadShell, id: ThreadId.make('new-checkout'), worktreePath: join(f.home, 'new-checkout'), branch: 'new-checkout' }] };
  f.client.shellHandler!({ kind: 'snapshot', snapshot: f.client.shell });
  assert(internals.worktreeRefreshTimer, 'A new checkout path should refresh promptly');
  await f.host.refreshWorktrees();
  assert(f.host.worktrees!.snapshot().items.some(tree => tree.path === join(f.home, 'new-checkout')));
});

test('linked service projects retain canonical repository metadata and correct main-checkout chat binding', async t => {
  const f = await fixture(t), linkedId = ProjectId.make('linked');
  f.client.shell = { ...f.client.shell, projects: [...f.client.shell.projects, { ...v2Project, id: linkedId, workspaceRoot: f.other, title: 'Linked project' }],
    threads: [...f.client.shell.threads, { ...v2ThreadShell, id: ThreadId.make('linked-root-session'), projectId: linkedId, worktreePath: null, branch: 'external' }] };
  f.client.shellHandler!({ kind: 'snapshot', snapshot: f.client.shell });
  await f.host.refreshWorktrees();
  const items = f.host.worktrees!.snapshot().items;
  assert.equal(new Set(items.map(item => item.repositoryId)).size, 1);
  assert(items.filter(item => item.root).every(item => item.path === f.root));
  assert(items.filter(item => item.projectId === linkedId).every(item => item.projectRoot === f.other));
  assert(items.every(item => item.head));
  f.host.registerView('main-chat', undefined, false); f.host.beginNewChat('main-chat');
  await f.host.configureWorktree({ type: 'existing', path: f.root }, linkedId, 'main-chat');
  const id = await f.host.newThread(linkedId, 'main-chat');
  await f.host.sendMessage('work in main', id, 'main-chat');
  const thread = f.host.snapshot().threads.find(thread => thread.id === id);
  assert.equal(thread?.worktreePath, f.root); assert.equal(thread?.branch, 'main');
  assert.equal(f.creates(), 0);
  assert.equal(f.host.worktrees!.snapshot().preparations.length, 0, 'Main checkout never runs worktree setup');
});

test('repository subfolder and symlink projects retain checkout membership and current-window markers', async t => {
  const f = await fixture(t), subdir = join(f.root, 'src'), alias = join(f.root, 'linked-alias');
  await mkdir(subdir); await symlink(f.other, alias, 'dir');
  const subId = ProjectId.make('subdir'), aliasId = ProjectId.make('alias');
  f.client.shell = { ...f.client.shell, projects: [...f.client.shell.projects,
    { ...v2Project, id: subId, workspaceRoot: subdir }, { ...v2Project, id: aliasId, workspaceRoot: alias }],
    threads: [...f.client.shell.threads,
      { ...v2ThreadShell, id: ThreadId.make('subdir-session'), projectId: subId, worktreePath: null },
      { ...v2ThreadShell, id: ThreadId.make('alias-session'), projectId: aliasId, worktreePath: null }] };
  f.client.shellHandler!({ kind: 'snapshot', snapshot: f.client.shell });
  f.window(alias); await f.host.refreshWorktrees();
  const items = f.host.worktrees!.snapshot().items;
  assert(items.find(item => item.projectId === subId && item.path === f.root)?.threadIds.includes('subdir-session'));
  assert(items.find(item => item.projectId === aliasId && item.path === f.other)?.threadIds.includes('alias-session'));
  assert.equal(items.find(item => item.projectId === subId)?.projectCheckoutPath, f.root);
  assert.equal(items.find(item => item.projectId === aliasId)?.projectCheckoutPath, f.other);
  assert(items.filter(item => item.openInWindow).every(item => item.path === f.other));
  assert(items.some(item => item.openInWindow));
  assert.equal(f.host.snapshot().projects.find(project => project.id === subId)?.workspaceRoot, subdir);
  await assert.rejects(f.host.worktrees!.removalDetails(v2Project.id, f.other), /open in this window/);
});

test('an inherited nonempty conversation does not prevent selecting a new worktree chat', async t => {
  const f = await fixture(t);
  f.host.registerView('new', 'sidebar', false); f.host.beginNewChat('new');
  await f.host.configureWorktree({ type: 'new', baseRef: 'main', branch: 'test/new', startFromOrigin: false }, v2Project.id, 'new');
  const id = await f.host.newThread(v2Project.id, 'new');
  await f.host.sendMessage('run in worktree', id, 'new');
  const created = f.client.commands.findLast(c => c.type === 'thread.metadata.update');
  assert.equal(created?.type === 'thread.metadata.update' && created.expectedEmpty, true);
  assert.equal(f.host.snapshot('new').threads.find(t => t.id === id)?.worktreePath, join(f.home, 'new-1'));
  assert.equal(f.client.commands.findLast(c => c.type === 'message.dispatch')?.threadId, id);
});

test('synchronous setup failure preserves binding and prompt; retry sends once without another checkout', async t => {
  const f = await fixture(t); f.setup('exit 17');
  f.host.registerView('new', undefined, false); f.host.beginNewChat('new');
  await f.host.configureWorktree({ type: 'new', startFromOrigin: false }, v2Project.id, 'new');
  const id = await f.host.newThread(v2Project.id, 'new');
  f.host.saveComposerDraft(id, { text: 'keep my prompt', contexts: [] }, undefined, 'new');
  await assert.rejects(f.host.sendMessage('keep my prompt', id, 'new'));
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 0);
  assert.equal(f.drafts.owned((f.host as any).draftScope(), id, 'new')?.draft.text, 'keep my prompt');
  assert.equal(f.host.snapshot('new').threads.find(t => t.id === id)?.worktreePath, join(f.home, 'new-1'));
  const preparation = f.host.worktrees!.snapshot().preparations.find(p => p.threadId === id)!;
  f.setup('exit 0'); await f.host.retryWorktreePreparation(preparation.id);
  await f.host.sendMessage('keep my prompt', id, 'new');
  assert.equal(f.creates(), 1); assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 1);
});

test('parallel runs bind independent checkouts and clear the successful composer draft', async t => {
  const f = await fixture(t);
  f.host.registerView('new', undefined, false); f.host.beginNewChat('new');
  await f.host.configureWorktree({ type: 'new', startFromOrigin: false, runs: [{ modelSelection: f.selection, count: 2 }] }, v2Project.id, 'new');
  const id = await f.host.newThread(v2Project.id, 'new');
  f.host.saveComposerDraft(id, { text: 'parallel prompt', contexts: [] }, undefined, 'new');
  await f.host.sendMessage('parallel prompt', id, 'new');
  const sends = f.client.commands.filter(c => c.type === 'message.dispatch');
  assert.equal(sends.length, 2);
  const paths = sends.map(c => f.client.shell.threads.find(t => t.id === c.threadId)?.worktreePath);
  assert.equal(new Set(paths).size, 2); assert(paths.every(Boolean)); assert.equal(f.creates(), 2);
  assert.equal(f.drafts.owned((f.host as any).draftScope(), id, 'new')?.draft.text, '');
  assert.equal(new Set(f.host.worktrees!.snapshot().preparations.filter(p => p.groupId).map(p => p.groupId)).size, 1);
});

test('references and suggestions identify external checkouts and never leak another project', async t => {
  const f = await fixture(t); await f.host.selectThread('root-session');
  const reference = { type: 'file' as const, uri: pathToFileURL(join(f.other, 'file.py')).href, path: join(f.other, 'file.py'), label: 'file.py' };
  assert.equal(f.host.referenceForView(reference, 'sidebar').label, reference.path);
  await f.host.selectThread('other-session');
  assert.equal(f.host.referenceForView(reference, 'sidebar').label, 'file.py');
  f.client.pathEntries = { entries: [{ kind: 'file', path: 'file.py' }], truncated: false };
  const results = await f.host.composerSuggestions('path', 'file', false);
  assert(results.some(r => r.value === 'file.py' && r.uri === reference.uri));
  assert(results.some(r => r.value === join(f.root, 'file.py')));
  assert.deepEqual(new Set(f.client.pathSearches.map(s => s.cwd)), new Set([f.root, f.other]));
});

test('root conversation continues with history and copied edits; existing worktree cannot retarget', async t => {
  const f = await fixture(t); await f.host.selectThread('root-session');
  await writeFile(join(f.root, 'file.py'), 'edited\n');
  await f.host.continueInWorktree('sidebar', true);
  const moved = f.host.snapshot().threads.find(t => t.id === 'root-session')!;
  assert.equal(moved.id, 'root-session'); assert(moved.worktreePath);
  assert.equal(await readFile(join(moved.worktreePath, 'file.py'), 'utf8'), 'edited\n');
  assert.equal(await readFile(join(f.root, 'file.py'), 'utf8'), 'edited\n');
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 0);
  assert.equal(f.client.commands.findLast(c => c.type === 'thread.metadata.update')?.type, 'thread.metadata.update');
  await assert.rejects(f.host.continueInWorktree('sidebar', false), /idle conversation/);
});

test('handoff copy retries safely after a failed metadata write without copying twice', async t => {
  const f = await fixture(t); await f.host.selectThread('root-session');
  await writeFile(join(f.root, 'file.py'), 'edited\n');
  const dispatch = f.client.dispatch.bind(f.client); let fail = true;
  f.client.dispatch = async input => {
    if ((input as { type: string }).type === 'thread.metadata.update' && fail) { fail = false; throw new Error('metadata response failure'); }
    return dispatch(input);
  };
  await assert.rejects(f.host.continueInWorktree('sidebar', true), /metadata response failure/);
  const failed = f.host.worktrees!.snapshot().preparations.find(p => p.threadId === 'root-session')!;
  assert.equal(await readFile(join(f.home, 'new-1', 'file.py'), 'utf8'), 'edited\n');
  await f.host.retryWorktreePreparation(failed.id);
  assert.equal(f.host.snapshot().threads.find(t => t.id === 'root-session')?.worktreePath, join(f.home, 'new-1'));
  assert.equal(f.creates(), 1);
});

test('parallel failures from a new draft retain the visible first prompt and sibling references, files and selection', async t => {
  const f = await fixture(t); f.setup('exit 19');
  f.host.registerView('new', undefined, false); f.host.beginNewChat('new');
  const reference = { type: 'file' as const, uri: pathToFileURL(join(f.root, 'file.py')).href, path: join(f.root, 'file.py'), label: 'file.py', inlineText: '@file.py', text: 'base\n' };
  const draft = { text: 'see @file.py', contexts: [reference] };
  const selection = { start: 4, end: 12 };
  f.host.saveComposerDraft('new', draft, selection, 'new');
  const bytes = new TextEncoder().encode('retained attachment');
  const file = await f.host.uploadAttachment('notes.txt', 'text/plain', bytes, 'new');
  await f.host.configureWorktree({ type: 'new', startFromOrigin: false, runs: [{ modelSelection: f.selection, count: 2 }] }, v2Project.id, 'new');
  await assert.rejects(f.host.sendMessage(draft.text, undefined, 'new', 'auto', [file.attachment!.id]));
  const children = f.client.commands.filter(c => c.type === 'thread.create');
  const sibling = children[1]; assert(sibling?.type === 'thread.create');
  const record = f.drafts.claim((f.host as any).draftScope(), sibling.threadId, 'inspect');
  assert.deepEqual(record.draft.contexts, [reference]); assert.equal(record.draft.text, draft.text);
  assert.deepEqual(record.selection, selection);
  assert.deepEqual(record.draft.attachments?.[0], file);
  assert.deepEqual(f.drafts.file(record, file.key), bytes);
  f.drafts.release('inspect');
  const first = children[0]; assert(first?.type === 'thread.create');
  assert.equal(f.host.snapshot('new').activeThreadId, first.threadId);
  const visible = await f.host.restoreComposerDraft(first.threadId, 'new');
  assert.equal(visible.draft.text, draft.text); assert.deepEqual(visible.draft.contexts, [reference]);
  assert.deepEqual(visible.selection, selection); assert.deepEqual(visible.draft.attachments?.[0], file);
  assert.deepEqual(f.drafts.file(f.drafts.owned((f.host as any).draftScope(), first.threadId, 'new')!, file.key), bytes);
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 0);
});

test('a successful first parallel run clears its copied draft while a failed sibling retains its prompt', async t => {
  const f = await fixture(t);
  f.host.registerView('new', undefined, false); f.host.beginNewChat('new');
  f.host.saveComposerDraft('new', { text: 'parallel prompt', contexts: [] }, undefined, 'new');
  await f.host.configureWorktree({ type: 'new', startFromOrigin: false, runs: [{ modelSelection: f.selection, count: 2 }] }, v2Project.id, 'new');
  const dispatch = f.client.dispatch.bind(f.client);
  f.client.dispatch = async input => {
    const command = input as { type: string; threadId: string };
    const sibling = f.client.commands.filter(c => c.type === 'thread.create')[1];
    if (command.type === 'message.dispatch' && sibling?.type === 'thread.create' && command.threadId === sibling.threadId) throw new Error('sibling send failed');
    return dispatch(input);
  };
  await f.host.sendMessage('parallel prompt', undefined, 'new');
  const first = f.host.snapshot('new').activeThreadId!;
  assert.equal((await f.host.restoreComposerDraft(first, 'new')).draft.text, '');
  assert.equal((await f.host.restoreComposerDraft('new', 'new')).draft.text, '');
  const sibling = f.client.commands.filter(c => c.type === 'thread.create')[1]; assert(sibling?.type === 'thread.create');
  const retained = f.drafts.claim((f.host as any).draftScope(), sibling.threadId, 'inspect');
  assert.equal(retained.draft.text, 'parallel prompt'); f.drafts.release('inspect');
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 1);
});

for (const ambiguous of [false, true]) test(`parallel preflight cleans untouched siblings after ${ambiguous ? 'lost' : 'rejected'} create response`, async t => {
  const f = await fixture(t);
  f.host.registerView('new', undefined, false); f.host.beginNewChat('new');
  f.host.saveComposerDraft('new', { text: 'four runs', contexts: [] }, undefined, 'new');
  await f.host.configureWorktree({ type: 'new', startFromOrigin: false, runs: [{ modelSelection: f.selection, count: 4 }] }, v2Project.id, 'new');
  const dispatch = f.client.dispatch.bind(f.client); let creates = 0;
  f.client.dispatch = async input => {
    if ((input as { type: string }).type === 'thread.create' && ++creates === 3) {
      if (ambiguous) await dispatch(input);
      throw new Error('third conversation creation failed');
    }
    return dispatch(input);
  };
  f.client.getThreadProjection = async id => {
    const thread = f.client.shell.threads.find(t => t.id === id);
    assert(thread); return { ...v2Projection, thread: { ...v2Projection.thread, id: thread.id, projectId: thread.projectId, title: thread.title, worktreePath: thread.worktreePath }, messages: [], runs: [], visibleTurnItems: [] };
  };
  await assert.rejects(f.host.sendMessage('four runs', undefined, 'new'), /third conversation creation failed/);
  assert.deepEqual(f.client.shell.threads.map(t => t.id), ['root-session', 'other-session']);
  assert.equal(f.creates(), 0); assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 0);
  assert.equal([...((f.drafts as any).claims as Map<string, string>).keys()].some(key => key.includes('worktree-run:')), false);
  assert.equal((await f.host.restoreComposerDraft('new', 'new')).draft.text, 'four runs');
});

test('provider-controlled subagents retain their checkout and cannot continue independently', async t => {
  const f = await fixture(t);
  f.client.shell = { ...f.client.shell, threads: f.client.shell.threads.map(thread => thread.id === 'root-session' ? { ...thread,
    creationSource: 'provider', lineage: { ...thread.lineage, parentThreadId: ThreadId.make('other-session'), relationshipToParent: 'subagent' } } : thread) };
  await f.host.refreshWorktrees(); await f.host.selectThread('root-session');
  assert.equal(f.host.snapshot().threads.find(t => t.id === 'root-session')?.providerNativeSubagent, true);
  await assert.rejects(f.host.continueInWorktree('sidebar', false), /controlled by its provider/);
  assert.equal(f.creates(), 0); assert.equal(f.client.commands.some(c => c.type === 'thread.metadata.update'), false);
});

test('handoff retry after host restart restores the retained copy intent and checkout', async t => {
  const f = await fixture(t); await f.host.selectThread('root-session');
  await writeFile(join(f.root, 'file.py'), 'edited before restart\n');
  const dispatch = f.client.dispatch.bind(f.client); let fail = true;
  f.client.dispatch = async input => {
    if ((input as { type: string }).type === 'thread.metadata.update' && fail) { fail = false; throw new Error('metadata unavailable'); }
    return dispatch(input);
  };
  await assert.rejects(f.host.continueInWorktree('sidebar', true), /metadata unavailable/);
  const failed = f.host.worktrees!.snapshot().preparations.find(p => p.threadId === 'root-session')!;
  await f.host.dispose();
  const reloaded = new HostState({ home: f.home, credentials, discover: async () => ({ ok: true, server }),
    workspaceRoot: () => f.other, worktreeStorageRoot: join(f.home, 'storage') }, f.client);
  t.after(() => reloaded.dispose());
  await reloaded.start(); await reloaded.refreshWorktrees();
  await reloaded.retryWorktreePreparation(failed.id);
  assert.equal(reloaded.snapshot().threads.find(t => t.id === 'root-session')?.worktreePath, join(f.home, 'new-1'));
  assert.equal(await readFile(join(f.home, 'new-1', 'file.py'), 'utf8'), 'edited before restart\n');
  assert.equal(f.creates(), 1);
});

test('a session follows a branch switched inside its checkout by default', async t => {
  const f = await fixture(t);
  await f.git(f.other, 'switch', '-c', 'drifted');
  await f.host.sendMessage('continue', 'other-session');
  const thread = f.host.snapshot().threads.find(t => t.id === 'other-session')!;
  assert.equal(thread.branch, 'drifted'); assert.equal(thread.worktreePath, f.other);
  const update = f.client.commands.findLast(c => c.type === 'thread.metadata.update');
  assert(update?.type === 'thread.metadata.update' && update.branch === 'drifted' && update.worktreePath === undefined, 'Only the branch is updated; the checkout binding stays');
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 1);
  assert(!f.host.worktrees!.snapshot().preparations.some(p => p.threadId === 'other-session' && p.phase === 'failed'));
});

test('a kept session branch holds messages until the checkout is switched back or its branch is used', async t => {
  const f = await fixture(t);
  await f.host.setSessionBranchPolicy('other-session', 'pinned');
  await f.host.refreshWorktrees();
  assert.equal(f.host.worktrees!.snapshot().settings[0]?.sessionBranchPolicies?.['other-session'], 'pinned');
  await f.git(f.other, 'switch', '-c', 'drifted');
  await assert.rejects(f.host.sendMessage('continue', 'other-session'), /pinned to branch external.*branch drifted/);
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 0);
  assert.equal(f.host.snapshot().threads.find(t => t.id === 'other-session')?.branch, 'external');
  assert(!f.host.worktrees!.snapshot().preparations.some(p => p.threadId === 'other-session'), 'A held message must not leave a failed setup attempt');

  await writeFile(join(f.other, 'file.py'), 'dirty\n');
  await assert.rejects(f.host.switchCheckoutToSessionBranch('other-session'), /uncommitted changes/);
  assert.equal(await f.git(f.other, 'branch', '--show-current'), 'drifted');
  await f.git(f.other, 'checkout', '--', 'file.py');
  await f.host.switchCheckoutToSessionBranch('other-session');
  assert.equal(await f.git(f.other, 'branch', '--show-current'), 'external');
  await f.host.sendMessage('continue', 'other-session');
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 1);

  f.client.shell = { ...f.client.shell, threads: f.client.shell.threads.map(t => t.id === 'other-session' ? { ...t, activeRunId: null } : t) };
  (f.host as any).acceptedMessages.delete('other-session'); (f.host as any).shell = await f.client.snapshotShell();
  await f.git(f.other, 'switch', '-c', 'second');
  await f.host.adoptCheckoutBranch('other-session');
  assert.equal(f.host.snapshot().threads.find(t => t.id === 'other-session')?.branch, 'second');
  await f.host.sendMessage('again', 'other-session');
  assert.equal(f.client.commands.filter(c => c.type === 'message.dispatch').length, 2);
});

test('retrying a setup held by a kept branch succeeds after the session follows its checkout', async t => {
  const f = await fixture(t);
  await f.host.setSessionBranchPolicy('other-session', 'pinned');
  await f.git(f.other, 'switch', '-c', 'drifted');
  await assert.rejects(f.host.prepareThreadWorkspace('other-session', { type: 'existing', path: f.other }), /pinned/);
  const failed = f.host.worktrees!.snapshot().preparations.find(p => p.threadId === 'other-session')!;
  assert.equal(failed.phase, 'failed'); assert.equal(failed.branch, 'drifted');
  await f.host.setSessionBranchPolicy('other-session', 'follow');
  await f.host.retryWorktreePreparation(failed.id);
  assert.equal(f.host.worktrees!.snapshot().preparations.find(p => p.id === failed.id)?.phase, 'ready');
  assert.equal(f.host.snapshot().threads.find(t => t.id === 'other-session')?.branch, 'drifted');
  await assert.rejects(f.host.setSessionBranchPolicy('other-session', 'sometimes'), /Invalid branch policy/);
});

test('switching refuses a detached checkout whose commits are on no branch', async t => {
  const f = await fixture(t);
  await f.host.setSessionBranchPolicy('other-session', 'pinned');
  await f.git(f.other, 'switch', '--detach');
  await f.git(f.other, 'config', 'user.name', 'Fixture'); await f.git(f.other, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(f.other, 'file.py'), 'detached\n'); await f.git(f.other, 'commit', '-am', 'detached work');
  await assert.rejects(f.host.switchCheckoutToSessionBranch('other-session'), /commits on no branch/);
  assert.equal(await f.git(f.other, 'branch', '--show-current'), '');
  await f.git(f.other, 'branch', 'saved-work');
  await f.host.switchCheckoutToSessionBranch('other-session');
  assert.equal(await f.git(f.other, 'branch', '--show-current'), 'external');
});
