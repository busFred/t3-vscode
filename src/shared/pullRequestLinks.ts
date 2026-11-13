import { parsePullRequestAnchor, type PullRequestAnchor } from "@t3tools/shared/pullRequestAnchor";

/**
 * Pull request deep links (T3 0.1.9): a link may name a comment, a diff line, the checks tab or the
 * commit list rather than the request itself.
 *
 * The panel shows a server-canonical URL alongside the stored link. Opening the canonical one drops
 * whatever the link pointed at, so an agent's link to a specific review comment used to land on the
 * request's root instead.
 */

/** What a link points at, for a short label beside the Open control. */
export function pullRequestAnchorLabel(anchor: PullRequestAnchor | null): string | null {
  switch (anchor?.kind) {
    case "diff": return anchor.range ? "diff line" : "diff";
    case "timeline": return "comment";
    case "summary": return "description";
    case "checks": return "checks";
    case "commits": return "commits";
    case "code": return "files";
    default: return null;
  }
}

/**
 * The URL to open for a link, preferring the canonical address but keeping the link's own target
 * when it names one and the canonical address names none.
 */
export function pullRequestOpenTarget(linkUrl: string, canonicalUrl?: string | null): string {
  const canonical = canonicalUrl?.trim();
  if (!canonical) return linkUrl;
  const target = parsePullRequestAnchor(linkUrl);
  if (!target) return canonical;
  // A canonical address that names a target of its own is the more specific one and is preferred.
  // In practice the host API returns the request's root, which names none, so the link's target
  // wins; this branch only matters if a caller passes an already-anchored canonical address.
  if (parsePullRequestAnchor(canonical)) return canonical;
  return linkUrl;
}

export { parsePullRequestAnchor };
