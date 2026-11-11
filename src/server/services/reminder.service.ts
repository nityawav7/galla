import { publicInvoiceUrl } from "@/lib/app-url";
import { REMINDER_MAX_INVOICES } from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { reminderTemplates, type ShareLocale, shareFallbacks } from "@/lib/share-templates";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findInvoiceLinks } from "@/server/db/repos/invoices.repo";
import { withTransaction } from "@/server/db/transaction";
import { formatIndianDate } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";
import { buildReminder, type ReminderInvoice } from "@/server/domain/share/reminder";
import { whatsAppNumber } from "@/server/domain/share/whatsapp";

import { type CustomerLedger, getCustomerLedger } from "./ledger.service";

/*
 * "Send reminder" on the customer page (SPEC F7, decision 11 of the Phase 8 plan): a WhatsApp
 * click-to-chat message with what is due, how much is overdue and the oldest open invoices with
 * their public links. The text is fixed (English and Hindi) and built here from the ledger, so it
 * always matches the books. Each opening is audited: the data for SPEC §1's "recovered within 14
 * days of a reminder" metric. Owners and staff send it (`invoice:share`).
 */

export interface ReminderInfo {
  /** Digits with the country code, or null (no phone): WhatsApp asks whom to send to. */
  phone: string | null;
  /** The business's language, picked first. */
  defaultLocale: ShareLocale;
  messages: Record<ShareLocale, string>;
}

/** What is due and which invoices make it up; null when the customer owes nothing. */
function dueOf(view: CustomerLedger) {
  const balance = view.ledger.closingPaise;
  if (balance <= 0n) return null;
  return {
    balancePaise: balance,
    overduePaise: view.aging.overduePaise,
    shown: view.openInvoices.slice(0, REMINDER_MAX_INVOICES),
    more: Math.max(0, view.openInvoices.length - REMINDER_MAX_INVOICES),
  };
}

/** The reminder in both languages, or null when nothing is due. */
export async function getReminderInfo(
  ctx: TenantContext,
  customerId: string,
): Promise<ReminderInfo | null> {
  assertCan(ctx, "invoice:share");
  const view = await getCustomerLedger(ctx, customerId);
  const due = dueOf(view);
  if (!due) return null;
  const db = getDb();
  const [business, links] = await Promise.all([
    getCurrentBusiness(db, ctx),
    findInvoiceLinks(
      db,
      ctx,
      due.shown.map((invoice) => invoice.id),
    ),
  ]);
  if (!business) throw new NotFoundError("Business");
  const linkById = new Map(
    links.map((row) => [
      row.id,
      row.publicToken !== null && row.tokenRevokedAt === null
        ? publicInvoiceUrl(row.publicToken)
        : null,
    ]),
  );

  const message = (locale: ShareLocale): string => {
    const fallback = shareFallbacks(locale);
    const invoices: ReminderInvoice[] = due.shown.map((invoice) => ({
      number: invoice.number,
      amount: formatINR(invoice.balancePaise),
      dueDate: invoice.dueDate ? formatIndianDate(invoice.dueDate) : fallback.dueDate,
      link: linkById.get(invoice.id) ?? null,
    }));
    return buildReminder(reminderTemplates(locale), {
      customer: view.customer.name,
      shop: business.tradeName ?? business.legalName,
      amount: formatINR(due.balancePaise),
      overdue: due.overduePaise > 0n ? formatINR(due.overduePaise) : null,
      opening: view.credit.openingOwedPaise > 0n ? formatINR(view.credit.openingOwedPaise) : null,
      invoices,
      more: due.more,
    });
  };

  return {
    phone: whatsAppNumber(view.customer.phoneE164),
    defaultLocale: business.locale,
    messages: { en: message("en"), hi: message("hi") },
  };
}

/**
 * Records that a reminder was opened in WhatsApp: the amounts and invoice ids at that moment, no
 * names, phones or message text. False (and nothing written) when nothing is due any more.
 */
export async function recordReminderShared(
  ctx: TenantContext,
  customerId: string,
): Promise<boolean> {
  assertCan(ctx, "invoice:share");
  const view = await getCustomerLedger(ctx, customerId);
  const due = dueOf(view);
  if (!due) return false;
  await withTransaction((tx) =>
    insertAuditLog(tx, ctx, {
      entity: "customer",
      entityId: view.customer.id,
      action: "customer.reminderShared",
      diff: {
        after: {
          balancePaise: due.balancePaise.toString(),
          overduePaise: due.overduePaise.toString(),
          invoiceIds: due.shown.map((invoice) => invoice.id),
        },
      },
    }),
  );
  return true;
}
