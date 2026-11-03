import test from "node:test";
import assert from "node:assert/strict";
import { ProjectId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { conversationPullRequests, currentPullRequest, pullRequestLabel, pullRequestHost, signInRequired } from "./pullRequests.js";
const link = (extra: Partial<ThreadPullRequestLink> = {}): ThreadPullRequestLink => ({ host: "github.com", repository: "owner/repo", number: 12, url: "https://github.com/owner/repo/pull/12", source: "manual", linkedAt: "2026-11-01T00:00:00Z", snapshot: null, stack: null, ...extra });
test("Conversation PRs use upstream legacy conversion and explicit unlink semantics", () => {
  const thread = { linkedPullRequest: { projectId: ProjectId.make("p"), repository: "owner/repo", number: 12, url: link().url } };
  assert.equal(currentPullRequest(thread)?.number, 12);
  assert.equal(currentPullRequest({ ...thread, pullRequests: [] }), null);
  assert.deepEqual(conversationPullRequests({ pullRequests: [link({ source: "stack-dismissed" })] }), []);
});
test("PR badge uses forge terminology, draft and cached checks without inventing state", () => {
  assert.equal(pullRequestHost("https://gitlab.com/owner/repo/-/merge_requests/12").changeRequest.shortLabel, "MR");
  const snapshot = { state: "open", title: "Fix", headBranch: "fix", baseBranch: "main", isDraft: true, updatedAt: null, syncedAt: "2026-11-01T00:00:00Z", checksState: "failing" } as const;
  assert.equal(pullRequestLabel({ pullRequests: [link({ snapshot })] }), "PR #12 · draft · checks failing");
  assert.match(pullRequestLabel({ pullRequests: [link()] })!, /unknown · checks unknown/);
});
test("Current linked PR selection prefers open changes and shows additional linked PR count", () => {
  const snapshot = { state: "merged", title: "Fix", headBranch: "fix", baseBranch: "main", isDraft: false, updatedAt: null, syncedAt: "2026-11-01T00:00:00Z" } as const;
  const thread = { pullRequests: [link({ snapshot }), link({ number: 13, url: "https://github.com/owner/repo/pull/13", snapshot: { ...snapshot, state: "open", checksState: "passing" } })] };
  assert.equal(currentPullRequest(thread)?.number, 13);
  assert.match(pullRequestLabel(thread)!, /#13 \+1 · open · checks passing/);
});
test("Only structured credential failures offer sign-in", () => {
  assert.equal(signInRequired({ reason: "cli-unauthenticated" }), true);
  assert.equal(signInRequired({ reason: "cli-missing" }), false);
  assert.equal(signInRequired(new Error("cli-unauthenticated")), false);
});
