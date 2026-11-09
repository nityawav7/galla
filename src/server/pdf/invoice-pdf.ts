import { type Business } from "@/server/db/repos/businesses.repo";
import { type Invoice, type InvoiceLine } from "@/server/db/repos/invoices.repo";
import { printableDocument } from "@/server/domain/invoice/printable";
import { balancePaise } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { buildUpiPayLink, isValidUpiVpa } from "@/server/domain/upi";

import { renderDocumentPdf } from "./render";
import { type PdfBank, type PdfFormat, type PdfPayment, pdfTranslator } from "./types";

/*
 * An issued invoice → PDF bytes, shared by the signed-in route (pdf.service) and the public link
 * (public-invoice.service). Callers have already checked who may see the invoice: this module
 * never reads the database. Tax content comes from the snapshots; payment details from the
 * business as it is now (Phase 7 plan, decision 4).
 */

export interface RenderedPdf {
  /** "SH-26-27-0001.pdf": the number with "/" replaced, safe in a Content-Disposition header. */
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** The business details a printed invoice reads live. */
export type PaymentDetails = Pick<
  Business,
  | "legalName"
  | "tradeName"
  | "upiVpa"
  | "bankAccountName"
  | "bankAccountNumber"
  | "bankIfsc"
  | "bankName"
>;

export function pdfFilename(number: string, format: PdfFormat): string {
  const base = number.replace(/[^A-Za-z0-9-]/g, "-");
  return format === "80mm" ? `${base}-80mm.pdf` : `${base}.pdf`;
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

function bankFor(business: PaymentDetails): PdfBank | null {
  if (!business.bankAccountNumber) return null;
  return {
    accountName: business.bankAccountName,
    accountNumber: business.bankAccountNumber,
    ifsc: business.bankIfsc,
    bankName: business.bankName,
  };
}

/** Null for a draft, which has no number or snapshot and so no PDF. */
export async function renderIssuedInvoice(
  invoice: Invoice,
  lines: readonly InvoiceLine[],
  business: PaymentDetails,
  format: PdfFormat,
): Promise<RenderedPdf | null> {
  if (invoice.status === "DRAFT" || !invoice.number || !invoice.supplierSnapshot) return null;
  const cancelled = invoice.status === "CANCELLED";
  const due = !cancelled && balancePaise(invoice) > 0n;
  const bytes = await renderDocumentPdf(format, {
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
  });
  return { filename: pdfFilename(invoice.number, format), bytes };
}
