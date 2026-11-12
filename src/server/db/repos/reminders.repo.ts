import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";
import { type ReminderKind } from "@/server/domain/reminders/schedule";

import { customers, invoices, ownerDigestsSent, remindersSent } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

/*
 * What the daily job reads and records in one business (SPEC F9). Rows written here are the
 * job's own, so `created_by` is null (system), whatever the context's user id.
 */

const balance = sql`${invoices.grandTotalPaise} - ${invoices.amountPaidPaise} - ${invoices.amountCreditedPaise}`;
const live = sql`${invoices.status} in ('ISSUED', 'PARTIALLY_PAID')`;
/** The date an invoice counts as due from: its due date, or the invoice date if due on receipt. */
const dueFrom = sql`coalesce(${invoices.dueDate}, ${invoices.invoiceDate})`;

export interface ReminderCandidate {
  invoiceId: string;
  number: string;
  invoiceDate: string;
  dueDate: string | null;
  balancePaise: bigint;
  publicToken: string | null;
  tokenRevokedAt: Date | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  /** EMAIL reminders already sent for this invoice. */
  sent: ReminderKind[];
}

/**
 * Live invoices with something due, of customers with an email, that fell due between `from`
 * and `today` (business dates), with the email reminders they already had.
 */
export async function findReminderCandidates(
  db: Executor,
  ctx: TenantContext,
  range: { from: string; today: string },
): Promise<ReminderCandidate[]> {
  const rows = await db
    .select({
      invoiceId: invoices.id,
      number: invoices.number,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      balance: sql<string>`(${balance})::text`,
      publicToken: invoices.publicToken,
      tokenRevokedAt: invoices.tokenRevokedAt,
      customerId: customers.id,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(invoices)
    .innerJoin(
      customers,
      and(eq(customers.businessId, invoices.businessId), eq(customers.id, invoices.customerId)),
    )
    .where(
      tenantScope(
        ctx,
        invoices,
        live,
        sql`${balance} > 0`,
        isNotNull(customers.email),
        sql`${dueFrom} between ${range.from} and ${range.today}`,
      ),
    )
    .orderBy(asc(dueFrom), asc(invoices.number));
  if (rows.length === 0) return [];

  const sent = await db
    .select({ invoiceId: remindersSent.invoiceId, kind: remindersSent.kind })
    .from(remindersSent)
    .where(
      tenantScope(
        ctx,
        remindersSent,
        eq(remindersSent.channel, "EMAIL"),
        inArray(
          remindersSent.invoiceId,
          rows.map((row) => row.invoiceId),
        ),
      ),
    );
  const sentByInvoice = new Map<string, ReminderKind[]>();
  for (const row of sent) {
    sentByInvoice.set(row.invoiceId, [...(sentByInvoice.get(row.invoiceId) ?? []), row.kind]);
  }
  return rows.flatMap((row) =>
    row.number !== null && row.customerEmail !== null
      ? [
          {
            ...row,
            number: row.number,
            customerEmail: row.customerEmail,
            balancePaise: BigInt(row.balance),
            sent: sentByInvoice.get(row.invoiceId) ?? [],
          },
        ]
      : [],
  );
}

export interface ReminderClaim {
  id: string;
  invoiceId: string;
  kind: ReminderKind;
}

/**
 * Records email reminders before they are sent. Rows another run already holds are skipped
 * (the unique key), so only what this call returns may be sent (decision 9).
 */
export async function claimEmailReminders(
  db: Executor,
  ctx: TenantContext,
  items: readonly { invoiceId: string; kind: ReminderKind }[],
): Promise<ReminderClaim[]> {
  if (items.length === 0) return [];
  return db
    .insert(remindersSent)
    .values(
      items.map((item) => ({
        ...item,
        channel: "EMAIL" as const,
        businessId: ctx.businessId,
        createdBy: null,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: remindersSent.id,
      invoiceId: remindersSent.invoiceId,
      kind: remindersSent.kind,
    });
}

/** Gives claims back after a failed send, so the next run tries again. */
export async function releaseEmailReminders(
  db: Executor,
  ctx: TenantContext,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(remindersSent)
    .where(tenantScope(ctx, remindersSent, inArray(remindersSent.id, [...ids])));
}

export interface OverdueCustomer {
  customerId: string;
  name: string;
  overduePaise: bigint;
  invoices: number;
}

/** Customers with live invoices past due before `today`, the most overdue first. */
export async function findOverdueByCustomer(
  db: Executor,
  ctx: TenantContext,
  today: string,
): Promise<OverdueCustomer[]> {
  const overdue = sql<string>`sum(${balance})::text`;
  const rows = await db
    .select({
      customerId: customers.id,
      name: customers.name,
      overdue,
      invoices: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .innerJoin(
      customers,
      and(eq(customers.businessId, invoices.businessId), eq(customers.id, invoices.customerId)),
    )
    .where(tenantScope(ctx, invoices, live, sql`${balance} > 0`, sql`${dueFrom} < ${today}`))
    .groupBy(customers.id, customers.name)
    .orderBy(desc(sql`sum(${balance})`), asc(customers.name), asc(customers.id));
  return rows.map((row) => ({
    customerId: row.customerId,
    name: row.name,
    overduePaise: BigInt(row.overdue),
    invoices: row.invoices,
  }));
}

/** Records today's owner digest; false when it was already recorded (sent or being sent). */
export async function claimOwnerDigest(
  db: Executor,
  ctx: TenantContext,
  digestDate: string,
): Promise<boolean> {
  const rows = await db
    .insert(ownerDigestsSent)
    .values({ businessId: ctx.businessId, digestDate, createdBy: null })
    .onConflictDoNothing()
    .returning({ id: ownerDigestsSent.id });
  return rows.length > 0;
}

export async function releaseOwnerDigest(
  db: Executor,
  ctx: TenantContext,
  digestDate: string,
): Promise<void> {
  await db
    .delete(ownerDigestsSent)
    .where(tenantScope(ctx, ownerDigestsSent, eq(ownerDigestsSent.digestDate, digestDate)));
}
