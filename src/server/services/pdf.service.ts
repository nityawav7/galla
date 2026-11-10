import { NotFoundError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { type Business, getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findCreditNoteById, findCreditNoteLines } from "@/server/db/repos/credit-notes.repo";
import { findInvoiceById, findInvoiceLines } from "@/server/db/repos/invoices.repo";
import { formatIndianDate } from "@/server/domain/fy";
import { printableDocument } from "@/server/domain/invoice/printable";
import { pdfFilename, type RenderedPdf, renderIssuedInvoice } from "@/server/pdf/invoice-pdf";
import { renderDocumentPdf } from "@/server/pdf/render";
import { type DocumentPdfProps, type PdfFormat, pdfTranslator } from "@/server/pdf/types";

import { requireId } from "./ids";

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
