import { NotFoundError } from "@/lib/errors";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import {
  findSharedInvoice,
  type SharedInvoice,
  type SharedInvoiceLine,
  type SharedInvoiceRow,
  sharedInvoiceExists,
} from "@/server/db/public/invoice-by-token";
import { istDateFromInstant } from "@/server/domain/fy";
import { balancePaise, type DisplayStatus, displayStatus } from "@/server/domain/invoice/status";
import { type PdfFormat } from "@/server/pdf/formats";
import { paymentFor, type RenderedPdf, renderIssuedInvoice } from "@/server/pdf/invoice-pdf";
import { type PdfPayment } from "@/server/pdf/types";

import { PUBLIC_TOKEN_PATTERN } from "./tokens";

/*
 * The public invoice link /i/{token} (SPEC F5, ADR 0009). There is no TenantContext: whoever has
 * the 128-bit token may see that one invoice, and only while its link is on. Unknown, malformed,
 * revoked and draft tokens all give the same NotFound, so a guess learns nothing.
 */

export interface SharedInvoiceView {
  invoice: SharedInvoiceRow;
  lines: SharedInvoiceLine[];
  status: DisplayStatus;
  balancePaise: bigint;
  /** The shop as printed on the invoice. */
  shopName: string;
  /** The UPI link and QR for the balance, or null when nothing can be paid. */
  payment: PdfPayment | null;
}

async function load(token: string): Promise<SharedInvoice> {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) throw new NotFoundError("Invoice");
  const shared = await findSharedInvoice(getDb(), token);
  if (!shared) throw new NotFoundError("Invoice");
  return shared;
}

/** For the proxy: answer 404 before the page starts streaming (it can't change status later). */
export async function isLiveInvoiceLink(token: string): Promise<boolean> {
  return PUBLIC_TOKEN_PATTERN.test(token) && sharedInvoiceExists(getDb(), token);
}

export async function getSharedInvoice(token: string): Promise<SharedInvoiceView> {
  const { invoice, lines, business } = await load(token);
  const supplier = invoice.supplierSnapshot;
  return {
    invoice,
    lines,
    status: displayStatus({ ...invoice, today: istDateFromInstant(now()) }),
    balancePaise: balancePaise(invoice),
    shopName: supplier ? (supplier.tradeName ?? supplier.legalName) : business.legalName,
    payment: paymentFor(invoice, business),
  };
}

export async function renderSharedInvoicePdf(
  token: string,
  format: PdfFormat,
): Promise<RenderedPdf> {
  const { invoice, lines, business } = await load(token);
  const pdf = await renderIssuedInvoice(invoice, lines, business, format);
  if (!pdf) throw new NotFoundError("Invoice");
  return pdf;
}
