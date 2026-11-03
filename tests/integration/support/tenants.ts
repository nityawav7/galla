import { type Role, type TenantContext } from "@/server/authz/context";
import { getDb } from "@/server/db/client";
import { newId } from "@/server/db/ids";
import { type Business, insertBusiness, type NewBusiness } from "@/server/db/repos/businesses.repo";

export interface Tenant {
  business: Business;
  ctx: TenantContext;
}

/** A slug no other test (or earlier run) has used, so tests never share data. */
export function uniqueSlug(prefix = "t"): string {
  return `${prefix}-${newId().replaceAll("-", "").slice(-16)}`;
}

/** A fresh business plus a context for a (not yet real) user acting in it. */
export async function createTenant(
  overrides: Partial<NewBusiness> = {},
  role: Role = "OWNER",
): Promise<Tenant> {
  const business = await insertBusiness(
    getDb(),
    {
      slug: uniqueSlug(),
      legalName: "Test Traders",
      gstScheme: "REGULAR",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
      ...overrides,
    },
    null,
  );
  return { business, ctx: { userId: newId(), businessId: business.id, role } };
}
