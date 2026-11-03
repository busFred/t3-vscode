import type { PullRequestSummary, PullRequestDetail, PullRequestChecks, PullRequestChangeBreakdown, PullRequestReviewGuideResult, SourceControlSignInPrompt, SourceControlSignInResult, SourceControlAppAccess } from "@t3tools/contracts";
import { resolveThreadCurrentPullRequestLink, threadPullRequestsOf, visibleThreadPullRequests } from "@t3tools/client-runtime/thread-pull-requests";
import { sourceControlClients, UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import type { ThreadSummary } from "./bridge.js";

export interface PullRequestResponses {
  summary: PullRequestSummary; detail: PullRequestDetail; checks: PullRequestChecks | null;
  changeBreakdown: PullRequestChangeBreakdown; reviewGuide: PullRequestReviewGuideResult; generateReviewGuide: PullRequestReviewGuideResult;
  signInStart: SourceControlSignInPrompt; signInWait: SourceControlSignInResult; signInCancel: void; appAccess: SourceControlAppAccess;
}
export type PullRequestOperation = keyof PullRequestResponses;
export type PullRequestResponse<K extends PullRequestOperation> = { data: PullRequestResponses[K] } | { error: string; signInRequired: boolean };
export const pullRequestOperations: readonly PullRequestOperation[] = ["summary", "detail", "checks", "changeBreakdown", "reviewGuide", "generateReviewGuide", "signInStart", "signInWait", "signInCancel", "appAccess"];
export function conversationPullRequests(thread: Pick<ThreadSummary, "linkedPullRequest" | "pullRequests">) { return visibleThreadPullRequests(threadPullRequestsOf(thread)); }
export function currentPullRequest(thread: Pick<ThreadSummary, "linkedPullRequest" | "pullRequests">) { return resolveThreadCurrentPullRequestLink(threadPullRequestsOf(thread)); }
export function pullRequestHost(url: string) { return sourceControlClients.findByChangeRequestUrl(url) ?? UNKNOWN_SOURCE_CONTROL_CLIENT; }
export function pullRequestLabel(thread: Pick<ThreadSummary, "linkedPullRequest" | "pullRequests">) {
  const link = currentPullRequest(thread); if (!link) return null;
  const others = conversationPullRequests(thread).length - 1;
  return `${pullRequestHost(link.url).changeRequest.shortLabel} #${link.number}${others ? ` +${others}` : ""} · ${link.snapshot?.isDraft && link.snapshot.state === "open" ? "draft" : link.snapshot?.state ?? "unknown"} · checks ${link.snapshot?.checksState ?? "unknown"}`;
}
export function signInRequired(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "reason" in cause && cause.reason === "cli-unauthenticated";
}
