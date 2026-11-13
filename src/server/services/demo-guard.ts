import { ForbiddenError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { getDb } from "@/server/db/client";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findUserEmail } from "@/server/db/repos/members.repo";
import { type Executor } from "@/server/db/transaction";
import { isDemoEmail } from "@/server/demo/users";

/** Why a change is refused in the demo; the UI shows its own explanation. */
export const DEMO_READ_ONLY = "demoReadOnly";

/**
 * The shared demo shop's settings and members can't change (SPEC F12): a visitor can't put
 * their own UPI ID on "Sharma Hardware" invoices, or lock others out.
 */
export async function assertNotDemoBusiness(
  ctx: TenantContext,
  db: Executor = getDb(),
): Promise<void> {
  const business = await getCurrentBusiness(db, ctx);
  if (business?.isDemo) throw new ForbiddenError(DEMO_READ_ONLY);
}

/** The demo's own users can't create businesses of their own. */
export async function assertNotDemoUser(userId: string, db: Executor = getDb()): Promise<void> {
  if (isDemoEmail(await findUserEmail(db, userId))) throw new ForbiddenError(DEMO_READ_ONLY);
}
