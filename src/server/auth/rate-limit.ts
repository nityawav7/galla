import { clientIp, getLimiter, hashIp } from "@/lib/ratelimit";

/**
 * Auth endpoints that can be abused for password guessing, account enumeration or email
 * spam, grouped so one flow (send a code, then use it) does not exhaust another's budget.
 * Session reads and sign-out are not limited.
 */
const GROUPS = [
  ["/sign-in/", "sign-in"],
  ["/sign-up/", "sign-up"],
  ["/email-otp/", "code"],
  ["/request-password-reset", "password"],
  ["/reset-password", "password"],
  ["/forget-password", "password"],
] as const;

export type AuthLimitGroup = (typeof GROUPS)[number][1];

/** `pathname` is the full request path, e.g. /api/auth/sign-in/email. */
export function authLimitGroup(pathname: string): AuthLimitGroup | undefined {
  const path = pathname.replace(/^\/api\/auth/, "");
  return GROUPS.find(([prefix]) => path.startsWith(prefix))?.[1];
}

/** SPEC §6.2: 5 per minute per IP. Returns a 429 response when over the limit. */
export async function limitAuthRequest(request: Request): Promise<Response | undefined> {
  const group = authLimitGroup(new URL(request.url).pathname);
  if (!group) return undefined;

  const key = `${group}:${hashIp(clientIp(request.headers))}`;
  const { success, reset } = await getLimiter("auth").limit(key);
  if (success) return undefined;

  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return Response.json(
    { code: "RATE_LIMITED", message: "Too many attempts. Please wait a minute and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}
