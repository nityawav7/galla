import { and, asc, between, eq, inArray, ne } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";
import { type Gstr1Invoice, type Gstr1Line, type Gstr1Note } from "@/server/domain/gstr1/build";

import { creditNoteLines, creditNotes, invoiceLines, invoices, units } from "../schema";
import { type Executor } from "../transaction";
import { tenantScope } from "./tenant";

/*
 * What the GSTR-1 helper reads (SPEC §4.10): issued and cancelled invoices and credit notes dated
 * in a return period, with their lines, all filtered by `business_id`. Recipient GSTIN and name
 * come from the snapshots taken at issue, as printed on the documents.
 */

export interface Range {
  from: string;
  to: string;
}

/** "NOS-NUMBERS", as the GST offline tool writes a unit. */
function uqc(code: string, label: string | null): string {
  return label ? `${code}-${label.toUpperCase()}` : code;
}

function toLine(row: {
  rateBp: number;
  taxablePaise: bigint;
  igstPaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  hsn: string | null;
  unit: string;
  unitLabel: string | null;
  qtyMilli: bigint;
}): Gstr1Line {
  const { unit, unitLabel, ...line } = row;
  return { ...line, uqc: uqc(unit, unitLabel) };
}

function grouped<T extends { documentId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(row.documentId, [...(map.get(row.documentId) ?? []), row]);
  return map;
}

export async function gstr1Invoices(
  db: Executor,
  ctx: TenantContext,
  range: Range,
): Promise<Gstr1Invoice[]> {
  const headers = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      date: invoices.invoiceDate,
      status: invoices.status,
      snapshot: invoices.customerSnapshot,
      placeOfSupply: invoices.placeOfSupplyStateCode,
      interState: invoices.isInterState,
      totalPaise: invoices.grandTotalPaise,
    })
    .from(invoices)
    .where(
      tenantScope(
        ctx,
        invoices,
        ne(invoices.status, "DRAFT"),
        between(invoices.invoiceDate, range.from, range.to),
      ),
    )
    .orderBy(asc(invoices.invoiceDate), asc(invoices.number));
  if (headers.length === 0) return [];
  const lines = grouped(
    await db
      .select({
        documentId: invoiceLines.invoiceId,
        rateBp: invoiceLines.rateBp,
        taxablePaise: invoiceLines.taxablePaise,
        igstPaise: invoiceLines.igstPaise,
        cgstPaise: invoiceLines.cgstPaise,
        sgstPaise: invoiceLines.sgstPaise,
        utgstPaise: invoiceLines.utgstPaise,
        hsn: invoiceLines.hsnSac,
        unit: invoiceLines.unit,
        unitLabel: units.label,
        qtyMilli: invoiceLines.qtyMilli,
      })
      .from(invoiceLines)
      .leftJoin(units, eq(units.uqcCode, invoiceLines.unit))
      .where(
        tenantScope(
          ctx,
          invoiceLines,
          inArray(
            invoiceLines.invoiceId,
            headers.map((header) => header.id),
          ),
        ),
      )
      .orderBy(asc(invoiceLines.position)),
  );
  return headers.map((header) => ({
    number: header.number ?? "",
    date: header.date,
    cancelled: header.status === "CANCELLED",
    recipientGstin: header.snapshot?.gstin ?? null,
    recipientName: header.snapshot && header.snapshot.name.length > 0 ? header.snapshot.name : null,
    placeOfSupply: header.placeOfSupply,
    interState: header.interState,
    totalPaise: header.totalPaise,
    lines: (lines.get(header.id) ?? []).map(toLine),
  }));
}

export async function gstr1Notes(
  db: Executor,
  ctx: TenantContext,
  range: Range,
): Promise<Gstr1Note[]> {
  const headers = await db
    .select({
      id: creditNotes.id,
      number: creditNotes.number,
      date: creditNotes.noteDate,
      snapshot: creditNotes.customerSnapshot,
      placeOfSupply: creditNotes.placeOfSupplyStateCode,
      interState: creditNotes.isInterState,
      totalPaise: creditNotes.grandTotalPaise,
      invoiceTotalPaise: invoices.grandTotalPaise,
    })
    .from(creditNotes)
    .innerJoin(
      invoices,
      and(eq(invoices.businessId, creditNotes.businessId), eq(invoices.id, creditNotes.invoiceId)),
    )
    .where(tenantScope(ctx, creditNotes, between(creditNotes.noteDate, range.from, range.to)))
    .orderBy(asc(creditNotes.noteDate), asc(creditNotes.number));
  if (headers.length === 0) return [];
  const lines = grouped(
    await db
      .select({
        documentId: creditNoteLines.creditNoteId,
        rateBp: creditNoteLines.rateBp,
        taxablePaise: creditNoteLines.taxablePaise,
        igstPaise: creditNoteLines.igstPaise,
        cgstPaise: creditNoteLines.cgstPaise,
        sgstPaise: creditNoteLines.sgstPaise,
        utgstPaise: creditNoteLines.utgstPaise,
        hsn: creditNoteLines.hsnSac,
        unit: creditNoteLines.unit,
        unitLabel: units.label,
        qtyMilli: creditNoteLines.qtyMilli,
      })
      .from(creditNoteLines)
      .leftJoin(units, eq(units.uqcCode, creditNoteLines.unit))
      .where(
        tenantScope(
          ctx,
          creditNoteLines,
          inArray(
            creditNoteLines.creditNoteId,
            headers.map((header) => header.id),
          ),
        ),
      )
      .orderBy(asc(creditNoteLines.position)),
  );
  return headers.map((header) => ({
    number: header.number,
    date: header.date,
    recipientGstin: header.snapshot.gstin,
    recipientName: header.snapshot.name.length > 0 ? header.snapshot.name : null,
    placeOfSupply: header.placeOfSupply,
    interState: header.interState,
    totalPaise: header.totalPaise,
    invoiceTotalPaise: header.invoiceTotalPaise,
    lines: (lines.get(header.id) ?? []).map(toLine),
  }));
}
