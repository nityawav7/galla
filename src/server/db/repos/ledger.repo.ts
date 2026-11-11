import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { creditNotes, customers, invoices, payments, refunds } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

/*
 * What the customer ledger reads (SPEC §4.9). Cancelled invoices and voided payments are left
 * out: they were never owed or never happened (decisions 6 and 7 of the Phase 8 plan).
 */

export interface LedgerInvoiceRow {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string | null;
  grandTotalPaise: bigint;
  amountPaidPaise: bigint;
  amountCreditedPaise: bigint;
}

const liveInvoice = and(
  inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID", "PAID"]),
  isNotNull(invoices.number),
);

export async function ledgerInvoices(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<LedgerInvoiceRow[]> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      grandTotalPaise: invoices.grandTotalPaise,
      amountPaidPaise: invoices.amountPaidPaise,
      amountCreditedPaise: invoices.amountCreditedPaise,
    })
    .from(invoices)
    .where(tenantScope(ctx, invoices, eq(invoices.customerId, customerId), liveInvoice))
    .orderBy(asc(invoices.invoiceDate), asc(invoices.number));
  return rows.map((row) => ({ ...row, number: row.number ?? "" }));
}

export interface LedgerCreditNoteRow {
  id: string;
  number: string;
  noteDate: string;
  invoiceId: string;
  grandTotalPaise: bigint;
}

export function ledgerCreditNotes(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<LedgerCreditNoteRow[]> {
  return db
    .select({
      id: creditNotes.id,
      number: creditNotes.number,
      noteDate: creditNotes.noteDate,
      invoiceId: creditNotes.invoiceId,
      grandTotalPaise: creditNotes.grandTotalPaise,
    })
    .from(creditNotes)
    .where(tenantScope(ctx, creditNotes, eq(creditNotes.customerId, customerId)))
    .orderBy(asc(creditNotes.noteDate), asc(creditNotes.number));
}

export interface LedgerPaymentRow {
  id: string;
  paymentDate: string;
  amountPaise: bigint;
  mode: (typeof payments.$inferSelect)["mode"];
  reference: string | null;
}

export function ledgerPayments(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<LedgerPaymentRow[]> {
  return db
    .select({
      id: payments.id,
      paymentDate: payments.paymentDate,
      amountPaise: payments.amountPaise,
      mode: payments.mode,
      reference: payments.reference,
    })
    .from(payments)
    .where(
      tenantScope(ctx, payments, eq(payments.customerId, customerId), isNull(payments.voidedAt)),
    )
    .orderBy(asc(payments.paymentDate), asc(payments.id));
}

/**
 * Each customer's ledger balance (opening + invoices − credit notes − payments + refunds) in one
 * query, for
 * a page of the customer list. Customers of another business are simply not found.
 */
export async function customerBalances(
  db: Executor,
  ctx: TenantContext,
  customerIds: readonly string[],
): Promise<Map<string, bigint>> {
  if (customerIds.length === 0) return new Map();
  const invoiced = db
    .select({
      customerId: invoices.customerId,
      total: sql<string>`sum(${invoices.grandTotalPaise})`.as("invoiced_total"),
    })
    .from(invoices)
    .where(tenantScope(ctx, invoices, inArray(invoices.customerId, [...customerIds]), liveInvoice))
    .groupBy(invoices.customerId)
    .as("invoiced");
  const credited = db
    .select({
      customerId: creditNotes.customerId,
      total: sql<string>`sum(${creditNotes.grandTotalPaise})`.as("credited_total"),
    })
    .from(creditNotes)
    .where(tenantScope(ctx, creditNotes, inArray(creditNotes.customerId, [...customerIds])))
    .groupBy(creditNotes.customerId)
    .as("credited");
  const paid = db
    .select({
      customerId: payments.customerId,
      total: sql<string>`sum(${payments.amountPaise})`.as("paid_total"),
    })
    .from(payments)
    .where(
      tenantScope(
        ctx,
        payments,
        inArray(payments.customerId, [...customerIds]),
        isNull(payments.voidedAt),
      ),
    )
    .groupBy(payments.customerId)
    .as("paid");
  const refunded = db
    .select({
      customerId: refunds.customerId,
      total: sql<string>`sum(${refunds.amountPaise})`.as("refunded_total"),
    })
    .from(refunds)
    .where(
      tenantScope(
        ctx,
        refunds,
        inArray(refunds.customerId, [...customerIds]),
        isNull(refunds.voidedAt),
      ),
    )
    .groupBy(refunds.customerId)
    .as("refunded");
  const rows = await db
    .select({
      id: customers.id,
      balance: sql<string>`${customers.openingBalancePaise} + coalesce(${invoiced.total}, 0) - coalesce(${credited.total}, 0) - coalesce(${paid.total}, 0) + coalesce(${refunded.total}, 0)`,
    })
    .from(customers)
    .leftJoin(invoiced, eq(invoiced.customerId, customers.id))
    .leftJoin(credited, eq(credited.customerId, customers.id))
    .leftJoin(paid, eq(paid.customerId, customers.id))
    .leftJoin(refunded, eq(refunded.customerId, customers.id))
    .where(tenantScope(ctx, customers, inArray(customers.id, [...customerIds])));
  return new Map(rows.map((row) => [row.id, BigInt(row.balance)]));
}

export interface LedgerRefundRow {
  id: string;
  refundDate: string;
  amountPaise: bigint;
  mode: (typeof refunds.$inferSelect)["mode"];
  reference: string | null;
}

/** The customer's live refunds, oldest first (ADR 0011). */
export function ledgerRefunds(
  db: Executor,
  ctx: TenantContext,
  customerId: string,
): Promise<LedgerRefundRow[]> {
  return db
    .select({
      id: refunds.id,
      refundDate: refunds.refundDate,
      amountPaise: refunds.amountPaise,
      mode: refunds.mode,
      reference: refunds.reference,
    })
    .from(refunds)
    .where(tenantScope(ctx, refunds, eq(refunds.customerId, customerId), isNull(refunds.voidedAt)))
    .orderBy(asc(refunds.refundDate), asc(refunds.id));
}
