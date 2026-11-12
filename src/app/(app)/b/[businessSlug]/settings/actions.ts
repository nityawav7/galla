"use server";

import { type ActionResult } from "@/lib/action-result";
import { runMutation } from "@/server/action";
import { requireTenant } from "@/server/auth/session";
import { updateBusinessSettings } from "@/server/services/business.service";

/** Thin: membership from the URL's slug, then the service checks the role and validates. */
export async function updateBusinessAction(
  businessSlug: string,
  values: unknown,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await updateBusinessSettings(ctx, values);
    return null;
  });
}
