import { parseSemver } from "@t3tools/shared/semver";

/** Oldest T3 Code server this build supports: 0.1.5 removed `server.getSettings`, `scheduledTasks.list` and the archive subscription. */
export const MINIMUM_SERVER_VERSION = "0.1.5";

/** Release numbers only, so nightlies and previews of a supported release still connect. Unparseable versions are allowed. */
export function serverVersionSupported(version: string): boolean {
  const actual = parseSemver(version); const minimum = parseSemver(MINIMUM_SERVER_VERSION)!;
  if (!actual) return true;
  return actual.major !== minimum.major ? actual.major > minimum.major
    : actual.minor !== minimum.minor ? actual.minor > minimum.minor : actual.patch >= minimum.patch;
}

/** Oldest server that keeps a reply's `response` context record: 0.1.9 decodes records forward-compatibly and silently drops
 * one it cannot decode (its unknown-record schema requires `payload`), so a reply would send without its link. */
export const RESPONSE_REPLY_MINIMUM_SERVER_VERSION = "0.1.10";

/** Release numbers only, as above, but an unknown or unparseable version hides Reply rather than risk a silently dropped record. */
export function responseRepliesSupported(version: string | undefined): boolean {
  const actual = version ? parseSemver(version) : null; const minimum = parseSemver(RESPONSE_REPLY_MINIMUM_SERVER_VERSION)!;
  if (!actual) return false;
  return actual.major !== minimum.major ? actual.major > minimum.major
    : actual.minor !== minimum.minor ? actual.minor > minimum.minor : actual.patch >= minimum.patch;
}

export function unsupportedServerMessage(version: string): string {
  return `T3 Code ${version} is too old for this extension. Update T3 Code to ${MINIMUM_SERVER_VERSION} or later.`;
}
