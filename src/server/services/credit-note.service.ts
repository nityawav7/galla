import { ConflictError, type FieldIssue, NotFoundError, ValidationError } from "@/lib/errors";
import { cancelSchema, creditNoteSchema } from "@/lib/validation/invoices";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import {
  type CreditNote,
  type CreditNoteLine,
  findCreditNoteById,
  findCreditNoteLines,
  insertCreditNote,
  insertCreditNoteLines,
  returnedByInvoiceLine,
} from "@/server/db/repos/credit-notes.repo";
import {
  addCredited,
  findInvoiceById,
  findInvoiceLines,
  type Invoice,
  lockInvoice,
  markCancelled,
} from "@/server/db/repos/invoices.repo";
import { takeNextNumber } from "@/server/db/repos/number-sequences.repo";
import { withTransaction } from "@/server/db/transaction";
import { fyForDate, istDateFromInstant } from "@/server/domain/fy";
import { creditForReturn, creditNoteTotals, type LineCredit } from "@/server/domain/invoice/credit";
import { supplierSnapshot } from "@/server/domain/invoice/snapshot";
import { balancePaise } from "@/server/domain/invoice/status";
import { formatDocumentNumber } from "@/server/domain/numbering";

import { requireId } from "./ids";
import { parseInput } from "./validate";

/*
 * Cancelling invoices and issuing credit notes (SPEC §4.8, ADR 0007). Both are owner-only
 * (`invoice:cancel`), lock the invoice row first so they can't race each other or a second
 * attempt, and write their audit row in the same transaction.
 */

export type { CreditNote, CreditNoteLine };

export interface CreditNoteDetail {
  creditNote: CreditNote;
  lines: CreditNoteLine[];
  invoice: { id: string; number: string | null };
}

function invalid(issues: FieldIssue[]): ValidationError {
  return new ValidationError("Some fields need attention", issues);
}

/** The invoice may take a cancellation or a credit note only once it is issued and live. */
function assertIssued(invoice: Invoice): void {
  if (invoice.status === "DRAFT") throw new ConflictError("invoiceNotIssued");
  if (invoice.status === "CANCELLED") throw new ConflictError("invoiceCancelled");
}

/**
 * Cancels an issued invoice (SPEC §4.8). It keeps its number and lines; nothing paid or credited
 * may hang off it (decision 6 of the Phase 6 plan), so the fix after a payment or credit note is
 * a credit note.
 */
export async function cancelInvoice(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<Invoice> {
  assertCan(ctx, "invoice:cancel");
  const invoiceId = requireId(id, "Invoice");
  const { reason } = parseInput(cancelSchema, input);
  return withTransaction(async (tx) => {
    const invoice = await lockInvoice(tx, ctx, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice");
    assertIssued(invoice);
    if (invoice.amountPaidPaise > 0n) throw new ConflictError("invoiceHasPayments");
    if (invoice.amountCreditedPaise > 0n) throw new ConflictError("invoiceHasCredits");
    const cancelled = await markCancelled(tx, ctx, invoice.id, reason, now());
    if (!cancelled) throw new Error("locked invoice changed while cancelling");
    await insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: invoice.id,
      action: "invoice.cancelled",
      diff: {
        before: { status: invoice.status },
        after: { status: "CANCELLED", number: invoice.number, reason },
      },
    });
    return cancelled;
  });
}

/**
 * Issues a credit note returning quantities of an issued invoice's lines (ADR 0007). Each line is
 * credited at the invoice line's own amounts; the total can't exceed the invoice's balance
 * (SPEC §4.8). It takes the next number of the business's credit-note series.
 */
export async function createCreditNote(
  ctx: TenantContext,
  invoiceId: string,
  input: unknown,
): Promise<CreditNote> {
  assertCan(ctx, "invoice:cancel");
  const id = requireId(invoiceId, "Invoice");
  const { reason, lines: returns } = parseInput(creditNoteSchema, input);

  return withTransaction(async (tx) => {
    // The lock serialises credit notes on one invoice, so together they never over-credit.
    const invoice = await lockInvoice(tx, ctx, id);
    if (!invoice) throw new NotFoundError("Invoice");
    assertIssued(invoice);
    const [invoiceLines, returned, business] = await Promise.all([
      findInvoiceLines(tx, ctx, invoice.id),
      returnedByInvoiceLine(tx, ctx, invoice.id),
      getCurrentBusiness(tx, ctx),
    ]);
    if (!business) throw new NotFoundError("Business");

    const byId = new Map(invoiceLines.map((line) => [line.id, line]));
    const issues: FieldIssue[] = [];
    const seen = new Set<string>();
    const credits: { lineId: string; qtyMilli: bigint; credit: LineCredit }[] = [];
    returns.forEach((item, index) => {
      const path = `lines.${String(index)}`;
      const line = byId.get(item.invoiceLineId);
      if (!line) {
        issues.push({ path: `${path}.invoiceLineId`, message: "lineNotOnInvoice" });
        return;
      }
      if (seen.has(line.id)) {
        issues.push({ path: `${path}.invoiceLineId`, message: "duplicateLine" });
        return;
      }
      seen.add(line.id);
      try {
        const credit = creditForReturn(line, returned.get(line.id) ?? 0n, item.qty);
        credits.push({ lineId: line.id, qtyMilli: item.qty, credit });
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        issues.push(...error.issues.map((issue) => ({ ...issue, path: `${path}.${issue.path}` })));
      }
    });
    if (issues.length > 0) throw invalid(issues);

    // The note that returns the last unit of the invoice also carries its round-off.
    const thisReturn = new Map(credits.map((item) => [item.lineId, item.qtyMilli]));
    const completes = invoiceLines.every(
      (line) => (returned.get(line.id) ?? 0n) + (thisReturn.get(line.id) ?? 0n) === line.qtyMilli,
    );
    const totals = creditNoteTotals(
      credits.map((item) => item.credit),
      completes ? invoice.roundOffPaise : null,
    );
    if (totals.grandTotalPaise > balancePaise(invoice)) {
      throw invalid([{ path: "lines", message: "creditExceedsBalance" }]);
    }

    const noteDate = istDateFromInstant(now());
    const fy = fyForDate(noteDate);
    const number = formatDocumentNumber(
      business.creditNotePrefix,
      fy,
      await takeNextNumber(tx, ctx, "CN", fy),
    );
    const note = await insertCreditNote(tx, ctx, {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      number,
      fy,
      noteDate,
      reason,
      customerSnapshot: invoice.customerSnapshot ?? {
        name: "",
        gstin: null,
        phoneE164: null,
        email: null,
        billing: null,
        shipping: null,
      },
      supplierSnapshot: supplierSnapshot(business),
      placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
      isInterState: invoice.isInterState,
      ...totals,
    });
    await insertCreditNoteLines(
      tx,
      ctx,
      note.id,
      credits.map(({ lineId, qtyMilli, credit }, index) => {
        const line = byId.get(lineId);
        if (!line) throw new Error("credited line vanished");
        return {
          position: index + 1,
          invoiceLineId: line.id,
          productId: line.productId,
          description: line.description,
          hsnSac: line.hsnSac,
          unit: line.unit,
          qtyMilli,
          unitPricePaise: line.unitPricePaise,
          priceIncludesTax: line.priceIncludesTax,
          discountPaise: credit.discountPaise,
          rateBp: line.rateBp,
          taxablePaise: credit.taxablePaise,
          cgstPaise: credit.cgstPaise,
          sgstPaise: credit.sgstPaise,
          utgstPaise: credit.utgstPaise,
          igstPaise: credit.igstPaise,
          lineTotalPaise: credit.totalPaise,
        };
      }),
    );
    await addCredited(tx, ctx, invoice.id, totals.grandTotalPaise);
    await insertAuditLog(tx, ctx, {
      entity: "creditNote",
      entityId: note.id,
      action: "creditNote.issued",
      diff: {
        after: {
          number,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          lineCount: credits.length,
          completesInvoice: completes,
          grandTotalPaise: totals.grandTotalPaise.toString(),
        },
      },
    });
    return note;
  });
}

export async function getCreditNote(ctx: TenantContext, id: string): Promise<CreditNoteDetail> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const creditNote = await findCreditNoteById(db, ctx, requireId(id, "Credit note"));
  if (!creditNote) throw new NotFoundError("Credit note");
  const [lines, invoice] = await Promise.all([
    findCreditNoteLines(db, ctx, creditNote.id),
    findInvoiceById(db, ctx, creditNote.invoiceId),
  ]);
  return {
    creditNote,
    lines,
    invoice: { id: creditNote.invoiceId, number: invoice?.number ?? null },
  };
}
