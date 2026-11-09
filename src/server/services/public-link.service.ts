import { publicInvoiceUrl } from "@/lib/app-url";
import { NotFoundError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import {
  findInvoiceById,
  type Invoice,
  lockInvoice,
  setPublicLink,
} from "@/server/db/repos/invoices.repo";
import { withTransaction } from "@/server/db/transaction";

import { requireId } from "./ids";
import { newPublicToken } from "./tokens";

/*
 * The owner's control over an invoice's public link (SPEC F5, ADR 0009). Staff and the owner may
 * copy it (`invoice:share`); only the owner turns it off or replaces it (`invoice:manageLink`).
 * Both changes are audited in the same transaction, never with the token itself in the diff.
 */

export interface PublicLink {
  /** Null while the link is turned off. */
  url: string | null;
}

function linkOf(invoice: Pick<Invoice, "publicToken" | "tokenRevokedAt">): PublicLink {
  const on = invoice.publicToken !== null && invoice.tokenRevokedAt === null;
  return { url: on && invoice.publicToken ? publicInvoiceUrl(invoice.publicToken) : null };
}

/** Drafts have no link yet: NotFound, like another business's invoice. */
function issued(invoice: Invoice | undefined): Invoice {
  if (!invoice || invoice.status === "DRAFT") throw new NotFoundError("Invoice");
  return invoice;
}

export async function getPublicLink(ctx: TenantContext, id: string): Promise<PublicLink> {
  assertCan(ctx, "invoice:share");
  return linkOf(issued(await findInvoiceById(getDb(), ctx, requireId(id, "Invoice"))));
}

/** Turns the link off: the page and its PDF answer 404 until a new link is made. */
export async function revokePublicLink(ctx: TenantContext, id: string): Promise<PublicLink> {
  assertCan(ctx, "invoice:manageLink");
  const invoiceId = requireId(id, "Invoice");
  return withTransaction(async (tx) => {
    const invoice = issued(await lockInvoice(tx, ctx, invoiceId));
    if (linkOf(invoice).url === null || invoice.publicToken === null) return { url: null };
    const updated = await setPublicLink(tx, ctx, invoice.id, {
      publicToken: invoice.publicToken,
      tokenRevokedAt: now(),
    });
    if (!updated) throw new NotFoundError("Invoice");
    await insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: invoice.id,
      action: "invoice.linkRevoked",
      diff: { before: { linkOn: true }, after: { linkOn: false } },
    });
    return linkOf(updated);
  });
}

/** A new token, link on. Anyone holding the old link now gets 404. */
export async function regeneratePublicLink(ctx: TenantContext, id: string): Promise<PublicLink> {
  assertCan(ctx, "invoice:manageLink");
  const invoiceId = requireId(id, "Invoice");
  return withTransaction(async (tx) => {
    const invoice = issued(await lockInvoice(tx, ctx, invoiceId));
    const updated = await setPublicLink(tx, ctx, invoice.id, {
      publicToken: newPublicToken(),
      tokenRevokedAt: null,
    });
    if (!updated) throw new NotFoundError("Invoice");
    await insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: invoice.id,
      action: "invoice.linkRegenerated",
      diff: { before: { linkOn: linkOf(invoice).url !== null }, after: { linkOn: true } },
    });
    return linkOf(updated);
  });
}
