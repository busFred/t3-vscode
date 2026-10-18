import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as Schema from 'effect/Schema';
import { ProjectId, ServerSettings, ThreadId } from '@t3tools/contracts';
import { v2Project, v2ThreadShell, v2Projection } from '../../vendor/client-runtime/src/state/orchestrationV2TestFixtures';
import { HostState, type HostTransport } from './hostState';
import { FakeTransport, credentials, provider, server } from './testing/fakeTransport';
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
  let creates = 0, windowRoot = other;
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
    workspaceRoot: () => windowRoot, draftStore: drafts, worktreeStorageRoot: join(home, 'storage') }, transport);
  await host.start(); await host.refreshWorktrees();
  t.after(async () => { await host.dispose(); await rm(home, { recursive: true, force: true }); });
  return { home, root, other, client, host, drafts, selection, git, creates: () => creates,
    window: (path: string) => { windowRoot = path; },
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
