const DEFAULT_PATH = "/b";

/**
 * Where to go after signing in, from a `?next=` value. Only paths on this site are allowed,
 * so a link like /login?next=https://evil.example cannot send people elsewhere.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return DEFAULT_PATH;
  try {
    // Anything that resolves to another origin (e.g. "/\t/evil.example") is refused too.
    const url = new URL(next, "http://galla.invalid");
    if (url.origin !== "http://galla.invalid") return DEFAULT_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_PATH;
  }
}
