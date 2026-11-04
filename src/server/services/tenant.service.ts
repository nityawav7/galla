import { type TenantContext } from "@/server/authz/context";
import { getDb } from "@/server/db/client";
import { findMembership, listMemberships, type Membership } from "@/server/db/repos/members.repo";

export type { Membership };

export interface ResolvedTenant {
  ctx: TenantContext;
  membership: Membership;
}

/**
 * /b/{slug} → TenantContext for the signed-in user, or null when they are not a member
 * (the caller answers 404, so other businesses' slugs reveal nothing; ADR 0003, 0004).
 */
export async function resolveTenant(userId: string, slug: string): Promise<ResolvedTenant | null> {
  const membership = await findMembership(getDb(), userId, slug);
  if (!membership) return null;
  return {
    ctx: { userId, businessId: membership.businessId, role: membership.role },
    membership,
  };
}

export function listBusinessesForUser(userId: string): Promise<Membership[]> {
  return listMemberships(getDb(), userId);
}
