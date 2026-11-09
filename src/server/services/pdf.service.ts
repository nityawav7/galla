import { NotFoundError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { type Business, getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findCreditNoteById, findCreditNoteLines } from "@/server/db/repos/credit-notes.repo";
import { findInvoiceById, findInvoiceLines, type Invoice } from "@/server/db/repos/invoices.repo";
import { formatIndianDate } from "@/server/domain/fy";
import { printableDocument } from "@/server/domain/invoice/printable";
import { balancePaise } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { buildUpiPayLink, isValidUpiVpa } from "@/server/domain/upi";
import { renderDocumentPdf } from "@/server/pdf/render";
import {
  type DocumentPdfProps,
  type PdfBank,
  type PdfFormat,
  type PdfPayment,
  pdfTranslator,
} from "@/server/pdf/types";

import { requireId } from "./ids";

/*
 * Invoice and credit-note PDFs (SPEC F5, ADR 0008), rendered on demand and never stored. Tax
 * content comes only from the document's snapshots; payment details (UPI ID, bank) are read live
 * from the business so customers always pay the current account (decision 4 of the Phase 7 plan).
 * Reads only, so no audit row.
 */

export interface RenderedPdf {
  /** "SH-26-27-0001.pdf": the number with "/" replaced, safe in a Content-Disposition header. */
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

function filename(number: string, format: PdfFormat): string {
  const base = number.replace(/[^A-Za-z0-9-]/g, "-");
  return format === "80mm" ? `${base}-80mm.pdf` : `${base}.pdf`;
}

async function businessOrThrow(ctx: TenantContext): Promise<Business> {
  const business = await getCurrentBusiness(getDb(), ctx);
  if (!business) throw new NotFoundError("Business");
  return business;
}

/** Where to pay, or null when nothing is due, the invoice is cancelled or there is no UPI ID. */
export function paymentFor(
  invoice: Pick<
    Invoice,
    "status" | "number" | "grandTotalPaise" | "amountPaidPaise" | "amountCreditedPaise"
  >,
  business: Pick<Business, "upiVpa" | "tradeName" | "legalName">,
): PdfPayment | null {
  const due = balancePaise(invoice);
  if (invoice.status === "CANCELLED" || due <= 0n) return null;
  if (!business.upiVpa || !isValidUpiVpa(business.upiVpa) || !invoice.number) return null;
  return {
    upiLink: buildUpiPayLink({
      vpa: business.upiVpa,
      payeeName: business.tradeName ?? business.legalName,
      amountPaise: due,
      note: invoice.number,
    }),
    vpa: business.upiVpa,
    amount: formatINR(due),
  };
}

function bankFor(business: Business): PdfBank | null {
  if (!business.bankAccountNumber) return null;
  return {
    accountName: business.bankAccountName,
    accountNumber: business.bankAccountNumber,
    ifsc: business.bankIfsc,
    bankName: business.bankName,
  };
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
  if (!invoice || invoice.status === "DRAFT" || !invoice.number || !invoice.supplierSnapshot) {
    throw new NotFoundError("Invoice");
  }
  const [lines, business] = await Promise.all([
    findInvoiceLines(db, ctx, invoice.id),
    businessOrThrow(ctx),
  ]);
  const cancelled = invoice.status === "CANCELLED";
  const due = !cancelled && balancePaise(invoice) > 0n;
  const props: DocumentPdfProps = {
    doc: printableDocument({
      type: invoice.type,
      number: invoice.number,
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
      isInterState: invoice.isInterState,
      supplier: invoice.supplierSnapshot,
      recipient: invoice.customerSnapshot,
      lines,
      totals: invoice,
      notes: invoice.notes,
    }),
    creditNote: null,
    payment: paymentFor(invoice, business),
    // Bank details sit with the UPI block: only while something is still due.
    bank: due ? bankFor(business) : null,
    cancelled,
    t: pdfTranslator(),
  };
  return {
    filename: filename(invoice.number, format),
    bytes: await renderDocumentPdf(format, props),
  };
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
  return { filename: filename(note.number, format), bytes: await renderDocumentPdf(format, props) };
}
