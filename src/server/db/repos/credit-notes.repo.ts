import { asc, desc, eq, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { creditNoteLines, creditNotes } from "../schema";
import { type Executor, type Transaction } from "../transaction";
import { type TenantOwned, tenantScope } from "./tenant";

export type CreditNote = typeof creditNotes.$inferSelect;
export type CreditNoteLine = typeof creditNoteLines.$inferSelect;
export type NewCreditNote = Omit<typeof creditNotes.$inferInsert, TenantOwned | "issuedAt">;
export type NewCreditNoteLine = Omit<
  typeof creditNoteLines.$inferInsert,
  TenantOwned | "creditNoteId"
>;

// Credit notes are append-only (a DB trigger refuses updates and deletes, ADR 0006).

export async function insertCreditNote(
  tx: Transaction,
  ctx: TenantContext,
  values: NewCreditNote,
): Promise<CreditNote> {
  const [row] = await tx
    .insert(creditNotes)
    .values({ ...values, businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function insertCreditNoteLines(
  tx: Transaction,
  ctx: TenantContext,
  creditNoteId: string,
  lines: readonly NewCreditNoteLine[],
): Promise<CreditNoteLine[]> {
  if (lines.length === 0) return [];
  return tx
    .insert(creditNoteLines)
    .values(
      lines.map((line) => ({
        ...line,
        creditNoteId,
        businessId: ctx.businessId,
        createdBy: ctx.userId,
      })),
    )
    .returning();
}

export async function findCreditNoteById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<CreditNote | undefined> {
  const [row] = await db
    .select()
    .from(creditNotes)
    .where(tenantScope(ctx, creditNotes, eq(creditNotes.id, id)));
  return row;
}

export function findCreditNoteLines(
  db: Executor,
  ctx: TenantContext,
  creditNoteId: string,
): Promise<CreditNoteLine[]> {
  return db
    .select()
    .from(creditNoteLines)
    .where(tenantScope(ctx, creditNoteLines, eq(creditNoteLines.creditNoteId, creditNoteId)))
    .orderBy(asc(creditNoteLines.position));
}

/** The invoice's credit notes, newest first. */
export function listCreditNotesForInvoice(
  db: Executor,
  ctx: TenantContext,
  invoiceId: string,
): Promise<CreditNote[]> {
  return db
    .select()
    .from(creditNotes)
    .where(tenantScope(ctx, creditNotes, eq(creditNotes.invoiceId, invoiceId)))
    .orderBy(desc(creditNotes.issuedAt), desc(creditNotes.id));
}

/** Quantity already returned per invoice line (milli-units), across the invoice's credit notes. */
export async function returnedByInvoiceLine(
  db: Executor,
  ctx: TenantContext,
  invoiceId: string,
): Promise<Map<string, bigint>> {
  const rows = await db
    .select({
      invoiceLineId: creditNoteLines.invoiceLineId,
      returned: sql<string>`sum(${creditNoteLines.qtyMilli})`,
    })
    .from(creditNoteLines)
    .innerJoin(
      creditNotes,
      sql`${creditNotes.businessId} = ${creditNoteLines.businessId} and ${creditNotes.id} = ${creditNoteLines.creditNoteId}`,
    )
    .where(tenantScope(ctx, creditNoteLines, eq(creditNotes.invoiceId, invoiceId)))
    .groupBy(creditNoteLines.invoiceLineId);
  return new Map(rows.map((row) => [row.invoiceLineId, BigInt(row.returned)]));
}
