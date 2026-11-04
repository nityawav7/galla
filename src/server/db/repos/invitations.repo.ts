import { and, asc, eq, gt } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { invitations } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

export type Invitation = typeof invitations.$inferSelect;

/** Invitations still waiting for an answer, oldest first. Better Auth writes these rows. */
export function listPendingInvitations(
  db: Executor,
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<Invitation[]> {
  return db
    .select()
    .from(invitations)
    .where(
      tenantScope(
        ctx,
        invitations,
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(asc(invitations.createdAt), asc(invitations.id));
}

export async function findInvitationById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Invitation | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(tenantScope(ctx, invitations), eq(invitations.id, id)));
  return row;
}
