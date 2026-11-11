import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { customers, invoices, paymentAllocations, payments } from "../schema";
import { type Executor, type Transaction } from "../transaction";
import { type DateCursor } from "./cursor";
import { refundedTotal } from "./refunds.repo";
import { type TenantOwned, tenantScope } from "./tenant";

export type Payment = typeof payments.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type NewPayment = Omit<
  typeof payments.$inferInsert,
  TenantOwned | "voidedAt" | "voidedBy" | "voidReason"
>;
export type NewAllocation = Pick<
  typeof paymentAllocations.$inferInsert,
  "paymentId" | "invoiceId" | "customerId" | "amountPaise"
>;

// Payments are never updated except to void them, and never deleted (a DB trigger refuses).

export async function insertPayment(
  tx: Transaction,
  ctx: TenantContext,
  values: NewPayment,
): Promise<Payment> {
  const [row] = await tx
    .insert(payments)
    .values({ ...values, businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/**
 * Writes allocations; one that already exists for the same payment and invoice (or opening
 * balance) grows by the new amount, so the unique key holds ("Apply advance" twice).
 */
export async function insertAllocations(
  tx: Transaction,
  ctx: TenantContext,
  rows: readonly NewAllocation[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(paymentAllocations)
    .values(rows.map((row) => ({ ...row, businessId: ctx.businessId, createdBy: ctx.userId })))
    .onConflictDoUpdate({
      target: [
        paymentAllocations.businessId,
        paymentAllocations.paymentId,
        paymentAllocations.invoiceId,
      ],
      set: {
        amountPaise: sql`${paymentAllocations.amountPaise} + excluded.amount_paise`,
        updatedAt: sql`now()`,
      },
    });
}

export async function findPaymentById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Payment | undefined> {
  const [row] = await db
    .select()
    .from(payments)
    .where(tenantScope(ctx, payments, eq(payments.id, id)));
  return row;
}

/** Reads the payment and locks it until the transaction ends (voiding). */
export async function lockPayment(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Payment | undefined> {
  const [row] = await tx
    .select()
    .from(payments)
    .where(tenantScope(ctx, payments, eq(payments.id, id)))
    .for("update");
  return row;
}

export async function markVoided(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
  values: { voidedAt: Date; voidReason: string },
): Promise<Payment | undefined> {
  const [row] = await tx
    .update(payments)
    .set({ ...values, voidedBy: ctx.userId })
    .where(tenantScope(ctx, payments, eq(payments.id, id), isNull(payments.voidedAt)))
    .returning();
  return row;
}

export interface AllocationRow {
  paymentId: string | null;
  invoiceId: string | null;
  /** The invoice's number; null for the opening balance. */
  invoiceNumber: string | null;
  amountPaise: bigint;
}

/** The allocations of some payments, invoices oldest first. */
export async function findAllocationsForPayments(
  db: Executor,
  ctx: TenantContext,
  paymentIds: readonly string[],
): Promise<AllocationRow[]> {
  if (paymentIds.length === 0) return [];
  return db
    .select({
      paymentId: paymentAllocations.paymentId,
      invoiceId: paymentAllocations.invoiceId,
      invoiceNumber: invoices.number,
      amountPaise: paymentAllocations.amountPaise,
    })
    .from(paymentAllocations)
    .leftJoin(
      invoices,
      and(
        eq(invoices.businessId, paymentAllocations.businessId),
        eq(invoices.id, paymentAllocations.invoiceId),
      ),
    )
    .where(tenantScope(ctx, paymentAllocations, inArray(paymentAllocations.paymentId, paymentIds)))
    .orderBy(asc(invoices.invoiceDate), asc(invoices.number));
}

export interface InvoicePaymentRow {
  /** Null when the money came from the customer's opening advance. */
  paymentId: string | null;
  paymentDate: string | null;
  mode: Payment["mode"] | null;
  reference: string | null;
  voidedAt: Date | null;
  amountPaise: bigint;
}

/** What paid an invoice, voided payments included (shown struck through), oldest first. */
export async function findPaymentsForInvoice(
  db: Executor,
  ctx: TenantContext,
  invoiceId: string,
): Promise<InvoicePaymentRow[]> {
  return db
    .select({
      paymentId: paymentAllocations.paymentId,
      paymentDate: payments.paymentDate,
      mode: payments.mode,
      reference: payments.reference,
      voidedAt: payments.voidedAt,
      amountPaise: paymentAllocations.amountPaise,
    })
    .from(paymentAllocations)
    .leftJoin(
      payments,
      and(
        eq(payments.businessId, paymentAllocations.businessId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(tenantScope(ctx, paymentAllocations, eq(paymentAllocations.invoiceId, invoiceId)))
    .orderBy(asc(payments.paymentDate), asc(paymentAllocations.createdAt));
}

// Written with explicit table names: in a select list Drizzle leaves columns unqualified, and an
// unqualified "id" inside the subquery would mean the allocation's own id.
const allocatedToPayment = sql<bigint>`coalesce((
  select sum(a.amount_paise) from ${paymentAllocations} a
  where a.business_id = "payments"."business_id" and a.payment_id = "payments"."id"
), 0)`.mapWith((value: string | number) => BigInt(value));

export interface CreditSums {
  appliedToOpeningPaise: bigint;
  appliedFromOpeningPaise: bigint;
  unallocatedPaise: bigint;
  refundedPaise: bigint;
}

/** The sums `customerCredit` needs, for live payments and refunds only. */
export async function customerCreditSums(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<CreditSums> {
  const [opening] = await db
    .select({
      to: sql<string>`coalesce(sum(${paymentAllocations.amountPaise}) filter (where ${paymentAllocations.invoiceId} is null), 0)`,
      from: sql<string>`coalesce(sum(${paymentAllocations.amountPaise}) filter (where ${paymentAllocations.paymentId} is null), 0)`,
    })
    .from(paymentAllocations)
    .leftJoin(
      payments,
      and(
        eq(payments.businessId, paymentAllocations.businessId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(
      tenantScope(
        ctx,
        paymentAllocations,
        eq(paymentAllocations.customerId, customerId),
        or(isNull(paymentAllocations.paymentId), isNull(payments.voidedAt)),
      ),
    );
  const [unallocated, refunded] = await Promise.all([
    unallocatedPayments(db, ctx, customerId),
    refundedTotal(db, ctx, customerId),
  ]);
  return {
    appliedToOpeningPaise: BigInt(opening?.to ?? "0"),
    appliedFromOpeningPaise: BigInt(opening?.from ?? "0"),
    unallocatedPaise: unallocated.reduce((sum, row) => sum + row.availablePaise, 0n),
    refundedPaise: refunded,
  };
}

export interface UnallocatedPayment {
  paymentId: string;
  paymentDate: string;
  availablePaise: bigint;
}

/** The customer's live payments with money not yet allocated, oldest first. */
export async function unallocatedPayments(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<UnallocatedPayment[]> {
  const rows = await db
    .select({
      paymentId: payments.id,
      paymentDate: payments.paymentDate,
      amountPaise: payments.amountPaise,
      allocatedPaise: allocatedToPayment,
    })
    .from(payments)
    .where(
      tenantScope(
        ctx,
        payments,
        eq(payments.customerId, customerId),
        isNull(payments.voidedAt),
        sql`${payments.amountPaise} > ${allocatedToPayment}`,
      ),
    )
    .orderBy(asc(payments.paymentDate), asc(payments.id));
  return rows.map((row) => ({
    paymentId: row.paymentId,
    paymentDate: row.paymentDate,
    availablePaise: row.amountPaise - row.allocatedPaise,
  }));
}

export interface ListPaymentsOptions {
  customerId?: string;
  from?: string;
  to?: string;
  limit: number;
  /** Keyset pagination (newest first): rows after this one. */
  after?: DateCursor;
}

export interface PaymentListRow {
  payment: Payment;
  /** The customer's current name; null for a walk-in payment. */
  customerName: string | null;
  allocatedPaise: bigint;
}

/** Payments newest first, voided ones included (the list shows them struck through). */
export async function listPayments(
  db: Executor,
  ctx: TenantContext,
  options: ListPaymentsOptions,
): Promise<PaymentListRow[]> {
  const conditions: (SQL | undefined)[] = [
    options.customerId ? eq(payments.customerId, options.customerId) : undefined,
    options.from ? gte(payments.paymentDate, options.from) : undefined,
    options.to ? lte(payments.paymentDate, options.to) : undefined,
    options.after
      ? or(
          sql`${payments.paymentDate} < ${options.after.date}`,
          and(
            eq(payments.paymentDate, options.after.date),
            sql`${payments.id} < ${options.after.id}`,
          ),
        )
      : undefined,
  ];
  return db
    .select({
      payment: payments,
      customerName: customers.name,
      allocatedPaise: allocatedToPayment,
    })
    .from(payments)
    .leftJoin(
      customers,
      and(eq(customers.businessId, payments.businessId), eq(customers.id, payments.customerId)),
    )
    .where(tenantScope(ctx, payments, ...conditions))
    .orderBy(desc(payments.paymentDate), desc(payments.id))
    .limit(options.limit);
}

export interface LiveAllocation {
  id: string;
  /** Null = from the customer's opening advance. */
  paymentId: string | null;
  paymentDate: string | null;
  amountPaise: bigint;
}

/** What pays an invoice now: its allocations from live payments and the opening advance. */
export async function liveAllocationsForInvoice(
  db: Executor,
  ctx: TenantContext,
  invoiceId: string,
): Promise<LiveAllocation[]> {
  return db
    .select({
      id: paymentAllocations.id,
      paymentId: paymentAllocations.paymentId,
      paymentDate: payments.paymentDate,
      amountPaise: paymentAllocations.amountPaise,
    })
    .from(paymentAllocations)
    .leftJoin(
      payments,
      and(
        eq(payments.businessId, paymentAllocations.businessId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(
      tenantScope(
        ctx,
        paymentAllocations,
        eq(paymentAllocations.invoiceId, invoiceId),
        or(isNull(paymentAllocations.paymentId), isNull(payments.voidedAt)),
      ),
    );
}

/**
 * Takes `amountPaise` back from one allocation (a credit note on a paid invoice, ADR 0011): the
 * row shrinks, or goes when nothing is left. The money becomes the payment's unallocated part.
 */
export async function releaseAllocation(
  tx: Transaction,
  ctx: TenantContext,
  allocation: Pick<LiveAllocation, "id" | "amountPaise">,
  amountPaise: bigint,
): Promise<void> {
  const where = tenantScope(ctx, paymentAllocations, eq(paymentAllocations.id, allocation.id));
  if (amountPaise >= allocation.amountPaise) {
    await tx.delete(paymentAllocations).where(where);
    return;
  }
  await tx
    .update(paymentAllocations)
    .set({ amountPaise: allocation.amountPaise - amountPaise, updatedAt: sql`now()` })
    .where(where);
}
