import { and, between, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import {
  auditLogs,
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  payments,
} from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

/*
 * The dashboard's aggregates (SPEC F8). One query per card or chart, every one filtered by
 * `business_id`; dates are business dates (`date` columns, Asia/Kolkata). Cancelled invoices
 * and drafts never count; credit notes reduce sales on their own date. Phase 9's performance test
 * runs these against 10,000 invoices.
 */

const liveInvoice = sql`${invoices.status} in ('ISSUED', 'PARTIALLY_PAID', 'PAID')`;
const invoiceTax = sql`${invoices.cgstPaise} + ${invoices.sgstPaise} + ${invoices.utgstPaise} + ${invoices.igstPaise}`;
const noteTax = sql`${creditNotes.cgstPaise} + ${creditNotes.sgstPaise} + ${creditNotes.utgstPaise} + ${creditNotes.igstPaise}`;

export interface SalesWindow {
  today: string;
  monthStart: string;
  /** The first day of the 30-day chart. */
  since: string;
}

export interface SalesTotals {
  todayPaise: bigint;
  monthPaise: bigint;
  monthTaxPaise: bigint;
  invoicesToday: number;
  invoicesThisMonth: number;
}

const big = (value: string | null | undefined) => BigInt(value ?? "0");

/** Today's and this month's net sales and output tax: invoices less credit notes. */
export async function salesTotals(
  db: Executor,
  ctx: TenantContext,
  window: SalesWindow,
): Promise<SalesTotals> {
  const [billed] = await db
    .select({
      today: sql<string>`coalesce(sum(${invoices.grandTotalPaise}) filter (where ${invoices.invoiceDate} = ${window.today}), 0)`,
      month: sql<string>`coalesce(sum(${invoices.grandTotalPaise}), 0)`,
      tax: sql<string>`coalesce(sum(${invoiceTax}), 0)`,
      countToday: sql<number>`(count(*) filter (where ${invoices.invoiceDate} = ${window.today}))::int`,
      countMonth: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      tenantScope(
        ctx,
        invoices,
        liveInvoice,
        between(invoices.invoiceDate, window.monthStart, window.today),
      ),
    );
  const [credited] = await db
    .select({
      today: sql<string>`coalesce(sum(${creditNotes.grandTotalPaise}) filter (where ${creditNotes.noteDate} = ${window.today}), 0)`,
      month: sql<string>`coalesce(sum(${creditNotes.grandTotalPaise}), 0)`,
      tax: sql<string>`coalesce(sum(${noteTax}), 0)`,
    })
    .from(creditNotes)
    .where(
      tenantScope(ctx, creditNotes, between(creditNotes.noteDate, window.monthStart, window.today)),
    );
  return {
    todayPaise: big(billed?.today) - big(credited?.today),
    monthPaise: big(billed?.month) - big(credited?.month),
    monthTaxPaise: big(billed?.tax) - big(credited?.tax),
    invoicesToday: billed?.countToday ?? 0,
    invoicesThisMonth: billed?.countMonth ?? 0,
  };
}

export interface DayNet {
  date: string;
  valuePaise: bigint;
}

/** Net sales per day from `since` to `today`: invoices positive, credit notes negative. */
export async function dailyNetSales(
  db: Executor,
  ctx: TenantContext,
  window: SalesWindow,
): Promise<DayNet[]> {
  const billed = await db
    .select({ date: invoices.invoiceDate, total: sql<string>`sum(${invoices.grandTotalPaise})` })
    .from(invoices)
    .where(
      tenantScope(
        ctx,
        invoices,
        liveInvoice,
        between(invoices.invoiceDate, window.since, window.today),
      ),
    )
    .groupBy(invoices.invoiceDate);
  const credited = await db
    .select({ date: creditNotes.noteDate, total: sql<string>`sum(${creditNotes.grandTotalPaise})` })
    .from(creditNotes)
    .where(tenantScope(ctx, creditNotes, between(creditNotes.noteDate, window.since, window.today)))
    .groupBy(creditNotes.noteDate);
  return [
    ...billed.map((row) => ({ date: row.date, valuePaise: big(row.total) })),
    ...credited.map((row) => ({ date: row.date, valuePaise: -big(row.total) })),
  ];
}

export interface ProductSales {
  /** The product id, or `line:<description>` for one-off items. */
  key: string;
  name: string;
  unit: string;
  taxablePaise: bigint;
  qtyMilli: bigint;
}

const lineKey = (productId: unknown, description: unknown) =>
  sql<string>`coalesce(${productId}::text, 'line:' || ${description})`;

/** Taxable value and quantity sold per product since `since`, less what was credited back. */
export async function productSales(
  db: Executor,
  ctx: TenantContext,
  window: SalesWindow,
): Promise<ProductSales[]> {
  const sold = await db
    .select({
      key: lineKey(invoiceLines.productId, invoiceLines.description),
      name: sql<string>`max(${invoiceLines.description})`,
      unit: sql<string>`max(${invoiceLines.unit})`,
      taxable: sql<string>`sum(${invoiceLines.taxablePaise})`,
      qty: sql<string>`sum(${invoiceLines.qtyMilli})`,
    })
    .from(invoiceLines)
    .innerJoin(
      invoices,
      and(
        eq(invoices.businessId, invoiceLines.businessId),
        eq(invoices.id, invoiceLines.invoiceId),
      ),
    )
    .where(
      tenantScope(
        ctx,
        invoiceLines,
        liveInvoice,
        between(invoices.invoiceDate, window.since, window.today),
      ),
    )
    .groupBy(lineKey(invoiceLines.productId, invoiceLines.description));
  const returned = await db
    .select({
      key: lineKey(creditNoteLines.productId, creditNoteLines.description),
      taxable: sql<string>`sum(${creditNoteLines.taxablePaise})`,
      qty: sql<string>`sum(${creditNoteLines.qtyMilli})`,
    })
    .from(creditNoteLines)
    .innerJoin(
      creditNotes,
      and(
        eq(creditNotes.businessId, creditNoteLines.businessId),
        eq(creditNotes.id, creditNoteLines.creditNoteId),
      ),
    )
    .where(
      tenantScope(ctx, creditNoteLines, between(creditNotes.noteDate, window.since, window.today)),
    )
    .groupBy(lineKey(creditNoteLines.productId, creditNoteLines.description));
  const back = new Map(returned.map((row) => [row.key, row]));
  return sold.map((row) => ({
    key: row.key,
    name: row.name,
    unit: row.unit,
    taxablePaise: big(row.taxable) - big(back.get(row.key)?.taxable),
    qtyMilli: big(row.qty) - big(back.get(row.key)?.qty),
  }));
}

export interface Receivables {
  /** Σ positive customer balances + walk-in invoice balances. */
  receivablePaise: bigint;
  /** Σ advances customers hold (negative balances), shown apart. */
  advancesPaise: bigint;
  topDebtors: { customerId: string; name: string; balancePaise: bigint }[];
}

/**
 * Every customer's ledger balance (opening + invoices − credit notes − payments + refunds, as in
 * ADR 0010/0011) in one pass, plus walk-in invoices still unpaid.
 */
export async function receivables(
  db: Executor,
  ctx: TenantContext,
  top: number,
): Promise<Receivables> {
  const biz = ctx.businessId;
  const result = await db.execute<{
    customer_id: string;
    name: string;
    balance: string;
  }>(sql`
    with
      billed as (
        select customer_id, sum(grand_total_paise) as total from invoices
        where business_id = ${biz} and customer_id is not null
          and status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
        group by customer_id),
      credited as (
        select customer_id, sum(grand_total_paise) as total from credit_notes
        where business_id = ${biz} and customer_id is not null group by customer_id),
      paid as (
        select customer_id, sum(amount_paise) as total from payments
        where business_id = ${biz} and customer_id is not null and voided_at is null
        group by customer_id),
      refunded as (
        select customer_id, sum(amount_paise) as total from refunds
        where business_id = ${biz} and customer_id is not null and voided_at is null
        group by customer_id)
    select c.id as customer_id, c.name,
      (c.opening_balance_paise + coalesce(b.total, 0) - coalesce(cr.total, 0)
        - coalesce(p.total, 0) + coalesce(r.total, 0))::text as balance
    from customers c
      left join billed b on b.customer_id = c.id
      left join credited cr on cr.customer_id = c.id
      left join paid p on p.customer_id = c.id
      left join refunded r on r.customer_id = c.id
    where c.business_id = ${biz}
  `);
  const [walkIn] = await db
    .select({
      due: sql<string>`coalesce(sum(${invoices.grandTotalPaise} - ${invoices.amountPaidPaise} - ${invoices.amountCreditedPaise}), 0)`,
    })
    .from(invoices)
    .where(tenantScope(ctx, invoices, liveInvoice, isNull(invoices.customerId)));
  let receivable = big(walkIn?.due);
  let advances = 0n;
  const owing: Receivables["topDebtors"] = [];
  for (const row of result.rows) {
    const balance = BigInt(row.balance);
    if (balance > 0n) {
      receivable += balance;
      owing.push({ customerId: row.customer_id, name: row.name, balancePaise: balance });
    } else {
      advances -= balance;
    }
  }
  owing.sort(
    (a, b) =>
      (a.balancePaise === b.balancePaise ? 0 : a.balancePaise > b.balancePaise ? -1 : 1) ||
      a.name.localeCompare(b.name, "en"),
  );
  return { receivablePaise: receivable, advancesPaise: advances, topDebtors: owing.slice(0, top) };
}

export interface OpenInvoiceDue {
  invoiceDate: string;
  dueDate: string | null;
  balancePaise: bigint;
}

/** Every live invoice with something still due (for aging and the overdue card). */
export async function openInvoiceBalances(
  db: Executor,
  ctx: TenantContext,
): Promise<OpenInvoiceDue[]> {
  const rows = await db
    .select({
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      balance: sql<string>`(${invoices.grandTotalPaise} - ${invoices.amountPaidPaise} - ${invoices.amountCreditedPaise})::text`,
    })
    .from(invoices)
    .where(
      tenantScope(
        ctx,
        invoices,
        sql`${invoices.status} in ('ISSUED', 'PARTIALLY_PAID')`,
        sql`${invoices.grandTotalPaise} - ${invoices.amountPaidPaise} - ${invoices.amountCreditedPaise} > 0`,
      ),
    );
  return rows.map((row) => ({
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    balancePaise: BigInt(row.balance),
  }));
}

/** Σ opening balances still owed across customers (what payments haven't paid of them). */
export async function openingOwed(db: Executor, ctx: TenantContext): Promise<bigint> {
  const biz = ctx.businessId;
  const result = await db.execute<{ owed: string }>(sql`
    select (
      coalesce((select sum(opening_balance_paise) from customers
        where business_id = ${biz} and opening_balance_paise > 0), 0)
      - coalesce((select sum(a.amount_paise) from payment_allocations a
          join payments p on p.business_id = a.business_id and p.id = a.payment_id
          where a.business_id = ${biz} and a.invoice_id is null and p.voided_at is null), 0)
    )::text as owed
  `);
  return big(result.rows[0]?.owed);
}

export interface ReminderRow {
  customerId: string;
  at: Date;
  overduePaise: bigint;
}

/** The WhatsApp reminders opened since `since` (audit rows `customer.reminderShared`, Phase 8c). */
export async function remindersSince(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<ReminderRow[]> {
  const rows = await db
    .select({ entityId: auditLogs.entityId, at: auditLogs.at, diff: auditLogs.diff })
    .from(auditLogs)
    .where(
      tenantScope(
        ctx,
        auditLogs,
        eq(auditLogs.action, "customer.reminderShared"),
        gte(auditLogs.at, since),
      ),
    );
  return rows.map((row) => {
    const after = (row.diff as { after?: { overduePaise?: unknown } } | null)?.after;
    const overdue = typeof after?.overduePaise === "string" ? after.overduePaise : "0";
    return {
      customerId: row.entityId,
      at: row.at,
      overduePaise: /^\d+$/.test(overdue) ? BigInt(overdue) : 0n,
    };
  });
}

/** Live payments by these customers dated `since` or later. */
export async function customerPaymentsSince(
  db: Executor,
  ctx: TenantContext,
  customerIds: readonly string[],
  since: string,
): Promise<{ customerId: string; date: string; amountPaise: bigint }[]> {
  if (customerIds.length === 0) return [];
  const rows = await db
    .select({
      customerId: payments.customerId,
      date: payments.paymentDate,
      amountPaise: payments.amountPaise,
    })
    .from(payments)
    .where(
      tenantScope(
        ctx,
        payments,
        inArray(payments.customerId, [...customerIds]),
        isNull(payments.voidedAt),
        gte(payments.paymentDate, since),
      ),
    );
  return rows.flatMap((row) => (row.customerId ? [{ ...row, customerId: row.customerId }] : []));
}

/** Overdue invoices (due before today, something still due), counted for staff. */
export async function overdueInvoiceCount(
  db: Executor,
  ctx: TenantContext,
  today: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(invoices)
    .where(
      tenantScope(
        ctx,
        invoices,
        sql`${invoices.status} in ('ISSUED', 'PARTIALLY_PAID')`,
        sql`coalesce(${invoices.dueDate}, ${invoices.invoiceDate}) < ${today}`,
        sql`${invoices.grandTotalPaise} - ${invoices.amountPaidPaise} - ${invoices.amountCreditedPaise} > 0`,
      ),
    );
  return row?.value ?? 0;
}
