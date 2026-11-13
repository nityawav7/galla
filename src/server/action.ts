import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { type ActionResult } from "@/lib/action-result";
import { isAppError, RateLimitError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { clientIp, getLimiter, hashIp } from "@/lib/ratelimit";
import { withRequestContext } from "@/lib/request-context";
import { getSessionUser } from "@/server/auth/session";
import { isDemoEmail } from "@/server/demo/users";
import { requestIdFrom } from "@/server/http/security-headers";

/** The proxy's request id, or a new one (requests the proxy didn't see). */
async function requestId(): Promise<string> {
  const incoming = await headers();
  return incoming.get("x-request-id") ?? requestIdFrom(incoming);
}

/**
 * Runs a server action's work and maps errors in one place (SPEC §7.2). Expected errors
 * (validation, not found, forbidden) go back to the form; anything else is logged by name
 * only, since database errors can quote the values that failed. Every log line of the action
 * carries its request id (and the business, once `requireTenant` has found it).
 */
export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  return withRequestContext({ requestId: await requestId() }, async () => {
    try {
      return { ok: true, data: await work() };
    } catch (error) {
      // redirect() and notFound() work by throwing; let Next handle them.
      unstable_rethrow(error);
      if (!isAppError(error)) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "action failed",
        );
      }
      return { ok: false, error: toPublicError(error) };
    }
  });
}

/** SPEC §6.2: 120 changes a minute per signed-in user, across every business they work in. */
export async function limitMutation(userId: string): Promise<void> {
  const { success, reset } = await getLimiter("mutation").limit(userId);
  if (!success) throw new RateLimitError(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}

/**
 * The demo's users are shared by every visitor, so their changes are counted per visitor IP
 * instead, and more strictly: 30 a minute (SPEC F12).
 */
export async function limitDemoMutation(requestHeaders: Headers): Promise<void> {
  const key = hashIp(clientIp(requestHeaders));
  const { success, reset } = await getLimiter("demoMutation").limit(key);
  if (!success) throw new RateLimitError(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}

/**
 * `runAction` for actions that change data. Searches and previews (which fire while typing)
 * use `runAction` and are not counted. Without a session the work itself sends the user to
 * sign in.
 */
export async function runMutation<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  return runAction(async () => {
    const user = await getSessionUser();
    if (user && isDemoEmail(user.email)) await limitDemoMutation(await headers());
    else if (user) await limitMutation(user.id);
    return work();
  });
}
