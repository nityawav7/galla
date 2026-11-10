import { NotFoundError } from "@/lib/errors";
import { defaultShareTemplate, shareFallbacks, type ShareLocale } from "@/lib/share-templates";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findInvoiceById } from "@/server/db/repos/invoices.repo";
import { formatIndianDate } from "@/server/domain/fy";
import { balancePaise } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { type ShareValues, whatsAppNumber } from "@/server/domain/share/whatsapp";

import { requireId } from "./ids";

/*
 * What "Share on WhatsApp" needs (SPEC F6): the customer's WhatsApp number and, per language, the
 * business's template with the invoice's values. The link is added in the browser, because the
 * owner can replace it on the same page (ADR 0009). Values come from the invoice's snapshots.
 */

export interface ShareMessage {
  template: string;
  values: Omit<ShareValues, "link">;
}

export interface ShareInfo {
  /** Digits with the country code, or null (walk-in, no phone): WhatsApp asks whom to send to. */
  phone: string | null;
  /** The business's language, picked first in the share sheet. */
  defaultLocale: ShareLocale;
  messages: Record<ShareLocale, ShareMessage>;
}

export async function getShareInfo(ctx: TenantContext, invoiceId: string): Promise<ShareInfo> {
  assertCan(ctx, "invoice:share");
  const db = getDb();
  const [invoice, business] = await Promise.all([
    findInvoiceById(db, ctx, requireId(invoiceId, "Invoice")),
    getCurrentBusiness(db, ctx),
  ]);
  if (!invoice || invoice.status === "DRAFT" || !invoice.number) throw new NotFoundError("Invoice");
  if (!business) throw new NotFoundError("Business");

  const recipient = invoice.customerSnapshot;
  const supplier = invoice.supplierSnapshot;
  const due = balancePaise(invoice);
  const message = (locale: ShareLocale, stored: string | null): ShareMessage => {
    const fallback = shareFallbacks(locale);
    return {
      template: stored ?? defaultShareTemplate(locale),
      values: {
        customer: recipient && recipient.name.length > 0 ? recipient.name : fallback.customer,
        shop: supplier ? (supplier.tradeName ?? supplier.legalName) : business.legalName,
        number: invoice.number ?? "",
        // What is still owed; once nothing is, the invoice total.
        amount: formatINR(due > 0n ? due : invoice.grandTotalPaise),
        dueDate: invoice.dueDate ? formatIndianDate(invoice.dueDate) : fallback.dueDate,
      },
    };
  };
  return {
    phone: whatsAppNumber(recipient?.phoneE164 ?? null),
    defaultLocale: business.locale,
    messages: {
      en: message("en", business.whatsappTemplateEn),
      hi: message("hi", business.whatsappTemplateHi),
    },
  };
}
