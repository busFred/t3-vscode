import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import * as Schema from 'effect/Schema';
import { ProjectId, ServerSettings } from '@t3tools/contracts';
import { WorktreeEnvironmentManager } from './worktreeEnvironment';
import { WorktreeSettingsStore } from './worktreeSettings';
import type { WorktreeProjectSettings } from '../shared/worktrees';

const action = { id: 'test', name: 'Test', command: 'npm test', icon: 'test', runOnWorktreeCreate: false };
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 't3-settings-test-'));
  const root = join(home, 'project'); await mkdir(root);
  const storage = join(home, 'storage');
  const environment = new WorktreeEnvironmentManager(storage, { runner: async () => { throw new Error('No live commands allowed'); } });
  const store = new WorktreeSettingsStore(storage, environment);
  let native = Schema.decodeUnknownSync(ServerSettings)({ worktreesDirectory: '', storageCleanup: { worktreeKeepWhen: 'uncommitted-changes', worktreeSettledAfterDays: null }, defaultProjectScripts: [action], projectSettingsFolded: true, projectSettingsOverrides: { project: { branchNamePrefix: 'prior', sidebarAutoSettleAfterDays: 9 }, other: { branchNamePrefix: 'other' } } });
  const writes: unknown[] = [];
  const client = { worktreeSettingsCapabilities: { worktreesDirectory: true, cleanupRetention: true, runOnSettle: true }, getSettings: async () => native, updateSettings: async (patch: unknown) => {
    writes.push(patch);
    const value = patch as { worktreesDirectory?: string; projectSettingsOverrides: typeof native.projectSettingsOverrides };
    native = { ...native, ...(value.worktreesDirectory === undefined ? {} : { worktreesDirectory: value.worktreesDirectory }), projectSettingsOverrides: { ...native.projectSettingsOverrides, ...value.projectSettingsOverrides } };
    return native;
  } };
  const project = { id: 'project', workspaceRoot: root, scripts: [] };
  return { home, root, storage, environment, store, client, project, writes, native: () => native, close: () => rm(home, { recursive: true, force: true }) };
}
test('loads actual service actions and keeps file scripts separate with stable import IDs', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 't3.json'), '{ // team scripts\n "scripts":[{"name":"Setup","command":"npm ci","runOnWorktreeCreate":true,"async":false}],"worktreeSubmodules":"none"}');
    const loaded = await f.store.load('server/project', f.project, f.client);
    assert.deepEqual(loaded.actions, [action]); assert.equal(loaded.fileActions[0]?.name, 'Setup');
    assert.equal(loaded.fileActions[0]?.async, false); assert.equal(loaded.submodules, 'none');
    assert.equal(loaded.cleanup.enabled, false); assert.equal(loaded.copyEnv, false);
    assert.equal(loaded.branchPrefix, 'prior');
    assert.deepEqual((await f.store.load('server/project', f.project, f.client)).fileActions, loaded.fileActions);
    assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});
test('saves native overrides, preserves other settings, and scopes local preferences separately', async () => {
  const f = await fixture();
  try {
    const loaded = await f.store.load('server/project', f.project, f.client);
    const next: WorktreeProjectSettings = { ...loaded, actions: [{ ...action, command: 'npm run test' }], location: join(f.home, 'worktrees'), copyEnv: true, branchPrefix: 'feature', submodules: 'top-level', startFromOrigin: false,
      environment: { ...loaded.environment, enabled: true, autoCleanup: false }, cleanup: { enabled: true, inactiveDays: 14, merged: true, unchanged: false, settledDays: 5, keepLocalFiles: 'tracked' } };
    const saved = await f.store.save('server/project', f.project, f.client, next);
    assert.deepEqual(saved.actions, next.actions); assert.deepEqual(saved.cleanup, next.cleanup);
    assert.equal(saved.environment.enabled, true); assert.equal(saved.copyEnv, true); assert.equal(saved.location, next.location);
    assert.equal(saved.environment.autoCleanup, false);
    assert.equal(f.native().projectSettingsOverrides[ProjectId.make('other')]?.branchNamePrefix, 'other');
    assert.equal(f.native().projectSettingsOverrides[ProjectId.make('project')]?.sidebarAutoSettleAfterDays, 9);
    const patch = f.writes[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(patch), ['worktreesDirectory', 'projectSettingsOverrides']);
    const rules = f.native().projectSettingsOverrides[ProjectId.make('project')]?.worktreeCleanup;
    assert.equal(rules?.mode, 'custom');
    if (rules?.mode === 'custom') { assert.equal(rules.rules.worktreeSettledAfterDays, 5); assert.equal(rules.rules.worktreeKeepWhen, 'tracked-changes'); }
    const encoded = JSON.stringify(patch);
    assert(!encoded.includes('autoCleanup'), 'extension cleanup preference must not be sent to T3');
    assert.ok(!encoded.includes('settledDays') && !encoded.includes('keepLocalFiles') && !encoded.includes('copyEnv') && !encoded.includes('location'));
    const otherScope = await f.store.load('another-server/project', f.project, f.client);
    assert.equal(otherScope.copyEnv, false); assert.equal(otherScope.location, next.location); assert.equal(otherScope.environment.enabled, false);
    assert.equal(otherScope.environment.autoCleanup, true);
    const files = await readdir(join(f.storage, 'worktree-settings'));
    assert.equal(files.length, 1); assert.ok(files.every((file) => !file.endsWith('.tmp')));
  } finally { await f.close(); }
});
test('validates every input before service or local writes', async () => {
  const f = await fixture();
  try {
    const loaded = await f.store.load('scope', f.project, f.client);
    const invalid = [
      { ...loaded, projectId: 'foreign' }, { ...loaded, arbitrary: true },
      { ...loaded, actions: [action, action] },
      { ...loaded, actions: [{ ...action, icon: 'shell' }] },
      { ...loaded, actions: [{ ...action, async: 'false' }] },
      { ...loaded, actions: [{ ...action, command: 'x'.repeat(32_769) }] },
      { ...loaded, actions: [{ ...action, runOnWorktreeCreate: true }, { ...action, id: 'two', name: 'Two', runOnWorktreeCreate: true }] },
      { ...loaded, environment: { ...loaded.environment, trusted: true } },
      { ...loaded, cleanup: { ...loaded.cleanup, inactiveDays: -1 } },
      { ...loaded, cleanup: { ...loaded.cleanup, worktreeOnDelete: true } },
      { ...loaded, branchPrefix: '../outside' }, { ...loaded, location: 'invalid\npath' },
      { ...loaded, copyEnv: 'true' },
    ];
    for (const raw of invalid) await assert.rejects(f.store.save('scope', f.project, f.client, raw));
    assert.equal(f.writes.length, 0); assert.equal((await f.environment.getProfile('scope')).enabled, false);
    await assert.rejects(readdir(join(f.storage, 'worktree-settings')));
  } finally { await f.close(); }
});
test('unsupported service save fails before extension-local profile writes', async () => {
  const f = await fixture();
  try {
    const loaded = await f.store.load('scope', f.project, f.client);
    const next = { ...loaded, environment: { ...loaded.environment, enabled: true }, copyEnv: true };
    await assert.rejects(f.store.save('scope', f.project, {}, next), /compatible server/);
    await assert.rejects(f.store.save('scope', f.project, { updateSettings: f.client.updateSettings }, next), /support project settings/);
    assert.equal(f.writes.length, 0); assert.equal((await f.environment.getProfile('scope')).enabled, false);
  } finally { await f.close(); }
});
test('t3.json malformed, oversized and symlink files surface import errors without changing service actions', async () => {
  const f = await fixture();
  try {
    for (const content of ['{"scripts":false}', 'not json', 'x'.repeat(1024 * 1024 + 1)]) {
      await writeFile(join(f.root, 't3.json'), content);
      const loaded = await f.store.load('scope', f.project, f.client);
      assert.ok(loaded.fileError); assert.deepEqual(loaded.fileActions, []); assert.deepEqual(loaded.actions, [action]);
    }
    await rm(join(f.root, 't3.json')); await writeFile(join(f.home, 'external.json'), '{}');
    await symlink(join(f.home, 'external.json'), join(f.root, 't3.json'));
    assert.ok((await f.store.load('scope', f.project, f.client)).fileError);
    assert.equal(await readFile(join(f.home, 'external.json'), 'utf8'), '{}');
  } finally { await f.close(); }
});
test('old servers expose disabled capabilities and refuse unsupported changes before writes', async () => {
  const f = await fixture();
  try {
    const oldNative = Schema.decodeUnknownSync(ServerSettings)({ defaultProjectScripts: [action], projectSettingsFolded: true });
    assert.equal(Object.hasOwn(oldNative, 'worktreesDirectory'), false);
    assert.equal(Object.hasOwn(oldNative.storageCleanup, 'worktreeKeepWhen'), false);
    assert.equal(Object.hasOwn(oldNative.storageCleanup, 'worktreeSettledAfterDays'), false);
    const oldClient = { getSettings: async () => oldNative, updateSettings: async (patch: unknown) => { f.writes.push(patch); return oldNative; } };
    const loaded = await f.store.load('old', f.project, oldClient);
    assert.deepEqual(loaded.capabilities, { worktreesDirectory: false, cleanupRetention: false, runOnSettle: false });
    assert.equal(loaded.cleanup.settledDays, null);
    const invalid = [
      { ...loaded, location: '/new-location' },
      { ...loaded, cleanup: { ...loaded.cleanup, settledDays: 0 } },
      { ...loaded, cleanup: { ...loaded.cleanup, keepLocalFiles: 'any' } },
      { ...loaded, actions: [{ ...action, runOnSettle: true }] },
      { ...loaded, capabilities: { worktreesDirectory: true, cleanupRetention: true, runOnSettle: true }, location: '/spoofed-capability' },
    ];
    for (const raw of invalid) await assert.rejects(f.store.save('old', f.project, oldClient, raw), /Upgrade the server/);
    assert.equal(f.writes.length, 0);
    await f.store.save('old', f.project, oldClient, loaded);
    const patch = f.writes[0] as Record<string, unknown>;
    assert.equal(Object.hasOwn(patch, 'worktreesDirectory'), false);
    assert.ok(!JSON.stringify(patch).includes('worktreeKeepWhen'));
    assert.ok(!JSON.stringify(patch).includes('worktreeSettledAfterDays'));
  } finally { await f.close(); }
});
test('settled immediate and off roundtrip through native cleanup and settle actions retain async', async () => {
  const f = await fixture();
  try {
    const loaded = await f.store.load('scope', f.project, f.client);
    const current = await f.store.save('scope', f.project, f.client, { ...loaded, cleanup: { ...loaded.cleanup, enabled: true, settledDays: 0, keepLocalFiles: 'any' }, actions: [{ ...action, async: false, runOnSettle: true }] });
    assert.equal(current.cleanup.settledDays, 0); assert.equal(current.cleanup.enabled, true);
    assert.equal(current.actions[0]?.runOnSettle, true); assert.equal(current.actions[0]?.async, false);
    const disabled = await f.store.save('scope', f.project, f.client, { ...current, cleanup: { ...current.cleanup, enabled: false, settledDays: null } });
    assert.equal(disabled.cleanup.settledDays, null); assert.equal(disabled.cleanup.enabled, false);
    const localFile = (await readdir(join(f.storage, 'worktree-settings')))[0]!;
    assert.deepEqual(JSON.parse(await readFile(join(f.storage, 'worktree-settings', localFile), 'utf8')), { copyEnv: false });
  } finally { await f.close(); }
});
test('service save failure leaves extension-local settings and profile untouched', async () => {
  const f = await fixture();
  try {
    const loaded = await f.store.load('scope', f.project, f.client);
    const client = { ...f.client, updateSettings: async () => { throw new Error('service rejected'); } };
    await assert.rejects(f.store.save('scope', f.project, client, { ...loaded, copyEnv: true, environment: { ...loaded.environment, enabled: true } }), /service rejected/);
    assert.equal((await f.environment.getProfile('scope')).enabled, false);
    await assert.rejects(readdir(join(f.storage, 'worktree-settings')));
  } finally { await f.close(); }
});
