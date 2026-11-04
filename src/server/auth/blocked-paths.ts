/**
 * Better Auth endpoints the browser must not reach directly. Organization endpoints (invite,
 * accept, change role, remove, update, delete …) would skip our permission checks and audit
 * log, so they answer 404 over HTTP; member.service calls them server-side (ADR 0004). A
 * prefix, not a list, so endpoints added by a Better Auth upgrade are blocked too.
 */
const BLOCKED_PREFIXES = ["/api/auth/organization/"];

function decoded(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

export function isBlockedAuthPath(pathname: string): boolean {
  const plain = decoded(pathname);
  // A path that does not decode is refused rather than guessed at.
  if (plain === undefined) return true;
  const path = plain.toLowerCase().replace(/\/{2,}/g, "/");
  return BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix) || `${path}/` === prefix);
}
