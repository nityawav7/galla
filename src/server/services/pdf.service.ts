import { AGING_LIMITS } from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { type Business, getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findCreditNoteById, findCreditNoteLines } from "@/server/db/repos/credit-notes.repo";
import { findInvoiceById, findInvoiceLines } from "@/server/db/repos/invoices.repo";
import { formatIndianDate } from "@/server/domain/fy";
import {
  printableDocument,
  recipientParty,
  supplierParty,
} from "@/server/domain/invoice/printable";
import { customerSnapshot, supplierSnapshot } from "@/server/domain/invoice/snapshot";
import { balanceAmount, statementRows } from "@/server/domain/ledger/statement";
import { formatINR } from "@/server/domain/money";
import { buildUpiPayLink, isValidUpiVpa } from "@/server/domain/upi";
import { pdfFilename, type RenderedPdf, renderIssuedInvoice } from "@/server/pdf/invoice-pdf";
import { renderDocumentPdf } from "@/server/pdf/render";
import { renderStatement, type StatementAging } from "@/server/pdf/statement";
import { type DocumentPdfProps, type PdfFormat, pdfTranslator } from "@/server/pdf/types";

import { requireId } from "./ids";
import { type CustomerLedger, getCustomerLedger } from "./ledger.service";

/*
 * Invoice and credit-note PDFs (SPEC F5, ADR 0008), rendered on demand and never stored. Tax
 * content comes only from the document's snapshots; payment details (UPI ID, bank) are read live
 * from the business so customers always pay the current account (decision 4 of the Phase 7 plan).
 * Reads only, so no audit row.
 */

export type { RenderedPdf };

async function businessOrThrow(ctx: TenantContext): Promise<Business> {
  const business = await getCurrentBusiness(getDb(), ctx);
  if (!business) throw new NotFoundError("Business");
  return business;
}

/** An issued (or cancelled) invoice as a PDF. Drafts have no PDF: NotFound. */
export async function renderInvoicePdf(
  ctx: TenantContext,
  id: string,
  format: PdfFormat,
): Promise<RenderedPdf> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const invoice = await findInvoiceById(db, ctx, requireId(id, "Invoice"));
  if (!invoice) throw new NotFoundError("Invoice");
  const [lines, business] = await Promise.all([
    findInvoiceLines(db, ctx, invoice.id),
    businessOrThrow(ctx),
  ]);
  const pdf = await renderIssuedInvoice(invoice, lines, business, format);
  if (!pdf) throw new NotFoundError("Invoice");
  return pdf;
}

/** A credit note as a PDF, with the invoice it reduces and its reason. */
export async function renderCreditNotePdf(
  ctx: TenantContext,
  id: string,
  format: PdfFormat,
): Promise<RenderedPdf> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const note = await findCreditNoteById(db, ctx, requireId(id, "Credit note"));
  if (!note) throw new NotFoundError("Credit note");
  const [lines, invoice] = await Promise.all([
    findCreditNoteLines(db, ctx, note.id),
    findInvoiceById(db, ctx, note.invoiceId),
  ]);
  if (!invoice?.number) throw new NotFoundError("Invoice");
  const props: DocumentPdfProps = {
    doc: printableDocument({
      type: invoice.type,
      number: note.number,
      date: note.noteDate,
      dueDate: null,
      placeOfSupplyStateCode: note.placeOfSupplyStateCode,
      isInterState: note.isInterState,
      supplier: note.supplierSnapshot,
      recipient: note.customerSnapshot,
      lines,
      totals: note,
      notes: null,
    }),
    creditNote: {
      invoiceNumber: invoice.number,
      invoiceDate: formatIndianDate(invoice.invoiceDate),
      reason: note.reason,
    },
    payment: null,
    bank: null,
    cancelled: false,
    t: pdfTranslator(),
  };
  return {
    filename: pdfFilename(note.number, format),
    bytes: await renderDocumentPdf(format, props),
  };
}

function statementAging(view: CustomerLedger, t: ReturnType<typeof pdfTranslator>): StatementAging {
  const [first, second, third] = AGING_LIMITS;
  const { aging } = view;
  return {
    labels: [
      t("statement.aging.bucket", { from: "0", to: String(first) }),
      t("statement.aging.bucket", { from: String(first + 1), to: String(second) }),
      t("statement.aging.bucket", { from: String(second + 1), to: String(third) }),
      t("statement.aging.over", { days: String(third) }),
    ],
    notDue: formatINR(aging.notDuePaise),
    pastDue: [
      formatINR(aging.pastDuePaise[0]),
      formatINR(aging.pastDuePaise[1]),
      formatINR(aging.pastDuePaise[2]),
      formatINR(aging.pastDuePaise[3]),
    ],
    opening: formatINR(aging.openingPaise),
    onAccount: formatINR(aging.onAccountPaise),
    total: formatINR(aging.totalPaise),
  };
}

/**
 * A customer's statement of account (SPEC F7, decision 10): A4, from the start of the chosen
 * period (`{ period: "fy" | "lastFy" | "all" }`) up to today, with the balance brought forward,
 * the aging and a UPI QR for the balance due. The filename carries part of the id, never a name.
 */
export async function renderStatementPdf(
  ctx: TenantContext,
  customerId: string,
  query: unknown,
): Promise<RenderedPdf> {
  const view = await getCustomerLedger(ctx, customerId, query);
  const business = await businessOrThrow(ctx);
  const t = pdfTranslator();
  const { ledger } = view;
  const due = ledger.closingPaise;
  const vpa = business.upiVpa;
  const bytes = await renderStatement({
    supplier: supplierParty(supplierSnapshot(business)),
    customer: recipientParty(customerSnapshot(view.customer)),
    period: {
      from: view.from === null ? null : formatIndianDate(view.from),
      to: formatIndianDate(view.today),
    },
    // Nothing before the period (or it netted to zero): no "brought forward ₹0.00" row.
    broughtForward:
      ledger.broughtForwardPaise === null || ledger.broughtForwardPaise === 0n
        ? null
        : balanceAmount(ledger.broughtForwardPaise),
    rows: statementRows(ledger, view.payments),
    totals: { debit: formatINR(ledger.debitPaise), credit: formatINR(ledger.creditPaise) },
    closing: balanceAmount(due),
    aging: statementAging(view, t),
    payment:
      due > 0n && vpa && isValidUpiVpa(vpa)
        ? {
            upiLink: buildUpiPayLink({
              vpa,
              payeeName: business.tradeName ?? business.legalName,
              amountPaise: due,
              note: t("statement.upiNote"),
            }),
            vpa,
            amount: formatINR(due),
          }
        : null,
    t,
  });
  return { filename: `statement-${view.customer.id.slice(-12)}-${view.today}.pdf`, bytes };
}
