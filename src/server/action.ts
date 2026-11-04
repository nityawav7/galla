import { unstable_rethrow } from "next/navigation";

import { type ActionResult } from "@/lib/action-result";
import { isAppError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Runs a server action's work and maps errors in one place (SPEC §7.2). Expected errors
 * (validation, not found, forbidden) go back to the form; anything else is logged by name
 * only, since database errors can quote the values that failed.
 */
export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    // redirect() and notFound() work by throwing; let Next handle them.
    unstable_rethrow(error);
    if (!isAppError(error)) {
      logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "action failed");
    }
    return { ok: false, error: toPublicError(error) };
  }
}
