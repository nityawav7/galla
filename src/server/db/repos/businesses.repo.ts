import { eq } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { businesses } from "../schema";
import { type Executor } from "../transaction";

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = Omit<
  typeof businesses.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "createdBy"
>;

/**
 * Creates a tenant. Not tenant-scoped because no business exists yet; Phase 4 calls it from
 * onboarding together with the owner's membership.
 */
export async function insertBusiness(
  db: Executor,
  input: NewBusiness,
  createdBy: string | null,
): Promise<Business> {
  const [row] = await db
    .insert(businesses)
    .values({ ...input, createdBy })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** The context's own business. Other businesses are unreachable through this repo. */
export async function getCurrentBusiness(
  db: Executor,
  ctx: TenantContext,
): Promise<Business | undefined> {
  const [row] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId));
  return row;
}
