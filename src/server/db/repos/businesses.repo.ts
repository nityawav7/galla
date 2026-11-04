import { eq } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { businesses } from "../schema";
import { type Executor } from "../transaction";

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = Omit<
  typeof businesses.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "createdBy"
>;
/** The slug is the business URL and never changes after creation. */
export type BusinessPatch = Partial<Omit<NewBusiness, "slug" | "isDemo">>;

/**
 * Creates a tenant. Not tenant-scoped because no business exists yet; business.service calls
 * it in the same transaction as the owner's membership and the audit row.
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

/** Updates the context's own business. Returns undefined if it does not exist. */
export async function updateCurrentBusiness(
  db: Executor,
  ctx: TenantContext,
  patch: BusinessPatch,
): Promise<Business | undefined> {
  const [row] = await db
    .update(businesses)
    .set(patch)
    .where(eq(businesses.id, ctx.businessId))
    .returning();
  return row;
}

/** Slugs are global (they are URLs), so this check is deliberately not tenant-scoped. */
export async function isSlugTaken(db: Executor, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);
  return row !== undefined;
}
