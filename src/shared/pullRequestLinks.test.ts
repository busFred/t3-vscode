import assert from "node:assert/strict";
import test from "node:test";
import { parsePullRequestAnchor, pullRequestAnchorLabel, pullRequestOpenTarget } from "./pullRequestLinks.js";

const PR = "https://github.com/acme/widget/pull/42";

test("A link naming a comment keeps that target instead of the request's root", () => {
  const comment = `${PR}#discussion_r123`;
  assert.equal(pullRequestOpenTarget(comment, PR), comment);
});

test("A plain link uses the server's canonical address", () => {
  assert.equal(pullRequestOpenTarget(PR, "https://github.com/acme/widget/pull/42"), "https://github.com/acme/widget/pull/42");
  assert.equal(pullRequestOpenTarget(`${PR}?utm=1`, PR), PR, "a link with no target gains nothing by being kept");
});

test("Without a canonical address the link is opened as stored", () => {
  assert.equal(pullRequestOpenTarget(`${PR}#discussion_r1`, null), `${PR}#discussion_r1`);
  assert.equal(pullRequestOpenTarget(PR, "   "), PR, "a blank canonical URL is not an address");
});

test("A canonical address naming a target of its own is the more specific one and wins", () => {
  // Only presence is compared, not equality: the host API returns the request root, which names no
  // target, so this branch only applies to a caller that passes an already-anchored address.
  const canonical = `${PR}/checks`;
  assert.equal(pullRequestOpenTarget(`${PR}#discussion_r1`, canonical), canonical);
});

test("Each kind of target reads as a short label", () => {
  const label = (url: string) => pullRequestAnchorLabel(parsePullRequestAnchor(url));
  assert.equal(label(`${PR}#discussion_r123`), "comment");
  assert.equal(label(`${PR}/checks`), "checks");
  assert.equal(label(`${PR}/commits`), "commits");
  assert.equal(label(`${PR}/files`), "files");
  assert.equal(label(PR), null, "the request itself needs no label");
});

test("A GitLab merge request is understood too", () => {
  const mr = "https://gitlab.com/acme/widget/-/merge_requests/7";
  assert.equal(pullRequestAnchorLabel(parsePullRequestAnchor(`${mr}/pipelines`)), "checks");
  assert.equal(pullRequestAnchorLabel(parsePullRequestAnchor(`${mr}/diffs`)), "files");
});

test("A malformed URL is not a target and does not throw", () => {
  assert.equal(parsePullRequestAnchor("not a url"), null);
  assert.equal(parsePullRequestAnchor(null), null);
  assert.equal(pullRequestOpenTarget("not a url", PR), PR);
});
