import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { businesses, invoiceLines, invoices } from "../schema";
import { type Executor } from "../transaction";

/*
 * The one lookup that does not start from a TenantContext (ADR 0009): a customer opening
 * /i/{token} has no account, and the 128-bit token is the secret that names the invoice. It is
 * read-only, returns only an issued (or cancelled) invoice whose link is on, and ESLint lets
 * only src/server/services/public-invoice.service.ts import it. Lines and the business are read
 * with the invoice's own business_id, so nothing from another business can join in.
 */

export type SharedInvoiceRow = typeof invoices.$inferSelect;
export type SharedInvoiceLine = typeof invoiceLines.$inferSelect;

/** Payment details are read live (Phase 7 plan, decision 4), nothing else of the business. */
export interface SharedBusiness {
  legalName: string;
  tradeName: string | null;
  upiVpa: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
}

export interface SharedInvoice {
  invoice: SharedInvoiceRow;
  lines: SharedInvoiceLine[];
  business: SharedBusiness;
}

const isShared = (token: string) =>
  and(
    eq(invoices.publicToken, token),
    isNull(invoices.tokenRevokedAt),
    ne(invoices.status, "DRAFT"),
  );

export async function sharedInvoiceExists(db: Executor, token: string): Promise<boolean> {
  const [row] = await db.select({ id: invoices.id }).from(invoices).where(isShared(token)).limit(1);
  return row !== undefined;
}

export async function findSharedInvoice(
  db: Executor,
  token: string,
): Promise<SharedInvoice | undefined> {
  const [row] = await db
    .select({
      invoice: invoices,
      business: {
        legalName: businesses.legalName,
        tradeName: businesses.tradeName,
        upiVpa: businesses.upiVpa,
        bankAccountName: businesses.bankAccountName,
        bankAccountNumber: businesses.bankAccountNumber,
        bankIfsc: businesses.bankIfsc,
        bankName: businesses.bankName,
      },
    })
    .from(invoices)
    .innerJoin(businesses, eq(businesses.id, invoices.businessId))
    .where(isShared(token))
    .limit(1);
  if (!row) return undefined;
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(
      and(
        eq(invoiceLines.businessId, row.invoice.businessId),
        eq(invoiceLines.invoiceId, row.invoice.id),
      ),
    )
    .orderBy(asc(invoiceLines.position));
  return { invoice: row.invoice, lines, business: row.business };
}
