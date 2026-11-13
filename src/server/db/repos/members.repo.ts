import { and, asc, eq } from "drizzle-orm";

import { ROLES, type Role, type TenantContext } from "@/server/authz/context";

import { businesses, members, users } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

/** A user's membership of one business, with what the app shell shows about it. */
export interface Membership {
  businessId: string;
  slug: string;
  legalName: string;
  tradeName: string | null;
  role: Role;
  /** The shared demo shop (SPEC F12): the shell shows a banner, settings are read-only. */
  isDemo: boolean;
}

const membershipColumns = {
  businessId: businesses.id,
  slug: businesses.slug,
  legalName: businesses.legalName,
  tradeName: businesses.tradeName,
  role: members.role,
  isDemo: businesses.isDemo,
};

function toRole(value: string): Role {
  const role = ROLES.find((known) => known === value);
  // members_role CHECK makes this unreachable; fail closed if the roles ever drift apart.
  if (!role) throw new Error("member has an unknown role");
  return role;
}

function toMembership(row: { role: string } & Omit<Membership, "role">): Membership {
  return { ...row, role: toRole(row.role) };
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

/** A member of the context's business, with the user's name and email for the members page. */
export interface MemberWithUser {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
}

export async function listMembersWithUsers(
  db: Executor,
  ctx: TenantContext,
): Promise<MemberWithUser[]> {
  const rows = await db
    .select({
      memberId: members.id,
      userId: members.userId,
      name: users.name,
      email: users.email,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(tenantScope(ctx, members))
    .orderBy(asc(members.createdAt), asc(members.id));
  return rows.map((row) => ({ ...row, role: toRole(row.role) }));
}

export async function findMemberById(
  db: Executor,
  ctx: TenantContext,
  memberId: string,
): Promise<{ memberId: string; userId: string; role: Role } | undefined> {
  const [row] = await db
    .select({ memberId: members.id, userId: members.userId, role: members.role })
    .from(members)
    .where(and(tenantScope(ctx, members), eq(members.id, memberId)));
  return row && { ...row, role: toRole(row.role) };
}

/** A user's email, to tell the demo's own users apart (SPEC F12). Users aren't a tenant table. */
export async function findUserEmail(db: Executor, userId: string): Promise<string | undefined> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return row?.email;
}
