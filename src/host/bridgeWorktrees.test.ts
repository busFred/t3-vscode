import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BridgeHandler, WebviewRegistry } from './bridge';
import { viewsHarness } from './testing/fakeTransport';
import { FakeWebview } from './testing/fakeWebview';
import type { WorktreeCoordinator } from './worktrees';

test('worktree cleanup is requested only by explicit page-open or refresh intent', async t => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  const calls: boolean[] = []; host.refreshWorktrees = async (cleanup = false) => { calls.push(cleanup); };
  const webview = new FakeWebview(), registry = new WebviewRegistry(), bridge = new BridgeHandler(host, registry);
  registry.add('sidebar', webview.webview); bridge.attach(webview.webview, 'sidebar');
  await webview.request('refreshWorktrees');
  await webview.request('refreshWorktrees', { cleanupEnvironments: 'true' });
  await webview.request('refreshWorktrees', { cleanupEnvironments: true });
  assert.deepEqual(calls, [false, false, true]);
});

test('new worktree chat routes from the originating view and validates choice before opening', async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  host.registerView('origin'); host.registerView('other'); await host.selectThread('second', 'origin'); await host.selectThread('third', 'other');
  const received: unknown[] = [];
  const registry = new WebviewRegistry();
  const bridge = new BridgeHandler(host, registry, undefined, undefined, undefined, { newWorktreeChat: async (source, projectId, choice) => { received.push({ source, projectId, choice }); } });
  const webview = new FakeWebview(); registry.add('origin', webview.webview); bridge.attach(webview.webview, 'origin'); registry.add('other', new FakeWebview().webview); registry.focus('other');
  const projectId = host.snapshot('origin').threads.find((thread) => thread.id === 'second')!.projectId;
  await webview.request('newWorktreeChat', { projectId, choice: { type: 'new', baseRef: 'main' }, viewId: 'other' });
  assert.deepEqual(received, [{ source: 'origin', projectId, choice: { type: 'new', baseRef: 'main' } }]);
  await assert.rejects(webview.request('newWorktreeChat', { projectId }), /workspace/);
  assert.equal(received.length, 1); assert.equal(host.snapshot('origin').activeThreadId, 'second'); assert.equal(host.snapshot('other').activeThreadId, 'third');
});
test('worktree cancellation bypasses a blocked host operation and rejects foreign preparations', async (t) => {
  const { host } = await viewsHarness(); t.after(() => host.dispose());
  const projectId = host.snapshot().projects[0]!.id; const calls: string[] = [];
  const snapshot = { loading: false, items: [], settings: [], branches: [], preparations: [{ id: 'preparing', projectId, phase: 'running', stage: 'setup', log: '' }] };
  const fake = { snapshot: () => snapshot, cancel: (id: string) => { calls.push(id); }, dispose: () => {} } as unknown as WorktreeCoordinator;
  Object.defineProperty(host, 'worktrees', { value: fake });
  const webview = new FakeWebview(), registry = new WebviewRegistry(), bridge = new BridgeHandler(host, registry); registry.add('sidebar', webview.webview); bridge.attach(webview.webview, 'sidebar');
  // Occupy exactly the host queue that a normal send/preparation holds.
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const queued = (host as unknown as { enqueue(work: () => Promise<void>): Promise<void> }).enqueue(() => blocked);
  try {
    await webview.request('worktreeAction', { projectId, action: 'cancel', preparationId: 'preparing' });
    assert.deepEqual(calls, ['preparing']);
    await assert.rejects(webview.request('worktreeAction', { projectId: 'foreign', action: 'cancel', preparationId: 'preparing' }), /selected project/);
  } finally { release(); await queued; }
});
