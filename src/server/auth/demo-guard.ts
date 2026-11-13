import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { isDemoEmail } from "@/server/demo/users";

/**
 * Better Auth endpoints that change or remove an account. A demo visitor shares the demo user
 * with everyone else, so these are refused for it: no new password, email or name, no deleting
 * it, no signing everyone else out (SPEC F12, ADR 0018).
 */
const SESSION_LOCKED = new Set([
  "/change-email",
  "/change-password",
  "/delete-user",
  "/email-otp/change-email",
  "/email-otp/request-email-change",
  "/link-social",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/unlink-account",
  "/update-session",
  "/update-user",
]);

/** Endpoints that name an email: none may target a demo account. */
const EMAIL_LOCKED = new Set([
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/email-otp/send-verification-otp",
  "/forget-password/email-otp",
  "/request-password-reset",
  "/send-verification-email",
  "/sign-in/email-otp",
  "/sign-up/email",
]);

export type DemoAuthBlock = "demoAccountLocked" | null;

/**
 * Whether Better Auth must refuse this call for a demo account. Signing in with the demo
 * password over HTTP is refused too: only the "Try the demo" action signs in, on the server
 * (`fromBrowser` is false there).
 */
export function demoAuthBlock(input: {
  path: string;
  bodyEmail: unknown;
  sessionEmail: string | null;
  fromBrowser: boolean;
}): DemoAuthBlock {
  if (SESSION_LOCKED.has(input.path) && isDemoEmail(input.sessionEmail)) return "demoAccountLocked";
  if (EMAIL_LOCKED.has(input.path) && isDemoEmail(input.bodyEmail)) return "demoAccountLocked";
  if (input.path === "/sign-in/email" && input.fromBrowser && isDemoEmail(input.bodyEmail)) {
    return "demoAccountLocked";
  }
  return null;
}

function bodyEmail(body: unknown): unknown {
  return typeof body === "object" && body !== null && "email" in body ? body.email : undefined;
}

/** `hooks.before` for Better Auth: runs for HTTP requests and server-side calls alike. */
export const demoGuard = createAuthMiddleware(async (ctx) => {
  const needsSession = SESSION_LOCKED.has(ctx.path);
  const session = needsSession ? await getSessionFromCtx(ctx) : null;
  const block = demoAuthBlock({
    path: ctx.path,
    bodyEmail: bodyEmail(ctx.body),
    sessionEmail: session?.user.email ?? null,
    fromBrowser: ctx.request !== undefined,
  });
  if (block) throw new APIError("FORBIDDEN", { message: block });
});
