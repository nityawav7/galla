import { and, asc, desc, eq, gte, inArray, lte, or, type SQL, sql } from "drizzle-orm";

import { type InvoiceListStatus } from "@/lib/validation/invoices";
import { type TenantContext } from "@/server/authz/context";

import { customers, invoiceLines, invoices } from "../schema";
import { type Executor, type Transaction } from "../transaction";
import { type DateCursor } from "./cursor";
import { escapeLike, type TenantOwned, tenantScope } from "./tenant";

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;

/** Columns a draft save may set; the service computes all of them. */
export type DraftColumns = Pick<
  typeof invoices.$inferInsert,
  | "type"
  | "invoiceDate"
  | "dueDate"
  | "customerId"
  | "placeOfSupplyStateCode"
  | "isInterState"
  | "notes"
  | "draft"
  | "discountPaise"
  | "taxablePaise"
  | "cgstPaise"
  | "sgstPaise"
  | "utgstPaise"
  | "igstPaise"
  | "roundOffPaise"
  | "grandTotalPaise"
>;

/** Everything issuing sets on the row. */
export type IssueColumns = DraftColumns &
  Required<
    Pick<
      typeof invoices.$inferInsert,
      "number" | "fy" | "customerSnapshot" | "supplierSnapshot" | "publicToken" | "issuedAt"
    >
  >;

export type NewInvoiceLine = Omit<typeof invoiceLines.$inferInsert, TenantOwned | "invoiceId">;

export interface ListInvoicesOptions {
  status?: InvoiceListStatus;
  /** Today in Asia/Kolkata (ISO date), for OVERDUE. */
  today: string;
  from?: string;
  to?: string;
  customerId?: string;
  /** A number prefix ("INV/26-27/00") or part of the customer's name. */
  search?: string;
  limit: number;
  /** Keyset pagination (newest first): rows after this one. */
  after?: DateCursor;
}

export interface InvoiceListRow {
  invoice: Invoice;
  /** As issued, or the current customer or typed walk-in name for a draft. */
  customerName: string;
}

const balance = sql`(${invoices.grandTotalPaise} - ${invoices.amountPaidPaise} - ${invoices.amountCreditedPaise})`;
const open = inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID", "PAID"]);

function statusFilter(status: InvoiceListStatus | undefined, today: string): SQL | undefined {
  switch (status) {
    case undefined:
      return undefined;
    case "DRAFT":
    case "CANCELLED":
      return eq(invoices.status, status);
    case "UNPAID":
      return and(open, sql`${balance} > 0`);
    case "OVERDUE":
      return and(open, sql`${balance} > 0`, sql`${invoices.dueDate} < ${today}`);
    case "PAID":
      return and(open, sql`${balance} = 0`);
  }
}

export async function insertDraft(
  db: Executor,
  ctx: TenantContext,
  values: DraftColumns,
): Promise<Invoice> {
  const [row] = await db
    .insert(invoices)
    .values({ ...values, status: "DRAFT", businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function findInvoiceById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Invoice | undefined> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(tenantScope(ctx, invoices, eq(invoices.id, id)));
  return row;
}

/**
 * Reads the invoice and locks its row until the transaction ends, so two issues (or an issue
 * and an autosave) of the same invoice run one after the other.
 */
export async function lockInvoice(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Invoice | undefined> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(tenantScope(ctx, invoices, eq(invoices.id, id)))
    .for("update");
  return row;
}

/**
 * Saves a draft if it is still a draft at `expectedVersion` (optimistic locking), and bumps the
 * version. Undefined means it was issued, deleted or saved by someone else meanwhile.
 */
export async function updateDraftRow(
  db: Executor,
  ctx: TenantContext,
  id: string,
  expectedVersion: number,
  values: DraftColumns,
): Promise<Invoice | undefined> {
  const [row] = await db
    .update(invoices)
    .set({ ...values, businessId: ctx.businessId, version: sql`${invoices.version} + 1` })
    .where(
      tenantScope(
        ctx,
        invoices,
        eq(invoices.id, id),
        eq(invoices.status, "DRAFT"),
        eq(invoices.version, expectedVersion),
      ),
    )
    .returning();
  return row;
}

/** Drafts only; issued invoices are never deleted (the DB trigger refuses too). */
export async function deleteDraftRow(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Invoice | undefined> {
  const [row] = await db
    .delete(invoices)
    .where(tenantScope(ctx, invoices, eq(invoices.id, id), eq(invoices.status, "DRAFT")))
    .returning();
  return row;
}

export async function insertInvoiceLines(
  tx: Transaction,
  ctx: TenantContext,
  invoiceId: string,
  lines: readonly NewInvoiceLine[],
): Promise<InvoiceLine[]> {
  if (lines.length === 0) return [];
  return tx
    .insert(invoiceLines)
    .values(
      lines.map((line) => ({
        ...line,
        invoiceId,
        businessId: ctx.businessId,
        createdBy: ctx.userId,
      })),
    )
    .returning();
}

export function findInvoiceLines(
  db: Executor,
  ctx: TenantContext,
  invoiceId: string,
): Promise<InvoiceLine[]> {
  return db
    .select()
    .from(invoiceLines)
    .where(tenantScope(ctx, invoiceLines, eq(invoiceLines.invoiceId, invoiceId)))
    .orderBy(asc(invoiceLines.position));
}

/** The draft becomes an issued invoice. Call after inserting its lines, in the same `tx`. */
export async function markIssued(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
  values: IssueColumns,
): Promise<Invoice | undefined> {
  const [row] = await tx
    .update(invoices)
    .set({
      ...values,
      businessId: ctx.businessId,
      status: "ISSUED",
      draft: null,
      version: sql`${invoices.version} + 1`,
    })
    .where(tenantScope(ctx, invoices, eq(invoices.id, id), eq(invoices.status, "DRAFT")))
    .returning();
  return row;
}

export async function listInvoices(
  db: Executor,
  ctx: TenantContext,
  { status, today, from, to, customerId, search, limit, after }: ListInvoicesOptions,
): Promise<InvoiceListRow[]> {
  const customerName = sql<string>`coalesce(${invoices.customerSnapshot} ->> 'name', ${customers.name}, ${invoices.draft} ->> 'walkInName', '')`;
  const term = search?.trim();
  const matches = term
    ? or(
        sql`${invoices.number} ilike ${`${escapeLike(term)}%`}`,
        sql`${customerName} ilike ${`%${escapeLike(term)}%`}`,
      )
    : undefined;
  const page = after
    ? sql`(${invoices.invoiceDate}, ${invoices.id}) < (${after.date}::date, ${after.id}::uuid)`
    : undefined;
  const rows = await db
    .select({ invoice: invoices, customerName })
    .from(invoices)
    .leftJoin(
      customers,
      and(eq(customers.businessId, invoices.businessId), eq(customers.id, invoices.customerId)),
    )
    .where(
      tenantScope(
        ctx,
        invoices,
        statusFilter(status, today),
        from ? gte(invoices.invoiceDate, from) : undefined,
        to ? lte(invoices.invoiceDate, to) : undefined,
        customerId ? eq(invoices.customerId, customerId) : undefined,
        matches,
        page,
      ),
    )
    .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
    .limit(limit);
  return rows;
}
