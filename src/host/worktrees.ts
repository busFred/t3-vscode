import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { checkoutForWorkingDirectory } from "../shared/worktreeGroups.js";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rename, stat, rm, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, relative, sep } from "node:path";
import type { ProjectSummary, ThreadSummary } from "../shared/bridge.js";
import type { WorktreeChoice, WorktreeSummary, WorktreePreparation, WorktreesState, WorktreeProjectSettings, WorktreeReview } from "../shared/worktrees.js";
import type { T3Client } from "./t3Client.js";
import { WorktreeEnvironmentManager, runEnvironmentCommand, sanitizeEnvironmentDiagnostic, acquireWorktreeLease, type EnvironmentRunner } from "./worktreeEnvironment.js";
import { WorktreeSettingsStore, type WorktreeSettingsProject } from "./worktreeSettings.js";
import { repositoryIdentity, listLocalWorktrees, worktreeChanges, applyWorktreeFiles, copyWorktreeConfig, restoreCheckout, readWorktreeStatus, readWorktreeDiffFile, worktreeCleanupIdentity, worktreeRemovalConfirmed, patchNumstat, type LocalWorktree } from "./worktreeGit.js";
import { MergeRecordStore, parsePatchNumstat, resolveThreadForCheckout, type MergeRecord } from "./mergeRecords.js";

export type WorktreeTransport = Pick<T3Client, "listRefs" | "createWorktree" | "removeWorktree" | "preparePullRequest" | "getSettings" | "updateSettings" | "gitAction"> & { readonly worktreeSettingsCapabilities?: { readonly worktreesDirectory: boolean; readonly cleanupRetention: boolean; readonly runOnSettle: boolean } };
interface Project extends ProjectSummary { scripts: WorktreeSettingsProject["scripts"] }
export interface WorktreeHandoff { copyEdits: boolean; baseRef: string; files: readonly string[] }
export interface WorktreePreparationMetadata { groupId?: string; title?: string; handoff?: WorktreeHandoff }
export interface WorktreeCoordinatorOptions {
  storageRoot: string;
  client: Partial<WorktreeTransport>;
  scope: () => string;
  projects: () => ReadonlyArray<Project>;
  threads: () => ReadonlyArray<ThreadSummary>;
  windowRoots: () => ReadonlyArray<string>;
  changed: () => void;
  assertTrusted: () => Promise<void>;
  runner?: EnvironmentRunner;
  environmentManager?: WorktreeEnvironmentManager;
}
interface Attempt {
  version: 1;
  service: string;
  projectRoot: string;
  preparation: WorktreePreparation;
  choice: WorktreeChoice;
  branch: string;
  path: string | null;
  created: boolean;
  creationAttempted: boolean;
  setupComplete: boolean;
  completed: boolean;
  owner?: { pid: number; token: string };
  handoff?: WorktreeHandoff;
}
const activeCoordinators = new Set<string>();
type BindCheckout = (path: string | null, branch: string | null) => Promise<void>;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const key = (text: string) => createHash("sha256").update(text).digest("hex");
function parseHandoff(input: unknown): WorktreeHandoff {
  const value = input as WorktreeHandoff;
  if (!value || typeof value.copyEdits !== "boolean" || typeof value.baseRef !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(value.baseRef)
    || !Array.isArray(value.files) || value.files.length > 1000 || value.files.some(file => typeof file !== "string" || !file || file.includes("\0") || file.includes("\\") || isAbsolute(file) || file.split("/").some(part => part === ".." || part === "."))
    || Buffer.byteLength(JSON.stringify(value)) > 96 * 1024) throw new Error("Invalid retained conversation handoff");
  return { copyEdits: value.copyEdits, baseRef: value.baseRef, files: [...value.files] };
}
/** A narrow local Git invocation; ambient routing cannot select another repository. */
async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_") && k !== "GIT_TERMINAL_PROMPT") delete (env as Record<string, string | undefined>)[k];
  return new Promise((ok, fail) => execFile("git", ["--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], { cwd, env, signal, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => error ? fail(new Error(stderr.trim() || error.message)) : ok(stdout.trim())));
}
export function parseWorktreeChoice(raw: unknown): WorktreeChoice {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Choose a workspace for the conversation.");
  const o = raw as Record<string, unknown>;
  if (!["root", "new", "existing", "branch", "pr"].includes(String(o.type))) throw new Error("Invalid workspace choice.");
  for (const k of ["path", "branch", "baseRef", "reference"] as const) if (o[k] !== undefined && (typeof o[k] !== "string" || o[k].length > 4096 || o[k].includes("\0"))) throw new Error(`Invalid ${k}.`);
  for (const k of ["copyEnv", "startFromOrigin"] as const) if (o[k] !== undefined && typeof o[k] !== "boolean") throw new Error(`Invalid ${k}.`);
  if (o.type === "existing" && (typeof o.path !== "string" || !isAbsolute(o.path))) throw new Error("Choose an existing checkout.");
  if (o.type === "branch" && (typeof o.branch !== "string" || !o.branch.trim())) throw new Error("Choose an existing branch.");
  if (o.type === "pr" && (typeof o.reference !== "string" || !/^\d+$|^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(o.reference))) throw new Error("Enter a GitHub pull request number or URL.");
  for (const ref of [o.branch, o.baseRef]) if (typeof ref === "string" && ref && (ref.startsWith("-") || /[\s~^:?*\[\\]/.test(ref) || ref.includes("..") || ref.endsWith("/") || ref.endsWith(".lock"))) throw new Error("Use a valid Git branch or base reference.");
  if (o.runs !== undefined) {
    if (o.type !== "new" || !Array.isArray(o.runs) || o.runs.length > 4 || !o.runs.length) throw new Error("Parallel runs require new worktrees.");
    let total = 0;
    for (const run of o.runs) {
      if (!run || !Number.isInteger(run.count) || run.count < 1 || !run.modelSelection || typeof run.modelSelection.model !== "string" || typeof run.modelSelection.instanceId !== "string") throw new Error("Invalid model allocation.");
      total += run.count;
    }
    if (total > 4) throw new Error("Choose at most four parallel runs.");
  }
  return { type: o.type as WorktreeChoice["type"], ...(o.path ? { path: o.path as string } : {}), ...(o.branch ? { branch: o.branch as string } : {}), ...(o.baseRef ? { baseRef: o.baseRef as string } : {}), ...(o.reference ? { reference: o.reference as string } : {}), ...(o.copyEnv !== undefined ? { copyEnv: o.copyEnv as boolean } : {}), ...(o.startFromOrigin !== undefined ? { startFromOrigin: o.startFromOrigin as boolean } : {}), ...(o.runs ? { runs: o.runs as NonNullable<WorktreeChoice["runs"]> } : {}) };
}
export class WorktreeCoordinator {
  readonly environments: WorktreeEnvironmentManager;
  private readonly settingsStore: WorktreeSettingsStore;
  private value: WorktreesState = { loading: false, items: [], settings: [], branches: [], preparations: [] };
  private refreshJob: Promise<void> | null = null;
  private refreshScope = "";
  private cleanupJob: Promise<void> | null = null;
  private readonly jobs = new Map<string, AbortController>();
  private readonly bindings = new Map<string, BindCheckout>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly runner: EnvironmentRunner;
  private readonly options: WorktreeCoordinatorOptions;
  private hydratedScope: string | null = null;
  private hydration: Promise<void> | null = null;
  private persistence: Promise<void> = Promise.resolve();
  private readonly imported = new Set<string>();
  private readonly instance = randomUUID();
  private disposed = false;
  private timestamp = 0;
  readonly merges: MergeRecordStore;
  private nextTimestamp() { this.timestamp = Math.max(Date.now(), this.timestamp + 1); return this.timestamp; }
  private orderedAttempts() { return [...this.attempts.values()].sort((a, b) => (a.preparation.updatedAt ?? 0) - (b.preparation.updatedAt ?? 0) || a.preparation.id.localeCompare(b.preparation.id)); }
  constructor(options: WorktreeCoordinatorOptions) {
    this.options = options;
    activeCoordinators.add(this.instance);
    this.runner = options.runner ?? runEnvironmentCommand;
    this.environments = options.environmentManager ?? new WorktreeEnvironmentManager(join(options.storageRoot, "python"), { runner: this.runner });
    this.settingsStore = new WorktreeSettingsStore(options.storageRoot, this.environments);
    this.merges = new MergeRecordStore(options.storageRoot);
  }
  scope(projectId: string) { return `${this.options.scope()}:${projectId}`; }
  private project(id: string): Project {
    const project = this.options.projects().find(p => p.id === id);
    if (!project) throw new Error("Project is not available in this window.");
    return project;
  }
  snapshot(): WorktreesState {
    const threads = this.options.threads();
    if (this.hydratedScope !== null && this.hydratedScope !== this.options.scope()) return { loading: true, items: [], settings: [], branches: [], preparations: [] };
    const canonical = this.canonicalPaths();
    const projects = new Map(this.options.projects().map(project => [project.id, project.workspaceRoot]));
    const membership = new Map<string, ThreadSummary[]>();
    const paths = [...new Set(this.value.items.map(item => item.path))];
    const opened = new Set(this.options.windowRoots().map(root => checkoutForWorkingDirectory(canonical(root), paths)));
    for (const thread of threads) {
      const cwd = thread.worktreePath ?? projects.get(thread.projectId);
      if (!cwd) continue;
      const checkout = checkoutForWorkingDirectory(canonical(cwd), this.value.items.filter(item => item.projectId === thread.projectId).map(item => item.path));
      if (!checkout) continue;
      const key = `${thread.projectId}:${checkout}`;
      membership.set(key, [...membership.get(key) ?? [], thread]);
    }
    return { ...this.value, items: this.value.items.map(w => {
      const matches = membership.get(`${w.projectId}:${w.path}`) ?? [];
      return { ...w, threadIds: matches.map(t => t.id), active: matches.some(t => t.activeRunId !== null), openInWindow: opened.has(w.path) };
    }) };
  }
  async refresh(): Promise<void> {
    const service = this.options.scope();
    if (this.refreshJob && this.refreshScope === service) return this.refreshJob;
    this.refreshScope = service;
    const job = this.hydrate(service).then(() => this.mergeHistory(service)).then(() => this.load(service)).finally(() => { if (this.refreshJob === job) this.refreshJob = null; });
    this.refreshJob = job;
    return this.refreshJob;
  }
  private async load(service: string): Promise<void> {
    if (this.options.scope() !== service) return;
    this.value = { ...this.value, loading: true }; this.options.changed();
    const items: WorktreeSummary[] = [], settings: WorktreeProjectSettings[] = [], branches: WorktreesState["branches"][number][] = [], errors: string[] = [];
    for (const project of this.options.projects()) {
      try { settings.push(await this.settingsStore.load(`${service}:${project.id}`, project, this.options.client)); } catch (e) { errors.push(errorText(e)); }
      const identity = await repositoryIdentity(project.workspaceRoot);
      if (!identity) continue;
      try {
        const local = await listLocalWorktrees(project.workspaceRoot);
        const projectCheckoutPath = checkoutForWorkingDirectory(await realpath(project.workspaceRoot), local.map(tree => tree.path));
        for (const thread of this.options.threads().filter(t => t.projectId === project.id && t.worktreePath)) if (!local.some(w => resolve(w.path) === resolve(thread.worktreePath!))) local.push({ path: thread.worktreePath!, branch: thread.branch ?? "", root: false, missing: true, locked: false });
        // Deleted T3 threads/Git entries must not hide an environment that still needs cleanup.
        const environments = await this.environments.list(`${service}:${project.id}`, project.workspaceRoot).catch(cause => { errors.push(errorText(cause)); return []; });
        for (const environment of environments) {
          if (environment.status !== "removed" && !local.some(w => w.path === environment.worktreePath)) local.push({ path: environment.worktreePath,
            branch: this.orderedAttempts().find(a => a.path === environment.worktreePath)?.branch ?? "", root: false, missing: true, locked: false });
        }
        for (const tree of local) {
          const environment = tree.root ? null : await this.environments.get(`${service}:${project.id}`, tree.path).catch(() => null);
          const description = environment?.status === "ready" ? this.environments.describe(environment) : null;
          items.push({ ...tree, id: `${project.id}:${tree.path}`, projectId: project.id, repositoryId: identity.commonDir, projectRoot: project.workspaceRoot,
            ...(projectCheckoutPath ? { projectCheckoutPath } : {}), imported: this.imported.has(tree.path), environment, threadIds: [], active: false,
            ...(description ? { environmentCommand: description.terminalCommand, environmentInstructions: description.agentInstructions } : {}) });
        }
        if (this.options.client.listRefs) {
          let cursor: number | undefined;
          for (let page = 0; page < 20; page++) {
            const result = await this.options.client.listRefs({ cwd: project.workspaceRoot, refKind: "all", limit: 200, ...(cursor === undefined ? {} : { cursor }) });
            for (const ref of result.refs) branches.push({ projectId: project.id, name: ref.name, path: ref.worktreePath, remote: ref.isRemote ?? false });
            if (result.nextCursor === null || result.nextCursor === undefined) break;
            cursor = result.nextCursor;
          }
        }
      } catch (e) { errors.push(`${project.title}: ${errorText(e)}`); }
    }
    if (this.options.scope() !== service) return;
    const { error: _oldError, ...current } = this.value;
    this.value = { ...current, loading: false, items, settings, branches, ...(errors.length ? { error: [...new Set(errors)].join("\n") } : {}) };
    this.options.changed();
  }
  async saveSettings(projectId: string, raw: unknown) {
    await this.options.assertTrusted();
    await this.settingsStore.save(this.scope(projectId), this.project(projectId), this.options.client, raw);
    await this.refresh();
  }
  async settings(projectId: string) { return this.settingsStore.load(this.scope(projectId), this.project(projectId), this.options.client); }
  /** Invoked only by the Worktrees page opening or its explicit Refresh action. */
  async cleanupMissingEnvironments(now = Date.now()): Promise<void> {
    if (this.cleanupJob) return this.cleanupJob;
    const job = this.reconcileEnvironments(now).finally(() => { if (this.cleanupJob === job) this.cleanupJob = null; });
    this.cleanupJob = job;
    return job;
  }
  private async reconcileEnvironments(now: number): Promise<void> {
    const service = this.options.scope(), errors: string[] = [];
    await this.options.assertTrusted();
    for (const project of this.options.projects()) {
      const projectRoot = project.workspaceRoot;
      const check = () => {
        if (this.disposed || this.options.scope() !== service || this.options.projects().find(p => p.id === project.id)?.workspaceRoot !== projectRoot) throw new Error("The project or service changed during environment cleanup");
      };
      check();
      const scope = `${service}:${project.id}`;
      const records = await this.environments.list(scope, projectRoot).catch(cause => { errors.push(errorText(cause)); return []; }); check();
      for (const record of records) {
        if (record.status === "removed") continue;
        let release: (() => Promise<void>) | undefined;
        try {
          check();
          release = await acquireWorktreeLease(this.options.storageRoot, `checkout:${record.worktreePath}`);
          const busy = () => this.checkoutOpenInWindow(record.worktreePath)
            || this.checkoutBusy(record.worktreePath)
            || [...this.attempts.values()].some(a => a.path === record.worktreePath && this.jobs.has(a.preparation.id));
          const safe = async () => {
            check(); await this.options.assertTrusted(); check();
            if (busy()) return false;
            const removed = await worktreeRemovalConfirmed(projectRoot, record.worktreePath, record.checkoutIdentity);
            await this.options.assertTrusted(); check(); return removed && !busy();
          };
          await this.environments.reconcile({ scope, projectRoot, worktreePath: record.worktreePath, now, assertCleanupSafe: safe });
        } catch (cause) { errors.push(errorText(cause)); }
        finally { if (release) await release(); }
        check();
      }
    }
    await this.refresh();
    if (errors.length && this.options.scope() === service) {
      this.value = { ...this.value, error: [this.value.error, ...new Set(errors)].filter(Boolean).join("\n") }; this.options.changed();
    }
  }
  private progress(id: string, patch: Partial<WorktreePreparation>) {
    const attempt = this.attempts.get(id);
    if (this.disposed || !attempt || attempt.service !== this.options.scope()) return;
    const { error: _previousError, ...withoutError } = attempt.preparation;
    const previous = patch.phase === "running" || patch.phase === "ready" ? withoutError : attempt.preparation;
    attempt.preparation = { ...previous, ...patch, updatedAt: this.nextTimestamp(), ...(patch.error ? { error: sanitizeEnvironmentDiagnostic(patch.error) } : {}), ...(patch.log ? { log: sanitizeEnvironmentDiagnostic(patch.log) } : {}) };
    this.value = { ...this.value, preparations: this.orderedAttempts().filter(a => a.service === attempt.service).map(a => a.preparation).slice(-40) }; this.options.changed();
  }
  private attemptsDirectory(service: string) { return join(this.options.storageRoot, "worktree-preparations", key(service)); }
  private async persist(service: string, attempt: Attempt): Promise<void> {
    if (this.disposed || this.options.scope() !== service) return;
    const payload = JSON.stringify(attempt);
    const file = join(this.attemptsDirectory(service), `${attempt.preparation.id}.json`);
    const operation = this.persistence.catch(() => {}).then(async () => {
      await mkdir(this.attemptsDirectory(service), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, payload, { mode: 0o600, flag: "wx" }); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }); }
    });
    this.persistence = operation;
    await operation;
  }
  private async hydrate(service: string): Promise<void> {
    if (this.hydratedScope === service) { await this.hydration; return; }
    for (const job of this.jobs.values()) job.abort();
    this.jobs.clear(); this.attempts.clear(); this.bindings.clear(); this.imported.clear();
    this.hydratedScope = service;
    this.value = { loading: false, items: [], settings: [], branches: [], preparations: [] };
    this.hydration = (async () => {
      await this.mergeHistory(service);
    })();
    await this.hydration;
  }
  private async mergeHistory(service: string): Promise<void> {
      let files: string[];
      try { files = (await readdir(this.attemptsDirectory(service))).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (this.options.scope() !== service) return;
      for (const name of files) {
        const file = join(this.attemptsDirectory(service), name);
        if ((await stat(file)).size > 128 * 1024) throw new Error("Preparation record exceeds its size limit");
        const raw: unknown = JSON.parse(await readFile(file, "utf8"));
        const attempt = raw as Attempt;
        if (!attempt || attempt.version !== 1 || attempt.service !== service || typeof attempt.projectRoot !== "string" || !isAbsolute(attempt.projectRoot)
          || !attempt.preparation || typeof attempt.preparation.id !== "string" || typeof attempt.preparation.projectId !== "string"
          || attempt.preparation.id !== name.slice(0, -5)
          || (attempt.preparation.threadId !== undefined && typeof attempt.preparation.threadId !== "string")
          || typeof attempt.branch !== "string" || (attempt.path !== null && (typeof attempt.path !== "string" || !isAbsolute(attempt.path)))
          || !["created", "creationAttempted", "setupComplete", "completed"].every(k => typeof (attempt as unknown as Record<string, unknown>)[k] === "boolean")
          || !["running", "ready", "failed", "cancelled"].includes(attempt.preparation.phase)) throw new Error("Invalid preparation history");
        attempt.choice = parseWorktreeChoice(attempt.choice);
        if (attempt.handoff !== undefined) attempt.handoff = parseHandoff(attempt.handoff);
        if (attempt.preparation.updatedAt !== undefined && (!Number.isSafeInteger(attempt.preparation.updatedAt) || attempt.preparation.updatedAt < 0)) throw new Error("Invalid preparation timestamp");
        if (attempt.preparation.updatedAt === undefined) attempt.preparation = { ...attempt.preparation, updatedAt: Math.trunc((await stat(file)).mtimeMs) };
        this.timestamp = Math.max(this.timestamp, attempt.preparation.updatedAt ?? 0);
        if (this.options.scope() !== service) return;
        if (this.jobs.has(attempt.preparation.id)) continue;
        if (attempt.preparation.phase === "running" && !this.ownerAlive(attempt)) attempt.preparation = { ...attempt.preparation, phase: "failed", stage: "Agent waiting", error: "Preparation was interrupted. Retry the retained checkout." };
        if (attempt.preparation.backgroundRunning && !this.ownerAlive(attempt)) attempt.preparation = { ...attempt.preparation, backgroundRunning: false, phase: "failed", stage: "Background setup interrupted", error: "Background setup was interrupted. Retry it explicitly if needed." };
        this.attempts.set(attempt.preparation.id, attempt);
      }
      this.value = { ...this.value, preparations: this.orderedAttempts().map(a => a.preparation).slice(-40) };
  }
  private ownerAlive(attempt: Attempt): boolean {
    if (!attempt.owner || !Number.isInteger(attempt.owner.pid) || typeof attempt.owner.token !== "string") return false;
    if (attempt.owner.pid === process.pid) return activeCoordinators.has(attempt.owner.token);
    try { process.kill(attempt.owner.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  }
  async requireCheckout(projectId: string, path: string, allowMissing = false) {
    if (!isAbsolute(path) || path.includes("\0")) throw new Error("Checkout must be an absolute path");
    const project = this.project(projectId);
    const local = await listLocalWorktrees(project.workspaceRoot);
    let tree = local.find(w => resolve(w.path) === resolve(path));
    if (!tree && allowMissing) {
      const attempt = [...this.attempts.values()].find(a => a.service === this.options.scope() && a.preparation.projectId === projectId && a.projectRoot === project.workspaceRoot && a.path && resolve(a.path) === resolve(path));
      const thread = this.options.threads().find(t => t.projectId === projectId && t.worktreePath && resolve(t.worktreePath) === resolve(path));
      const branch = attempt?.branch || thread?.branch;
      if (branch) tree = { path: resolve(path), branch, root: false, missing: true, locked: false };
    }
    if (!tree || (tree.missing && !allowMissing)) throw new Error("Refresh worktrees: this checkout is not available in the selected project.");
    return { project, tree };
  }
  async prepare(projectId: string, threadId: string, raw: WorktreeChoice, onCheckout: BindCheckout, group: WorktreePreparationMetadata = {}): Promise<{ path: string; branch: string; instructions?: string }> {
    await this.options.assertTrusted();
    const service = this.options.scope();
    await this.hydrate(service);
    await this.mergeHistory(service);
    const project = this.project(projectId);
    const choice = parseWorktreeChoice(raw);
    if (choice.type === "root") { await onCheckout(null, null); return { path: project.workspaceRoot, branch: "" }; }
    if (choice.type === "existing") {
      const { tree } = await this.requireCheckout(projectId, choice.path!);
      // A T3 project may itself point to a linked checkout. Its actual Git main
      // checkout remains a valid conversation destination, without worktree setup.
      if (tree.root) {
        await onCheckout(resolve(tree.path) === resolve(project.workspaceRoot) ? null : tree.path, tree.branch || null);
        return { path: tree.path, branch: tree.branch };
      }
    }
    const backgroundCheckout = choice.type === "existing" ? this.orderedAttempts().filter(a => a.preparation.projectId === projectId && a.path === choice.path).at(-1) : undefined;
    if (backgroundCheckout?.preparation.backgroundRunning && backgroundCheckout.preparation.phase === "ready" && this.ownerAlive(backgroundCheckout)) {
      const { tree } = await this.requireCheckout(projectId, choice.path!);
      if (tree.root) throw new Error("The main checkout cannot be prepared as a worktree");
      const settings = await this.settings(projectId);
      if (this.options.scope() !== service) throw new Error("The connected service changed during preparation");
      if (settings.environment.enabled) {
        const existing = await this.environments.get(`${service}:${projectId}`, tree.path);
        if (existing?.status !== "ready" || JSON.stringify({ ...existing.profile, autoCleanup: settings.environment.autoCleanup }) !== JSON.stringify(settings.environment)) throw new Error("Wait for background setup before repairing or reconfiguring its Python environment");
      }
      const environment = settings.environment.enabled ? await this.environments.prepare({ scope: `${service}:${projectId}`, projectRoot: project.workspaceRoot, worktreePath: tree.path,
        checkoutIdentity: await worktreeCleanupIdentity(project.workspaceRoot, tree.path) }) : null;
      if (this.options.scope() !== service) throw new Error("The connected service changed during preparation");
      await onCheckout(tree.path, tree.branch);
      return { path: tree.path, branch: tree.branch, ...(environment ? { instructions: this.environments.describe(environment).agentInstructions } : {}) };
    }
    const handoff = group.handoff === undefined ? undefined : parseHandoff(group.handoff);
    const latest = this.orderedAttempts().filter(a => a.service === service && a.preparation.projectId === projectId && a.preparation.threadId === threadId
      && (choice.type !== "existing" || a.path === choice.path)).at(-1);
    const retained = latest?.preparation.phase !== "ready" && !latest?.preparation.background ? latest : undefined;
    if (retained) {
      if (handoff && JSON.stringify(handoff) !== JSON.stringify(retained.handoff)) throw new Error("Retry the retained conversation handoff before starting another");
      this.bindings.set(retained.preparation.id, onCheckout); return this.execute(retained);
    }
    const id = randomUUID();
    const branch = choice.branch || "";
    const attempt: Attempt = { version: 1, service, projectRoot: project.workspaceRoot,
      preparation: { id, projectId, threadId, phase: "running", stage: "Creating checkout", log: "", updatedAt: this.nextTimestamp(), ...(group.groupId ? { groupId: group.groupId } : {}), ...(group.title ? { title: group.title } : {}) }, choice, branch,
      path: choice.type === "existing" ? choice.path! : null, created: false, creationAttempted: false, setupComplete: false, completed: false, ...(handoff ? { handoff } : {}) };
    if (this.options.scope() !== service) throw new Error("The connected service changed during preparation");
    this.attempts.set(id, attempt); this.bindings.set(id, onCheckout);
    await this.persist(service, attempt);
    return this.execute(attempt);
  }
  async prepareCheckout(projectId: string, path: string) {
    await this.options.assertTrusted();
    await this.hydrate(this.options.scope());
    await this.mergeHistory(this.options.scope());
    const { tree } = await this.requireCheckout(projectId, path);
    if (tree.root) throw new Error("The main checkout cannot be prepared as a worktree");
    const restored = this.orderedAttempts().filter(a => a.preparation.projectId === projectId && a.path === path).at(-1);
    if (restored && restored.created && !restored.completed && restored.preparation.phase !== "ready") return this.execute(restored, false);
    return this.prepare(projectId, `checkout:${path}`, { type: "existing", path }, async () => {});
  }
  private async execute(attempt: Attempt, bindCheckout = true): Promise<{ path: string; branch: string; instructions?: string }> {
    const { preparation, service } = attempt;
    const id = preparation.id;
    await this.options.assertTrusted();
    if (this.jobs.has(id)) throw new Error("This checkout is already being prepared");
    const releaseAttempt = await acquireWorktreeLease(this.options.storageRoot, `attempt:${service}:${id}`);
    try {
      await this.mergeHistory(service);
      const latest = this.attempts.get(id);
      if (latest) Object.assign(attempt, latest);
      this.attempts.set(id, attempt);
    } catch (error) { await releaseAttempt(); throw error; }
    attempt.owner = { pid: process.pid, token: this.instance };
    const abort = new AbortController(); this.jobs.set(id, abort);
    const check = () => {
      abort.signal.throwIfAborted();
      if (this.options.scope() !== service) { abort.abort(); throw new Error("The connected service changed during preparation"); }
      if (this.project(preparation.projectId).workspaceRoot !== attempt.projectRoot) throw new Error("The project checkout changed during preparation");
    };
    let background = false;
    let backgroundFinished = false;
    let mainFinished = false;
    let releaseCheckout: (() => Promise<void>) | undefined;
    let releasing: Promise<void> | undefined;
    const releaseWhenFinished = () => {
      if (!mainFinished || (background && !backgroundFinished)) return Promise.resolve();
      releasing ??= (async () => { await releaseCheckout?.(); await releaseAttempt(); })();
      return releasing;
    };
    let backgroundError: unknown;
    const save = () => this.persist(service, attempt);
    this.progress(id, { phase: "running", background: false, backgroundRunning: false, stage: attempt.path ? "Preparing checkout" : "Creating checkout" });
    try {
      check();
      const project = this.project(preparation.projectId);
      const settings = await this.settingsStore.load(`${service}:${project.id}`, project, this.options.client);
      check();
      if (attempt.choice.type === "new" && !attempt.branch) {
        attempt.branch = `${settings.branchPrefix ? settings.branchPrefix.replace(/\/$/, "") + "/" : ""}work-${id.slice(0, 16)}`;
        await save();
      }
      if (!attempt.path) {
        if (attempt.choice.type === "pr") {
          if (!this.options.client.preparePullRequest) throw new Error("Update T3 Code to import pull request worktrees");
          const existing = await listLocalWorktrees(project.workspaceRoot);
          attempt.creationAttempted = true; await save(); check();
          // Native PR import reuses its stable local PR branch/checkouts. Omit threadId so the service does not launch setup itself.
          const imported = await this.options.client.preparePullRequest({ cwd: project.workspaceRoot, reference: attempt.choice.reference, mode: "worktree" });
          if (!imported.worktreePath) throw new Error("T3 did not return a pull request checkout");
          attempt.path = imported.worktreePath; attempt.branch = imported.branch;
          attempt.created = !existing.some(w => resolve(w.path) === resolve(attempt.path!)); this.imported.add(attempt.path);
          await save();
        } else {
          const local = await listLocalWorktrees(project.workspaceRoot);
          const found = local.find(w => w.branch === attempt.branch && !w.missing);
          if (found) {
            if (attempt.choice.type === "new" && !attempt.creationAttempted) throw new Error("The proposed branch already exists; choose a new branch");
            attempt.path = found.path;
            attempt.created = attempt.creationAttempted;
          } else {
            if (!this.options.client.createWorktree) throw new Error("Update T3 Code to create worktrees");
            const defaultBase = await git(project.workspaceRoot, ["show-ref", "--verify", "refs/heads/main"]).then(() => "main", () => "HEAD");
            let base = attempt.choice.type === "branch" ? attempt.branch : attempt.choice.baseRef || defaultBase;
            if (attempt.choice.type === "new" && (attempt.choice.startFromOrigin ?? settings.startFromOrigin)
              && (await git(project.workspaceRoot, ["remote"])).split("\n").includes("origin")) {
              this.progress(id, { stage: "Fetching origin" });
              await git(project.workspaceRoot, ["fetch", "origin", base], abort.signal);
              base = await git(project.workspaceRoot, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], abort.signal);
            }
            const branchExists = await git(project.workspaceRoot, ["show-ref", "--verify", `refs/heads/${attempt.branch}`]).then(() => true, () => false);
            if (branchExists && attempt.choice.type === "new" && !attempt.creationAttempted) throw new Error("The proposed branch already exists; choose a new branch");
            attempt.creationAttempted = true; await save(); check();
            const result = await this.options.client.createWorktree({ cwd: project.workspaceRoot, refName: branchExists ? attempt.branch : base,
              ...(attempt.choice.type === "new" && !branchExists ? { newRefName: attempt.branch } : {}), path: null });
            attempt.path = result.worktree.path; attempt.branch = result.worktree.refName; attempt.created = true;
            await save();
          }
        }
      }
      if (!attempt.path) throw new Error("No checkout was created");
      check();
      const { tree } = await this.requireCheckout(preparation.projectId, attempt.path);
      if (tree.root) throw new Error("The main checkout cannot be prepared as a worktree");
      releaseCheckout = await acquireWorktreeLease(this.options.storageRoot, `checkout:${await realpath(attempt.path)}`, abort.signal);
      attempt.branch = tree.branch;
      const bind = this.bindings.get(id);
      if (bindCheckout && bind) await bind(attempt.path, attempt.branch);
      else if (bindCheckout && !preparation.threadId?.startsWith("checkout:")) {
        const thread = this.options.threads().find(t => t.id === preparation.threadId && t.projectId === preparation.projectId);
        if (!thread || !thread.worktreePath || resolve(thread.worktreePath) !== resolve(attempt.path)) throw new Error("Reopen the retained conversation and prepare this checkout to restore its binding");
      }
      this.progress(id, { path: attempt.path, branch: attempt.branch, stage: "Preparing checkout" }); await save(); check();
      // These operations are idempotent, and rerun after a partial failure or reload.
      if (attempt.created && !attempt.completed && settings.submodules !== "none") await git(attempt.path, ["submodule", "update", "--init", ...(settings.submodules === "recursive" ? ["--recursive"] : [])], abort.signal);
      check();
      if (attempt.created && !attempt.completed && (attempt.choice.copyEnv ?? settings.copyEnv)) await copyWorktreeConfig(project.workspaceRoot, attempt.path);
      check();
      const checkoutIdentity = settings.environment.enabled ? await worktreeCleanupIdentity(project.workspaceRoot, attempt.path) : undefined;
      let environment = settings.environment.enabled ? await this.environments.prepare({ scope: `${service}:${project.id}`, projectRoot: project.workspaceRoot,
        worktreePath: attempt.path, ...(checkoutIdentity ? { checkoutIdentity } : {}), signal: abort.signal, onProgress: p => this.progress(id, { stage: p.message }) }) : null;
      check();
      const setup = settings.actions.find(a => a.runOnWorktreeCreate);
      if (setup && attempt.created && !attempt.setupComplete) {
        await this.options.assertTrusted(); check();
        this.progress(id, { stage: `Setup: ${setup.name}` });
        const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
        const args = process.platform === "win32" ? ["/d", "/s", "/c", setup.command] : ["-c", setup.command];
        const command = environment ? this.environments.describe(environment, shell, args) : { executable: shell, args, cwd: attempt.path };
        const pending = this.runner({ ...command, env: { T3CODE_PROJECT_ROOT: project.workspaceRoot, T3CODE_WORKTREE_PATH: attempt.path } }, abort.signal);
        if (setup.async !== false) {
          // Native actions default to asynchronous. Python is ready before the action is launched.
          background = true; attempt.setupComplete = true;
          this.progress(id, { background: true, backgroundRunning: true });
          void pending.then(async (output) => {
            this.progress(id, { backgroundRunning: false, stage: "Ready", log: `${output.stdout}\n${output.stderr}` }); await save();
          }, async (error: unknown) => {
            backgroundError = error;
            attempt.setupComplete = false;
            this.progress(id, { backgroundRunning: false, phase: abort.signal.aborted ? "cancelled" : "failed", stage: "Setup action stopped", error: errorText(error) });
            await save();
          }).catch(() => {}).finally(async () => {
            backgroundFinished = true;
            await releaseWhenFinished();
            if (mainFinished && this.jobs.get(id) === abort) this.jobs.delete(id);
          }).catch(() => {});
        } else {
          const output = await pending; check(); attempt.setupComplete = true;
          this.progress(id, { log: `${output.stdout}\n${output.stderr}` }); await save();
          // Arbitrary project actions can invalidate interpreter/package bindings. Verify again before agent dispatch.
          if (settings.environment.enabled) environment = await this.environments.prepare({ scope: `${service}:${project.id}`, projectRoot: project.workspaceRoot, worktreePath: attempt.path, ...(checkoutIdentity ? { checkoutIdentity } : {}), signal: abort.signal });
        }
      }
      check();
      if (backgroundError !== undefined) throw backgroundError;
      attempt.completed = true;
      this.progress(id, { phase: "ready", stage: background && !backgroundFinished ? "Ready; setup action running" : "Ready" }); await save();
      await this.refresh(); check();
      return { path: attempt.path, branch: attempt.branch, ...(environment ? { instructions: this.environments.describe(environment).agentInstructions } : {}) };
    } catch (error) {
      this.progress(id, { ...(attempt.path ? { path: attempt.path, branch: attempt.branch } : {}), phase: abort.signal.aborted ? "cancelled" : "failed", stage: "Agent waiting", error: errorText(error) });
      await save();
      throw error;
    } finally {
      mainFinished = true;
      await releaseWhenFinished();
      if ((!background || backgroundFinished) && this.jobs.get(id) === abort) this.jobs.delete(id);
    }
  }
  cancel(id: string) { const job = this.jobs.get(id); if (!job) throw new Error("Preparation is no longer running"); job.abort(); }
  async retry(id: string, bind?: BindCheckout) {
    await this.hydrate(this.options.scope());
    const attempt = this.attempts.get(id);
    if (!attempt || attempt.service !== this.options.scope()) throw new Error("Preparation is not available for this service");
    if (bind && !this.bindings.has(id)) this.bindings.set(id, bind);
    return this.execute(attempt);
  }
  handoffFor(id: string): WorktreeHandoff | undefined {
    const attempt = this.attempts.get(id);
    if (!attempt || attempt.service !== this.options.scope() || this.project(attempt.preparation.projectId).workspaceRoot !== attempt.projectRoot) throw new Error("Preparation is not available for this project and service");
    return attempt.handoff === undefined ? undefined : parseHandoff(attempt.handoff);
  }
  async environmentInstructions(projectId: string, path: string): Promise<string | undefined> {
    const record = await this.environments.get(this.scope(projectId), path);
    return record?.status === "ready" ? this.environments.describe(record).agentInstructions : undefined;
  }
  async restore(projectId: string, path: string) {
    await this.options.assertTrusted(); const project = this.project(projectId);
    await this.hydrate(this.options.scope());
    await this.mergeHistory(this.options.scope());
    const { tree: saved } = await this.requireCheckout(projectId, path, true);
    if (!saved || saved.root || !saved.missing || !saved.branch) throw new Error("Select a missing checkout with a retained branch.");
    const local = await listLocalWorktrees(project.workspaceRoot);
    if (local.some(w => resolve(w.path) === resolve(path))) await restoreCheckout(project.workspaceRoot, path, saved.branch);
    else {
      if (!this.options.client.createWorktree) throw new Error("This service cannot restore worktrees.");
      await this.options.client.createWorktree({ cwd: project.workspaceRoot, refName: saved.branch, path });
    }
    const attempt = this.orderedAttempts().filter(a => a.preparation.projectId === projectId && a.path && resolve(a.path) === resolve(path)).at(-1);
    if (attempt) {
      attempt.created = true; attempt.completed = false; attempt.setupComplete = false;
      this.progress(attempt.preparation.id, { phase: "failed", background: false, backgroundRunning: false, stage: "Restored; preparation required", error: "Prepare the restored checkout before starting an agent" });
      await this.persist(attempt.service, attempt);
    }
    await this.refresh();
  }
  async removalDetails(projectId: string, path: string) {
    const { project, tree } = await this.requireCheckout(projectId, path);
    if (tree.root || tree.locked) throw new Error("The main or a locked checkout cannot be removed.");
    if (this.checkoutOpenInWindow(path)) throw new Error("This checkout is open in this window. Open the main checkout before removing it.");
    if (this.checkoutBusy(path)
      || [...this.attempts.values()].some(a => a.path === path && this.jobs.has(a.preparation.id))) throw new Error("An agent or setup is using this checkout. Stop it before removal.");
    const status = await readWorktreeStatus(path);
    const environment = await this.environments.get(this.scope(projectId), path);
    let untracked = status.untracked;
    if (untracked && environment?.location === "directory" && environment.status !== "removed") {
      const prefix = relative(path, environment.target).split(sep).join("/");
      const files = (await git(path, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
      // Actual deletion still requires the manager's ownership marker. Unrelated files stay protected.
      untracked = files.some(file => file !== prefix && !file.startsWith(`${prefix}/`));
    }
    if (status.tracked || untracked) throw new Error("This checkout has local changes or untracked files. Commit or move them before removal.");
    return { tree, environment, ignored: status.ignored || environment?.location === "directory" };
  }
  async remove(projectId: string, path: string) {
    const service = this.options.scope();
    const projectRoot = this.project(projectId).workspaceRoot;
    const scope = `${service}:${projectId}`;
    const check = () => {
      if (this.options.scope() !== service) throw new Error("The connected service changed during removal");
      if (this.options.projects().find(project => project.id === projectId)?.workspaceRoot !== projectRoot) throw new Error("The project checkout changed during removal");
    };
    await this.options.assertTrusted(); check();
    await this.requireCheckout(projectId, path); check();
    const checkout = await realpath(path); check();
    const release = await acquireWorktreeLease(this.options.storageRoot, `checkout:${checkout}`);
    try {
      check();
      const { tree } = await this.removalDetails(projectId, path);
      check();
      if (!this.options.client.removeWorktree) throw new Error("This service cannot remove worktrees.");
      // Hold the same lease as setup in every window; keep branch/thread history.
      await this.environments.remove({ scope, projectRoot, worktreePath: tree.path });
      check();
      await this.options.client.removeWorktree(projectRoot, tree.path, true);
    } finally { await release(); }
    await this.refresh();
  }
  async review(projectId: string, path: string, baseRef?: string): Promise<WorktreeReview> {
    const { project, tree } = await this.requireCheckout(projectId, path);
    return { projectId, path: tree.path, branch: tree.branch, ...await worktreeChanges({ projectRoot: project.workspaceRoot, path: tree.path, ...(baseRef ? { baseRef } : {}) }) };
  }
  async diffFile(projectId: string, path: string, baseRef: string, file: string) { const { project } = await this.requireCheckout(projectId, path); return readWorktreeDiffFile({ projectRoot: project.workspaceRoot, path, baseRef, file }); }
  async apply(projectId: string, path: string, destination: string, files: string[], baseRef?: string) {
    await this.options.assertTrusted(); const { project, tree: sourceTree } = await this.requireCheckout(projectId, path); const { tree: destinationTree } = await this.requireCheckout(projectId, destination);
    if (this.checkoutBusy(destination)) throw new Error("An agent is writing to the destination checkout.");
    const patch = await applyWorktreeFiles({ projectRoot: project.workspaceRoot, path, destination, files, ...(baseRef ? { baseRef } : {}) });
    await this.recordMerge(projectId, project.workspaceRoot, sourceTree, destinationTree, patch).catch(() => undefined);
  }
  /** Best-effort: a merge that cannot be recorded still applied successfully, so this never fails the transfer. */
  private async recordMerge(projectId: string, workspaceRoot: string, source: LocalWorktree, destination: LocalWorktree, patch: Buffer): Promise<MergeRecord | undefined> {
    if (!patch.length) return undefined;
    const threads = this.options.threads();
    const destinationThread = resolveThreadForCheckout(threads, projectId, workspaceRoot, destination.path);
    if (!destinationThread) return undefined;
    const sourceThread = resolveThreadForCheckout(threads, projectId, workspaceRoot, source.path);
    const files = parsePatchNumstat(await patchNumstat(destination.path, patch)).map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions, ...(file.binary ? { binary: true } : {}) }));
    if (!files.length) return undefined;
    return this.merges.record({
      destinationThreadId: destinationThread.id, sourceThreadId: sourceThread?.id ?? "", sourceTitle: sourceThread?.title ?? basename(source.path),
      sourceBranch: source.branch, destinationBranch: destination.branch, cwd: destination.path, appliedAt: new Date().toISOString(), files,
    }, patch.toString("utf8"));
  }
  private checkoutBusy(path: string): boolean {
    const canonical = this.canonicalPaths();
    const roots = new Map(this.options.projects().map(project => [project.id, project.workspaceRoot]));
    const destination = canonical(path), paths = [...new Set([...this.value.items.map(item => item.path), destination])];
    return this.options.threads().some(thread => {
      const checkout = thread.worktreePath ?? roots.get(thread.projectId);
      return !!thread.activeRunId && !!checkout && checkoutForWorkingDirectory(canonical(checkout), paths) === destination;
    });
  }
  private canonicalPaths(): (path: string) => string {
    const cache = new Map<string, string>();
    return path => {
      let canonical = cache.get(path);
      if (canonical === undefined) {
        try { canonical = realpathSync(path); } catch { canonical = resolve(path); }
        cache.set(path, canonical);
      }
      return canonical;
    };
  }
  private checkoutOpenInWindow(path: string): boolean {
    const canonical = this.canonicalPaths();
    const checkout = canonical(path), paths = [...new Set([...this.value.items.map(item => item.path), checkout])];
    return this.options.windowRoots().some(root => checkoutForWorkingDirectory(canonical(root), paths) === checkout);
  }
  async command(projectId: string, path: string, actionId?: string) {
    await this.options.assertTrusted(); const { project } = await this.requireCheckout(projectId, path);
    const action = actionId ? (await this.settings(projectId)).actions.find(a => a.id === actionId) : undefined;
    if (actionId && !action) throw new Error("Project action no longer exists.");
    const record = await this.environments.get(this.scope(projectId), path);
    const profile = await this.environments.getProfile(this.scope(projectId));
    if (profile.enabled && path !== project.workspaceRoot && record?.status !== "ready") throw new Error("Prepare the checkout’s Python environment first.");
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = action ? process.platform === "win32" ? ["/d", "/s", "/c", action.command] : ["-c", action.command] : [];
    const command = record?.status === "ready" ? this.environments.describe(record, shell, args) : { executable: shell, args, cwd: path };
    return { ...command, title: action?.name ?? `Python · ${basename(path)}`, env: { T3CODE_PROJECT_ROOT: project.workspaceRoot, T3CODE_WORKTREE_PATH: path } };
  }
  async gitAction(projectId: string, path: string, operation: string, commitMessage?: string, threadId?: string) {
    await this.options.assertTrusted(); const { project } = await this.requireCheckout(projectId, path);
    if (!["commit", "push", "create_pr", "commit_push", "commit_push_pr"].includes(operation)) throw new Error("Invalid Git action.");
    if (!this.options.client.gitAction) throw new Error("Update T3 Code to use Git actions.");
    const matches = this.options.threads().filter(t => t.projectId === projectId && resolve(t.worktreePath ?? project.workspaceRoot) === resolve(path));
    if (threadId && !matches.some(t => t.id === threadId)) throw new Error("The conversation does not belong to this checkout");
    const targetThread = threadId ?? matches[0]?.id;
    await this.options.client.gitAction({ actionId: randomUUID(), cwd: path, action: operation, projectId, ...(targetThread ? { threadId: targetThread } : {}), ...(commitMessage ? { commitMessage } : {}) }, () => {});
    await this.refresh();
  }
  dispose() { this.disposed = true; activeCoordinators.delete(this.instance); for (const job of this.jobs.values()) job.abort(); this.jobs.clear(); }
}
