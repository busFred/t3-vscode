import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import * as Schema from 'effect/Schema';
import { ProjectId, ProjectScript, ServerSettings } from '@t3tools/contracts';
import { resolveProjectScripts } from '@t3tools/shared/projectScripts';
import { resolveProjectSettings, resolveWorktreeCleanup } from '@t3tools/shared/projectSettings';
import { parseT3ProjectFile } from '@t3tools/shared/t3ProjectFile';
import type { ProjectAction, WorktreeProjectSettings } from '../shared/worktrees';
import { DEFAULT_WORKTREE_ENVIRONMENT_PROFILE } from '../shared/worktreeEnvironment';
import { parseWorktreeEnvironmentProfile, type WorktreeEnvironmentManager } from './worktreeEnvironment';

export interface WorktreeSettingsProject { id: string; workspaceRoot: string; scripts: readonly unknown[] }
export interface WorktreeSettingsClient {
  getSettings?: () => Promise<unknown>;
  updateSettings?: (patch: unknown) => Promise<unknown>;
  readonly worktreeSettingsCapabilities?: { readonly worktreesDirectory: boolean; readonly cleanupRetention: boolean; readonly runOnSettle: boolean };
}
interface LocalSettings { copyEnv: boolean }
const defaults: LocalSettings = { copyEnv: false };
const keepWhen = { any: 'any-local-files', uncommitted: 'uncommitted-changes', tracked: 'tracked-changes' } as const;
const capabilities = (client: WorktreeSettingsClient) => ({ worktreesDirectory: client.worktreeSettingsCapabilities?.worktreesDirectory === true,
  cleanupRetention: client.worktreeSettingsCapabilities?.cleanupRetention === true, runOnSettle: client.worktreeSettingsCapabilities?.runOnSettle === true });
const MAX_FILE = 1024 * 1024;
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`Unknown ${label} field`);
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`);
  return value;
}
function string(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || value.includes('\0') || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}
function days(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3650) throw new Error(`${label} must be an integer from 0 to 3650`);
  return value;
}
function localSettings(input: unknown): LocalSettings {
  const value = object(input, 'local worktree settings');
  keys(value, ['copyEnv'], 'local worktree settings');
  return { copyEnv: boolean(value.copyEnv, 'copyEnv') };
}
function viewAction(script: typeof ProjectScript.Type): ProjectAction {
  return { id: script.id, name: script.name, command: script.command, icon: script.icon, runOnWorktreeCreate: script.runOnWorktreeCreate,
    ...(script.async === undefined ? {} : { async: script.async }), ...(script.runOnSettle === undefined ? {} : { runOnSettle: script.runOnSettle }) };
}
function actions(input: unknown): ProjectAction[] {
  if (!Array.isArray(input) || input.length > 50) throw new Error('Actions must contain at most 50 scripts');
  const ids = new Set<string>(); const names = new Set<string>(); let creation = 0;
  return input.map((raw) => {
    const value = object(raw, 'action');
    keys(value, ['id', 'name', 'command', 'icon', 'runOnWorktreeCreate', 'runOnSettle', 'async'], 'action');
    const id = string(value.id, 'action ID', 256).trim(); const name = string(value.name, 'action name', 256).trim();
    const command = string(value.command, 'action command', 32_768);
    if (!id || !name || !command.trim() || ids.has(id) || names.has(name)) throw new Error('Actions require unique IDs and names and nonempty commands');
    ids.add(id); names.add(name);
    const runOnWorktreeCreate = boolean(value.runOnWorktreeCreate, 'runOnWorktreeCreate');
    if (runOnWorktreeCreate && ++creation > 1) throw new Error('At most one action may run on worktree creation');
    if (value.async !== undefined) boolean(value.async, 'action async');
    if (value.runOnSettle !== undefined) boolean(value.runOnSettle, 'action runOnSettle');
    const result = { id, name, command, icon: value.icon, runOnWorktreeCreate, ...(value.async === undefined ? {} : { async: value.async }), ...(value.runOnSettle === undefined ? {} : { runOnSettle: value.runOnSettle }) };
    return viewAction(Schema.decodeUnknownSync(ProjectScript)(result));
  });
}
async function boundedRead(file: string): Promise<string> {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.size > MAX_FILE) throw new Error('Settings file must be a regular file of at most 1 MB');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Settings file must be a regular file of at most 1 MB');
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_FILE) throw new Error('Settings file exceeds 1 MB');
    return buffer.subarray(0, length).toString('utf8');
  } finally { await handle.close(); }
}
async function projectFile(root: string) {
  try {
    const decoded = parseT3ProjectFile(await boundedRead(join(root, 't3.json')));
    if (!decoded) throw new Error('t3.json does not match the T3 project-file schema');
    const fileActions = actions((decoded.scripts ?? []).map((script) => ({
      id: `file-${hash(`${script.name}\0${script.command}`).slice(0, 24)}`, name: script.name,
      command: script.command, icon: script.icon ?? 'play', runOnWorktreeCreate: script.runOnWorktreeCreate ?? false,
      ...(script.async === undefined ? {} : { async: script.async }), ...(script.runOnSettle === undefined ? {} : { runOnSettle: script.runOnSettle }),
    })));
    return { decoded, fileActions };
  } catch (error) {
    if (code(error) === 'ENOENT') return { decoded: null, fileActions: [] };
    return { decoded: null, fileActions: [], fileError: `Cannot import t3.json: ${error instanceof Error ? error.message.slice(0, 500) : 'invalid project file'}` };
  }
}

/** Native settings stay service-owned; only env-file copying and the Python profile are local. */
export class WorktreeSettingsStore {
  private readonly storageRoot: string;
  private readonly environmentManager: WorktreeEnvironmentManager;
  constructor(storageRoot: string, environmentManager: WorktreeEnvironmentManager) {
    this.storageRoot = storageRoot;
    this.environmentManager = environmentManager;
  }
  private file(scope: string, project: WorktreeSettingsProject) {
    if (!scope.trim() || scope.length > 4096 || scope.includes('\0') || !project.id || project.id.includes('\0') || !isAbsolute(project.workspaceRoot)) throw new Error('Invalid project settings scope');
    return join(resolve(this.storageRoot), 'worktree-settings', `${hash(`${scope}\0${project.id}`)}.json`);
  }
  private async local(scope: string, project: WorktreeSettingsProject): Promise<LocalSettings> {
    try { return localSettings(JSON.parse(await boundedRead(this.file(scope, project)))); }
    catch (error) { if (code(error) === 'ENOENT') return { ...defaults }; throw error; }
  }
  private async native(client: WorktreeSettingsClient) {
    if (!client.getSettings) throw new Error('This T3 server does not support project settings. Reconnect to a compatible server to edit worktree settings.');
    const snapshot = await client.getSettings();
    // RPC clients already decode duration fields; wire-shaped fakes/older adapters may not.
    try { return Schema.decodeUnknownSync(Schema.toType(ServerSettings))(snapshot); }
    catch { return Schema.decodeUnknownSync(ServerSettings)(snapshot); }
  }
  async load(scope: string, project: WorktreeSettingsProject, client: WorktreeSettingsClient): Promise<WorktreeProjectSettings> {
    this.file(scope, project);
    const [native, local, environment, file] = await Promise.all([this.native(client), this.local(scope, project), this.environmentManager.getProfile(scope), projectFile(project.workspaceRoot)]);
    const id = ProjectId.make(project.id);
    const effective = resolveProjectSettings(native, id, undefined, file.decoded).settings;
    const cleanup = resolveWorktreeCleanup(native, id);
    const settledDays = cleanup.worktreeSettledAfterDays ?? null;
    const enabled = settledDays !== null || cleanup.worktreeAfterDays !== null || cleanup.worktreeOnMerge || cleanup.worktreeOnDelete || cleanup.worktreeUnchanged;
    return { projectId: project.id, capabilities: capabilities(client), actions: resolveProjectScripts(native, { id, scripts: Schema.decodeUnknownSync(Schema.Array(ProjectScript))(project.scripts) }).map(viewAction), fileActions: file.fileActions,
      ...('fileError' in file ? { fileError: file.fileError } : {}), environment,
      startFromOrigin: effective.newWorktreesStartFromOrigin, branchPrefix: effective.branchNamePrefix,
      location: native.worktreesDirectory ?? '', copyEnv: local.copyEnv, submodules: effective.worktreeSubmodules,
      cleanup: { enabled, inactiveDays: cleanup.worktreeAfterDays ?? 0, merged: cleanup.worktreeOnMerge, unchanged: cleanup.worktreeUnchanged, settledDays, keepLocalFiles: cleanup.worktreeKeepWhen === 'any-local-files' ? 'any' : cleanup.worktreeKeepWhen === 'tracked-changes' ? 'tracked' : 'uncommitted' } };
  }
  async save(scope: string, project: WorktreeSettingsProject, client: WorktreeSettingsClient, raw: unknown): Promise<WorktreeProjectSettings> {
    const file = this.file(scope, project);
    const value = object(raw, 'worktree project settings');
    keys(value, ['projectId', 'capabilities', 'actions', 'fileActions', 'fileError', 'environment', 'startFromOrigin', 'branchPrefix', 'location', 'submodules', 'copyEnv', 'cleanup'], 'worktree project settings');
    if (value.projectId !== project.id) throw new Error('Settings belong to a different project');
    if (value.capabilities !== undefined) {
      const declared = object(value.capabilities, 'display capabilities');
      keys(declared, ['worktreesDirectory', 'cleanupRetention', 'runOnSettle'], 'display capabilities');
      for (const field of ['worktreesDirectory', 'cleanupRetention', 'runOnSettle']) boolean(declared[field], field);
    }
    if (value.fileActions !== undefined) actions(value.fileActions);
    if (value.fileError !== undefined) string(value.fileError, 'project file error', 1024);
    const nextActions = actions(value.actions);
    const rawEnvironment = object(value.environment, 'environment profile');
    keys(rawEnvironment, Object.keys(DEFAULT_WORKTREE_ENVIRONMENT_PROFILE), 'environment profile');
    const environment = parseWorktreeEnvironmentProfile(rawEnvironment);
    const startFromOrigin = boolean(value.startFromOrigin, 'startFromOrigin');
    const branchPrefix = string(value.branchPrefix, 'branch prefix', 256).trim();
    if (branchPrefix && (/[\x00-\x20\x7f~^:?*\[\\]/.test(branchPrefix) || branchPrefix.startsWith('-') || branchPrefix.includes('..') || branchPrefix.includes('@{') || branchPrefix.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')))) throw new Error('Invalid branch name prefix');
    if (!['recursive', 'top-level', 'none'].includes(String(value.submodules))) throw new Error('Invalid submodule mode');
    const cleanup = object(value.cleanup, 'cleanup policy');
    keys(cleanup, ['enabled', 'inactiveDays', 'settledDays', 'merged', 'unchanged', 'keepLocalFiles'], 'cleanup policy');
    const enabled = boolean(cleanup.enabled, 'cleanup enabled'); const inactiveDays = days(cleanup.inactiveDays, 'inactiveDays');
    const merged = boolean(cleanup.merged, 'cleanup merged'); const unchanged = boolean(cleanup.unchanged, 'cleanup unchanged');
    const location = string(value.location, 'worktree location').trim();
    if (/[\r\n]/.test(location)) throw new Error('Invalid worktree location');
    const settledDays = cleanup.settledDays === null ? null : days(cleanup.settledDays, 'settledDays');
    if (!Object.hasOwn(keepWhen, String(cleanup.keepLocalFiles))) throw new Error('Invalid local-file retention rule');
    const retention = cleanup.keepLocalFiles as keyof typeof keepWhen;
    const local = localSettings({ copyEnv: value.copyEnv });
    if (!client.updateSettings) throw new Error('This T3 server cannot save project settings. Reconnect to a compatible server.');
    const native = await this.native(client);
    const priorOverride = native.projectSettingsOverrides[ProjectId.make(project.id)] ?? {};
    const priorCleanup = resolveWorktreeCleanup(native, ProjectId.make(project.id));
    const support = capabilities(client);
    if (!support.worktreesDirectory && location !== (native.worktreesDirectory ?? '')) throw new Error('This T3 server does not support changing the worktrees directory. Upgrade the server.');
    if (!support.cleanupRetention && (settledDays !== (priorCleanup.worktreeSettledAfterDays ?? null) || keepWhen[retention] !== (priorCleanup.worktreeKeepWhen ?? 'uncommitted-changes'))) throw new Error('This T3 server does not support settled retention or local-file cleanup guards. Upgrade the server.');
    const priorScripts = resolveProjectScripts(native, { id: ProjectId.make(project.id), scripts: Schema.decodeUnknownSync(Schema.Array(ProjectScript))(project.scripts) });
    if (!support.runOnSettle && nextActions.some((action) => (action.runOnSettle ?? false) !== (priorScripts.find((script) => script.id === action.id)?.runOnSettle ?? false))) throw new Error('This T3 server does not support settle actions. Upgrade the server.');
    // Keep desktop-only preview metadata when editing an existing service action.
    const defaultProjectScripts = nextActions.map((action) => ({ ...priorScripts.find((script) => script.id === action.id), ...action }));
    await client.updateSettings({ ...(support.worktreesDirectory ? { worktreesDirectory: location } : {}), projectSettingsOverrides: { [project.id]: { ...priorOverride, defaultProjectScripts,
      newWorktreesStartFromOrigin: startFromOrigin, worktreeSubmodules: value.submodules, branchNamePrefix: branchPrefix,
      worktreeCleanup: enabled ? { mode: 'custom', rules: { ...(support.cleanupRetention ? { worktreeKeepWhen: keepWhen[retention], worktreeSettledAfterDays: settledDays } : {}), worktreeAfterDays: inactiveDays || null, worktreeOnMerge: merged, worktreeOnDelete: priorCleanup.worktreeOnDelete, worktreeUnchanged: unchanged } } : { mode: 'off' },
    } } });
    await this.environmentManager.saveProfile(scope, environment);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(local), { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
    return this.load(scope, project, client);
  }
}
