import { and, asc, between, eq, ne, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";
import { type HsnLine } from "@/server/domain/reports/hsn";
import { type RegisterInvoice, type RegisterNote } from "@/server/domain/reports/register";

import { creditNoteLines, creditNotes, invoiceLines, invoices } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

/*
 * What the reports read (SPEC F8): issued documents in a period of business dates, every query
 * filtered by `business_id`. Names and GSTINs come from the documents' snapshots, as printed.
 */

export interface Range {
  from: string;
  to: string;
}

const liveInvoice = sql`${invoices.status} in ('ISSUED', 'PARTIALLY_PAID', 'PAID')`;

/** Every issued or cancelled invoice dated in the range (drafts have no number). */
export async function registerInvoices(
  db: Executor,
  ctx: TenantContext,
  range: Range,
): Promise<RegisterInvoice[]> {
  const rows = await db
    .select({
      date: invoices.invoiceDate,
      number: invoices.number,
      status: invoices.status,
      snapshot: invoices.customerSnapshot,
      placeOfSupply: invoices.placeOfSupplyStateCode,
      taxablePaise: invoices.taxablePaise,
      cgstPaise: invoices.cgstPaise,
      sgstPaise: invoices.sgstPaise,
      utgstPaise: invoices.utgstPaise,
      igstPaise: invoices.igstPaise,
      roundOffPaise: invoices.roundOffPaise,
      totalPaise: invoices.grandTotalPaise,
      paidPaise: invoices.amountPaidPaise,
      creditedPaise: invoices.amountCreditedPaise,
    })
    .from(invoices)
    .where(
      tenantScope(
        ctx,
        invoices,
        ne(invoices.status, "DRAFT"),
        between(invoices.invoiceDate, range.from, range.to),
      ),
    )
    .orderBy(asc(invoices.invoiceDate), asc(invoices.number));
  return rows.map(({ snapshot, status, number, ...row }) => ({
    ...row,
    number: number ?? "",
    status: status === "DRAFT" ? "ISSUED" : status,
    customer: snapshot && snapshot.name.length > 0 ? snapshot.name : null,
    gstin: snapshot?.gstin ?? null,
  }));
}

/** Every credit note dated in the range, with the number of the invoice it reduces. */
export async function registerCreditNotes(
  db: Executor,
  ctx: TenantContext,
  range: Range,
): Promise<RegisterNote[]> {
  const rows = await db
    .select({
      date: creditNotes.noteDate,
      number: creditNotes.number,
      invoiceNumber: invoices.number,
      snapshot: creditNotes.customerSnapshot,
      placeOfSupply: creditNotes.placeOfSupplyStateCode,
      taxablePaise: creditNotes.taxablePaise,
      cgstPaise: creditNotes.cgstPaise,
      sgstPaise: creditNotes.sgstPaise,
      utgstPaise: creditNotes.utgstPaise,
      igstPaise: creditNotes.igstPaise,
      roundOffPaise: creditNotes.roundOffPaise,
      totalPaise: creditNotes.grandTotalPaise,
    })
    .from(creditNotes)
    .innerJoin(
      invoices,
      and(eq(invoices.businessId, creditNotes.businessId), eq(invoices.id, creditNotes.invoiceId)),
    )
    .where(tenantScope(ctx, creditNotes, between(creditNotes.noteDate, range.from, range.to)))
    .orderBy(asc(creditNotes.noteDate), asc(creditNotes.number));
  return rows.map(({ snapshot, invoiceNumber, ...row }) => ({
    ...row,
    invoiceNumber: invoiceNumber ?? "",
    customer: snapshot.name.length > 0 ? snapshot.name : null,
    gstin: snapshot.gstin,
  }));
}

/** Lines of live invoices and of credit notes in the range, for the HSN summary. */
export async function hsnLines(db: Executor, ctx: TenantContext, range: Range): Promise<HsnLine[]> {
  const sold = await db
    .select({
      hsn: invoiceLines.hsnSac,
      uqc: invoiceLines.unit,
      rateBp: invoiceLines.rateBp,
      qtyMilli: invoiceLines.qtyMilli,
      taxablePaise: invoiceLines.taxablePaise,
      cgstPaise: invoiceLines.cgstPaise,
      sgstPaise: invoiceLines.sgstPaise,
      utgstPaise: invoiceLines.utgstPaise,
      igstPaise: invoiceLines.igstPaise,
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
        between(invoices.invoiceDate, range.from, range.to),
      ),
    );
  const returned = await db
    .select({
      hsn: creditNoteLines.hsnSac,
      uqc: creditNoteLines.unit,
      rateBp: creditNoteLines.rateBp,
      qtyMilli: creditNoteLines.qtyMilli,
      taxablePaise: creditNoteLines.taxablePaise,
      cgstPaise: creditNoteLines.cgstPaise,
      sgstPaise: creditNoteLines.sgstPaise,
      utgstPaise: creditNoteLines.utgstPaise,
      igstPaise: creditNoteLines.igstPaise,
    })
    .from(creditNoteLines)
    .innerJoin(
      creditNotes,
      and(
        eq(creditNotes.businessId, creditNoteLines.businessId),
        eq(creditNotes.id, creditNoteLines.creditNoteId),
      ),
    )
    .where(tenantScope(ctx, creditNoteLines, between(creditNotes.noteDate, range.from, range.to)));
  return [
    ...sold.map((row) => ({ ...row, credit: false })),
    ...returned.map((row) => ({ ...row, credit: true })),
  ];
}
