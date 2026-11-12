import { publicInvoiceUrl } from "@/lib/app-url";
import { ConflictError, NotFoundError, RateLimitError } from "@/lib/errors";
import { getLimiter } from "@/lib/ratelimit";
import { shareFallbacks } from "@/lib/share-templates";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { type Business, getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { findCustomerById } from "@/server/db/repos/customers.repo";
import { findInvoiceById, type Invoice } from "@/server/db/repos/invoices.repo";
import { withTransaction } from "@/server/db/transaction";
import { formatIndianDate } from "@/server/domain/fy";
import { balancePaise } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import { invoiceEmail } from "@/server/emails/invoice-email";
import { canSendEmail, DemoEmailError, sendEmail } from "@/server/notifications/email";

import { requireId } from "./ids";

/*
 * "Email invoice" (SPEC F9, PR 10a of the Phase 10 plan): the invoice's public link, sent to the
 * customer's saved email. Owners and staff send it (`invoice:share`), at most 30 an hour per
 * business. Each send is audited with the invoice id only, never the address.
 */

/** Why an invoice can't be emailed right now. */
export type InvoiceEmailBlocker = "notSetUp" | "noEmail" | "linkOff" | "cancelled" | "demo";

interface Prepared {
  invoice: Invoice;
  business: Business;
  /** The customer's email now, else the one printed on the invoice; null for none. */
  to: string | null;
  /** The public link, or null while it is off. */
  link: string | null;
}

async function prepare(ctx: TenantContext, invoiceId: string): Promise<Prepared> {
  const db = getDb();
  const [invoice, business] = await Promise.all([
    findInvoiceById(db, ctx, requireId(invoiceId, "Invoice")),
    getCurrentBusiness(db, ctx),
  ]);
  if (!invoice || invoice.status === "DRAFT" || !invoice.number) throw new NotFoundError("Invoice");
  if (!business) throw new NotFoundError("Business");
  const customer = invoice.customerId
    ? await findCustomerById(db, ctx, invoice.customerId)
    : undefined;
  const on = invoice.publicToken !== null && invoice.tokenRevokedAt === null;
  return {
    invoice,
    business,
    to: customer?.email ?? invoice.customerSnapshot?.email ?? null,
    link: on && invoice.publicToken ? publicInvoiceUrl(invoice.publicToken) : null,
  };
}

type Check = { ok: true; to: string; link: string } | { ok: false; blocker: InvoiceEmailBlocker };

function check({ invoice, business, to, link }: Prepared): Check {
  if (business.isDemo) return { ok: false, blocker: "demo" };
  if (!canSendEmail()) return { ok: false, blocker: "notSetUp" };
  if (invoice.status === "CANCELLED") return { ok: false, blocker: "cancelled" };
  if (link === null) return { ok: false, blocker: "linkOff" };
  if (to === null) return { ok: false, blocker: "noEmail" };
  return { ok: true, to, link };
}

const REFUSALS: Record<InvoiceEmailBlocker, () => Error> = {
  demo: () => new DemoEmailError(),
  notSetUp: () => new ConflictError("Email is not set up"),
  cancelled: () => new ConflictError("This invoice is cancelled"),
  linkOff: () => new ConflictError("The invoice link is turned off"),
  noEmail: () => new ConflictError("The customer has no email address"),
};

/** Whether "Email invoice" can be offered for this invoice. */
export async function canEmailInvoice(ctx: TenantContext, invoiceId: string): Promise<boolean> {
  assertCan(ctx, "invoice:share");
  return check(await prepare(ctx, invoiceId)).ok;
}

/** Emails the invoice's link to the customer and audits it. */
export async function emailInvoice(ctx: TenantContext, invoiceId: string): Promise<void> {
  assertCan(ctx, "invoice:share");
  const prepared = await prepare(ctx, invoiceId);
  const checked = check(prepared);
  if (!checked.ok) throw REFUSALS[checked.blocker]();
  const { invoice, business } = prepared;
  const { to, link } = checked;

  const { success, reset } = await getLimiter("invoiceEmail").limit(business.id);
  if (!success) throw new RateLimitError(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));

  const locale = business.locale;
  const supplier = invoice.supplierSnapshot;
  const recipient = invoice.customerSnapshot;
  const due = balancePaise(invoice);
  const shopPhone = supplier ? supplier.phoneE164 : business.phoneE164;
  await sendEmail(
    invoiceEmail({
      locale,
      to,
      replyTo: business.email,
      customer:
        recipient && recipient.name.length > 0 ? recipient.name : shareFallbacks(locale).customer,
      shop: supplier ? (supplier.tradeName ?? supplier.legalName) : business.legalName,
      shopPhone: shopPhone ? formatIndianPhone(shopPhone) : null,
      shopGstin: supplier ? supplier.gstin : business.gstin,
      number: invoice.number ?? "",
      amount: formatINR(due > 0n ? due : invoice.grandTotalPaise),
      paid: due <= 0n,
      dueDate: invoice.dueDate ? formatIndianDate(invoice.dueDate) : null,
      link,
    }),
    business,
  );

  await withTransaction((tx) =>
    insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: invoice.id,
      action: "invoice.emailed",
      diff: { after: { balancePaise: due.toString(), locale } },
    }),
  );
}
