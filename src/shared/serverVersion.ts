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

export function unsupportedServerMessage(version: string): string {
  return `T3 Code ${version} is too old for this extension. Update T3 Code to ${MINIMUM_SERVER_VERSION} or later.`;
}
