"use server";

import { type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { createBusiness } from "@/server/services/business.service";

/** Onboarding's last step. The service validates everything again (never trust the form). */
export async function createBusinessAction(
  values: unknown,
): Promise<ActionResult<{ slug: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const { slug } = await createBusiness(user.id, values);
    return { slug };
  });
}
