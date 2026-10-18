import assert from "node:assert/strict";
import test from "node:test";
import type { HostStateSnapshot, ThreadSummary } from "./bridge.js";
import type { WorktreeSummary } from "./worktrees.js";
import { checkoutForWorkingDirectory, checkoutPath, existingCheckoutChoice, worktreeRepositoryGroups, worktreeVisibilityScope } from "./worktreeGroups.js";
import { sessionShelves } from "./sessionTree.js";

const project = (id: string, workspaceRoot: string) => ({ id, workspaceRoot, title: id });
const item = (projectId: string, path: string, root = false): WorktreeSummary => ({ id: `${projectId}:${path}`, projectId, path, repositoryId: "/repo/.git", projectRoot: projectId === "linked" ? "/linked" : "/repo", branch: root ? "main" : "topic", root, missing: false, active: false, threadIds: [] });
const thread = (id: string, projectId: string, worktreePath?: string): ThreadSummary => ({ id, projectId, title: id, ...(worktreePath ? { worktreePath } : {}) } as ThreadSummary);

test("repository groups consolidate checkouts and bind implicit sessions to their service root once", () => {
  const state = { projects: [project("main", "/repo"), project("linked", "/linked"), project("submodule", "/repo/submodule")], threads: [thread("original", "main"), thread("linked-root", "linked"), thread("explicit", "main", "/linked/")], worktrees: { items: [item("main", "/repo", true), { ...item("main", "/linked"), threadIds: ["linked-root", "explicit"] }, item("linked", "/repo", true), { ...item("linked", "/linked/"), threadIds: ["original"] }, { ...item("submodule", "/repo/submodule", true), repositoryId: "/repo/.git/modules/submodule" }] } } as unknown as HostStateSnapshot;
  const groups = worktreeRepositoryGroups(state);
  assert.equal(groups.length, 2, "submodules remain separate repositories");
  assert.equal(groups[0]!.checkouts.length, 2);
  assert.equal(groups[0]!.title, "main");
  assert.deepEqual(groups[0]!.checkouts[0]!.sessions.map((thread) => thread.id), ["original"]);
  const linked = groups[0]!.checkouts[1]!;
  assert.equal(linked.item.projectId, "main", "a linked service record cannot replace the existing main-project action owner");
  assert.deepEqual(linked.sessions.map((thread) => thread.id), ["linked-root", "explicit"], "stale membership cannot move a known effective path");
  assert.deepEqual(existingCheckoutChoice(linked.item), { type: "existing", path: "/linked" });
  assert.deepEqual(existingCheckoutChoice(linked.sources.find((source) => source.projectId === "linked")!), { type: "root" });
  assert.deepEqual(existingCheckoutChoice(item("linked", "/repo", true)), { type: "existing", path: "/repo" });
});

test("old snapshots use project identity and retain empty projects", () => {
  const { repositoryId: _repositoryId, projectRoot: _projectRoot, ...legacy } = item("main", "/repo", true);
  const state = { projects: [project("main", "/repo"), project("empty", "/other")], threads: [], worktrees: { items: [legacy] } } as unknown as HostStateSnapshot;
  assert.deepEqual(worktreeRepositoryGroups(state).map((group) => group.id), ["project:main", "project:empty"]);
  assert.deepEqual(existingCheckoutChoice(legacy), { type: "root" });
});

test("backend membership resolves canonical path aliases without inventing root membership", () => {
  const state = { projects: [project("main", "/alias")], threads: [thread("canonical", "main"), thread("unknown", "main")], worktrees: { items: [{ ...item("main", "/repo", true), threadIds: ["canonical"] }] } } as unknown as HostStateSnapshot;
  assert.deepEqual(worktreeRepositoryGroups(state)[0]!.checkouts[0]!.sessions.map((thread) => thread.id), ["canonical"]);
  assert.equal(checkoutPath("/"), "/");
  assert.equal(checkoutPath("C:\\Repo\\"), checkoutPath("c:/repo"));
});

test("cross-checkout descendants stay beneath their ordinary root without changing actual checkout membership", () => {
  const child = { ...thread("child", "main", "/linked"), parentThreadId: "parent", relationshipToParent: "subagent" as const };
  const grandchild = { ...thread("nested", "main", "/other"), parentThreadId: "child", relationshipToParent: "subagent" as const };
  const state = { projects: [project("main", "/repo")], threads: [thread("parent", "main"), child, grandchild,
    thread("linked-parent", "main", "/linked"),
    { ...thread("settled", "main"), settled: true },
    { ...thread("settled-child", "main", "/linked"), settled: true, parentThreadId: "settled", relationshipToParent: "subagent" },
    { ...thread("archived", "main"), archived: true },
    { ...thread("archived-child", "main", "/other"), archived: true, parentThreadId: "archived", relationshipToParent: "subagent" },
    { ...thread("orphan", "main", "/linked"), parentThreadId: "missing", relationshipToParent: "subagent" },
    { ...thread("cycle-a", "main"), parentThreadId: "cycle-b", relationshipToParent: "subagent" },
    { ...thread("cycle-b", "main", "/linked"), parentThreadId: "cycle-a", relationshipToParent: "subagent" }],
    worktrees: { items: [item("main", "/repo", true), item("main", "/linked"), item("main", "/other")] } } as unknown as HostStateSnapshot;
  const [main, linked, other] = worktreeRepositoryGroups(state)[0]!.checkouts;
  assert.deepEqual(main!.sessions.map((thread) => thread.id), ["parent", "child", "nested", "settled", "settled-child", "archived", "archived-child"]);
  assert.deepEqual(linked!.sessions.map((thread) => thread.id), ["linked-parent"]);
  assert.deepEqual(other!.sessions, []);
  assert.equal(main!.sessions.find((thread) => thread.id === "child")!.worktreePath, "/linked");
  assert.equal(main!.item.threadIds.includes("child"), false, "display grouping must not rewrite checkout binding");
  assert.equal(linked!.item.threadIds.includes("child"), true);
  const shelves = sessionShelves(main!.sessions);
  assert.equal(shelves.active.length + shelves.settled.length + shelves.archived.length, 3, "only ordinary roots count");
  assert.equal(shelves.settled[0]!.children[0]!.thread.id, "settled-child");
  assert.equal(shelves.archived[0]!.children[0]!.thread.id, "archived-child");
  const searched = sessionShelves(main!.sessions, [grandchild]);
  assert.equal(searched.active[0]!.thread.id, "parent");
  assert.equal(searched.active[0]!.children[0]!.children[0]!.thread.id, "nested");
});

test("service projects in checkout subdirectories use the nearest containing checkout", () => {
  const linked = "/repo/.claude/worktrees/topic";
  assert.equal(checkoutForWorkingDirectory("/repo/src", ["/repo", linked]), "/repo");
  assert.equal(checkoutForWorkingDirectory(`${linked}/src/deep`, ["/repo", linked]), linked);
  assert.equal(checkoutForWorkingDirectory(linked, ["/repo", linked]), linked);
  assert.equal(checkoutForWorkingDirectory("/repository/src", ["/repo"]), undefined, "directory names must respect boundaries");
  assert.equal(checkoutForWorkingDirectory("C:\\Repo\\Src", ["c:/repo/"]), "c:/repo/");
  assert.equal(checkoutForWorkingDirectory("/src", ["/"]), "/");
  const state = { projects: [project("main", "/repo/src"), project("linked", `${linked}/src`)], threads: [thread("main-subdir", "main"), thread("linked-subdir", "linked")], worktrees: { items: [item("main", "/repo", true), item("main", linked), item("linked", "/repo", true), item("linked", linked)] } } as unknown as HostStateSnapshot;
  const checkouts = worktreeRepositoryGroups(state)[0]!.checkouts;
  assert.deepEqual(checkouts[0]!.sessions.map((thread) => thread.id), ["main-subdir"]);
  assert.deepEqual(checkouts[1]!.sessions.map((thread) => thread.id), ["linked-subdir"]);
  assert.equal(state.projects[0]!.workspaceRoot, "/repo/src", "actual working directory stays unchanged");
});

test("canonical project checkout metadata preserves main service ownership and original alias directory", () => {
  const rows = ["linked", "main"].flatMap((projectId) => [true, false].map((root) => ({ ...item(projectId, root ? "/repo" : "/linked", root), projectRoot: projectId === "main" ? "/alias/src" : "/linked-alias/src", projectCheckoutPath: projectId === "main" ? "/repo" : "/linked", openInWindow: !root })));
  const state = { projects: [project("linked", "/linked-alias/src"), project("main", "/alias/src")], threads: [thread("original-alias", "main"), thread("linked-alias", "linked")], worktrees: { items: rows } } as unknown as HostStateSnapshot;
  const group = worktreeRepositoryGroups(state)[0]!;
  assert.equal(group.title, "main");
  assert.equal(group.checkouts[1]!.item.projectId, "main", "an earlier linked service record does not replace the main service owner");
  assert.deepEqual(group.checkouts[0]!.sessions.map((thread) => thread.id), ["original-alias"]);
  assert.deepEqual(group.checkouts[1]!.sessions.map((thread) => thread.id), ["linked-alias"]);
  assert.equal(group.checkouts[0]!.item.openInWindow, false);
  assert.equal(group.checkouts[1]!.item.openInWindow, true);
  assert.deepEqual(existingCheckoutChoice(group.checkouts[0]!.item), { type: "root" }, "root choice preserves the service's original alias/subdirectory");
  assert.deepEqual(existingCheckoutChoice(group.checkouts[1]!.item), { type: "existing", path: "/linked" });
});

test("canonical backend membership wins over an alias lexically nested beneath main", () => {
  const alias = "/repo/linked-alias";
  const rows = ["main", "linked"].flatMap((projectId) => [true, false].map((root) => ({ ...item(projectId, root ? "/repo" : "/outside/linked", root), projectRoot: projectId === "linked" ? alias : "/repo", projectCheckoutPath: projectId === "linked" ? "/outside/linked" : "/repo", threadIds: root ? [] : ["explicit-alias", "implicit-alias"] })));
  const state = { projects: [project("main", "/repo"), project("linked", alias)], threads: [thread("explicit-alias", "main", alias), thread("implicit-alias", "linked")], worktrees: { items: rows } } as unknown as HostStateSnapshot;
  const group = worktreeRepositoryGroups(state)[0]!;
  assert.deepEqual(group.checkouts[0]!.sessions, [], "raw alias containment cannot move canonical linked sessions to main");
  assert.deepEqual(group.checkouts[1]!.sessions.map((thread) => thread.id), ["explicit-alias", "implicit-alias"]);
  assert.equal(group.checkouts[1]!.sessions[0]!.worktreePath, alias);
  const withoutMembership = { ...state, worktrees: { ...state.worktrees!, items: rows.map((row) => ({ ...row, threadIds: [] })) } };
  assert.equal(worktreeRepositoryGroups(withoutMembership)[0]!.checkouts[1]!.sessions.some((thread) => thread.id === "implicit-alias"), true, "canonical project metadata beats raw alias containment for implicit service-root sessions");
});

test("visibility scope separates environments, isolated homes and workspaces, independent of folder order", () => {
  const base = { home: "/isolated", environment: { environmentId: "server", label: "Server" }, workspaceRoots: ["/repo/", "/linked"] };
  const key = worktreeVisibilityScope(base);
  assert.equal(key, worktreeVisibilityScope({ ...base, workspaceRoots: ["/linked", "/repo"] }));
  assert.notEqual(key, worktreeVisibilityScope({ ...base, home: "/different" }));
  assert.notEqual(key, worktreeVisibilityScope({ ...base, environment: { ...base.environment, environmentId: "different" } }));
  assert.notEqual(key, worktreeVisibilityScope({ ...base, workspaceRoots: ["/other"] }));
});
