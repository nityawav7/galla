import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { refunds } from "../schema";
import { type Executor, type Transaction } from "../transaction";
import { type TenantOwned, tenantScope } from "./tenant";

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = Omit<
  typeof refunds.$inferInsert,
  TenantOwned | "voidedAt" | "voidedBy" | "voidReason"
>;

// Refunds are never updated except to void them, and never deleted (a DB trigger refuses).

export async function insertRefund(
  tx: Transaction,
  ctx: TenantContext,
  values: NewRefund,
): Promise<Refund> {
  const [row] = await tx
    .insert(refunds)
    .values({ ...values, businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function findRefundById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Refund | undefined> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(tenantScope(ctx, refunds, eq(refunds.id, id)));
  return row;
}

/** Reads the refund and locks it until the transaction ends (voiding). */
export async function lockRefund(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Refund | undefined> {
  const [row] = await tx
    .select()
    .from(refunds)
    .where(tenantScope(ctx, refunds, eq(refunds.id, id)))
    .for("update");
  return row;
}

export async function markRefundVoided(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
  values: { voidedAt: Date; voidReason: string },
): Promise<Refund | undefined> {
  const [row] = await tx
    .update(refunds)
    .set({ ...values, voidedBy: ctx.userId, updatedAt: sql`now()` })
    .where(tenantScope(ctx, refunds, eq(refunds.id, id), isNull(refunds.voidedAt)))
    .returning();
  return row;
}

/** A customer's refunds, newest first, voided ones too (the customer page lists them). */
export function listCustomerRefunds(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<Refund[]> {
  return db
    .select()
    .from(refunds)
    .where(tenantScope(ctx, refunds, eq(refunds.customerId, customerId)))
    .orderBy(desc(refunds.refundDate), desc(refunds.id));
}

/** The refund given at the counter for a walk-in credit note, if any. */
export function refundsForCreditNote(
  db: Executor,
  ctx: TenantContext,
  creditNoteId: string,
): Promise<Refund[]> {
  return db
    .select()
    .from(refunds)
    .where(tenantScope(ctx, refunds, eq(refunds.creditNoteId, creditNoteId)))
    .orderBy(asc(refunds.createdAt));
}

/** Σ of the customer's live refunds. */
export async function refundedTotal(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${refunds.amountPaise}), 0)` })
    .from(refunds)
    .where(
      tenantScope(ctx, refunds, and(eq(refunds.customerId, customerId), isNull(refunds.voidedAt))),
    );
  return BigInt(row?.total ?? "0");
}
