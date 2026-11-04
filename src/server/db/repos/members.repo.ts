import { and, asc, eq } from "drizzle-orm";

import { ROLES, type Role, type TenantContext } from "@/server/authz/context";

import { businesses, members } from "../schema";
import { type Executor } from "../transaction";

/** A user's membership of one business, with what the app shell shows about it. */
export interface Membership {
  businessId: string;
  slug: string;
  legalName: string;
  tradeName: string | null;
  role: Role;
}

const membershipColumns = {
  businessId: businesses.id,
  slug: businesses.slug,
  legalName: businesses.legalName,
  tradeName: businesses.tradeName,
  role: members.role,
};

function toMembership(row: { role: string } & Omit<Membership, "role">): Membership {
  const role = ROLES.find((known) => known === row.role);
  // members_role CHECK makes this unreachable; fail closed if the roles ever drift apart.
  if (!role) throw new Error("member has an unknown role");
  return { ...row, role };
}

/** Adds a user to the context's business. Better Auth adds invited members itself (4c). */
export async function insertMember(
  db: Executor,
  ctx: TenantContext,
  input: { userId: string; role: Role },
): Promise<void> {
  await db.insert(members).values({ ...input, businessId: ctx.businessId });
}

/**
 * The signed-in user's membership of the business at `slug`, or undefined. This and
 * `listMemberships` are the only tenant reads without a TenantContext: they are how one is
 * built, and they are scoped by the user instead (ADR 0004).
 */
export async function findMembership(
  db: Executor,
  userId: string,
  slug: string,
): Promise<Membership | undefined> {
  const [row] = await db
    .select(membershipColumns)
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(and(eq(members.userId, userId), eq(businesses.slug, slug)));
  return row && toMembership(row);
}

export async function listMemberships(db: Executor, userId: string): Promise<Membership[]> {
  const rows = await db
    .select(membershipColumns)
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(eq(members.userId, userId))
    .orderBy(asc(businesses.legalName), asc(businesses.id));
  return rows.map(toMembership);
}
