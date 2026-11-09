import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { RECIPIENT_DETAILS_THRESHOLD_PAISE } from "@/lib/gst-config";
import { type DraftEvaluation, evaluateDraft } from "@/lib/invoice-evaluation";
import {
  draftSchema,
  type InvoiceDraft,
  invoiceListQuerySchema,
  issueSchema,
  type LineOptions,
  updateDraftSchema,
} from "@/lib/validation/invoices";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import { type Business, getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import {
  type CreditNote,
  listCreditNotesForInvoice,
  returnedByInvoiceLine,
} from "@/server/db/repos/credit-notes.repo";
import { decodeDateCursor, encodeDateCursor } from "@/server/db/repos/cursor";
import { type Customer, findCustomerById } from "@/server/db/repos/customers.repo";
import {
  deleteDraftRow,
  type DraftColumns,
  findInvoiceById,
  findInvoiceLines,
  insertDraft,
  insertInvoiceLines,
  type Invoice,
  type InvoiceLine,
  type InvoiceListRow,
  listInvoices as listInvoiceRows,
  lockInvoice,
  markIssued,
  updateDraftRow,
} from "@/server/db/repos/invoices.repo";
import { takeNextNumber } from "@/server/db/repos/number-sequences.repo";
import { findProductsByIds, type Product } from "@/server/db/repos/products.repo";
import { listStates, listTaxRates, listUnits } from "@/server/db/repos/reference.repo";
import { type Executor, withTransaction } from "@/server/db/transaction";
import { fyForDate, istDateFromInstant } from "@/server/domain/fy";
import { type InvoiceTotals } from "@/server/domain/gst/calc";
import {
  checkIssuable,
  type HsnDigits,
  type IssueWarning,
  unacknowledged,
} from "@/server/domain/invoice/issue-rules";
import {
  customerSnapshot,
  supplierSnapshot,
  walkInSnapshot,
} from "@/server/domain/invoice/snapshot";
import { formatDocumentNumber } from "@/server/domain/numbering";

import { requireId } from "./ids";
import { newPublicToken } from "./tokens";
import { parseInput } from "./validate";

/*
 * Invoices (SPEC F4, §4.5–4.8, ADR 0006). Every function checks the role first. Totals are
 * always recomputed here from the draft's lines with the domain engine (CLAUDE.md rule 2): no
 * input carries a total. Issuing locks the invoice row, writes the line snapshots, then takes
 * the next number as late as possible, all in one transaction with its audit row.
 */

export type { Invoice, InvoiceLine, InvoiceListRow };

export const INVOICES_PAGE_SIZE = 50;

export interface BuilderOptions {
  business: {
    gstScheme: Business["gstScheme"];
    stateCode: string;
    roundOffEnabled: boolean;
    hsnDigitsRequired: HsnDigits;
    invoicePrefix: string;
  };
  rates: { rateBp: number; label: string }[];
  units: { code: string; label: string }[];
  states: { code: string; name: string }[];
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  /** Newest first. */
  creditNotes: CreditNote[];
  /** Quantity already returned by credit notes, per invoice line id (milli-units). */
  returnedMilli: Map<string, bigint>;
}

export interface InvoicePage {
  items: InvoiceListRow[];
  nextCursor: string | null;
}

export type IssueResult =
  | { status: "issued"; invoice: Invoice }
  /** Nothing was written; issue again with these in `acknowledgedWarnings`. */
  | { status: "needsConfirmation"; warnings: IssueWarning[] };

/** Everything a draft or an issue is evaluated against, loaded inside the caller's transaction. */
interface Context {
  business: Business;
  customer: Customer | null;
  products: ReadonlyMap<string, Product>;
  options: LineOptions;
  invoiceDate: string;
}

interface Evaluation extends DraftEvaluation {
  columns: DraftColumns;
}

// --- helpers ------------------------------------------------------------------------------

/** Audit diffs are JSON, which has no bigint: money goes in as a decimal string of paise. */
function money(totals: InvoiceTotals): Record<string, string> {
  return {
    taxablePaise: totals.taxablePaise.toString(),
    taxPaise: totals.taxPaise.toString(),
    roundOffPaise: totals.roundOffPaise.toString(),
    grandTotalPaise: totals.grandTotalPaise.toString(),
  };
}

function hsnDigits(value: number): HsnDigits {
  return value === 6 ? 6 : 4;
}

async function businessOrThrow(db: Executor, ctx: TenantContext): Promise<Business> {
  const business = await getCurrentBusiness(db, ctx);
  if (!business) throw new NotFoundError("Business");
  return business;
}

async function loadLineOptions(db: Executor): Promise<LineOptions> {
  const [units, rates] = await Promise.all([listUnits(db), listTaxRates(db)]);
  return { units: units.map((unit) => unit.uqcCode), rateBps: rates.map((rate) => rate.rateBp) };
}

/** The customer and products a draft points at, all inside ctx's business (else NotFound). */
async function loadContext(
  db: Executor,
  ctx: TenantContext,
  draft: InvoiceDraft,
): Promise<Context> {
  const productIds = [
    ...new Set(draft.lines.flatMap((line) => (line.productId ? [line.productId] : []))),
  ];
  const [business, customer, products, options] = await Promise.all([
    businessOrThrow(db, ctx),
    draft.customerId ? findCustomerById(db, ctx, draft.customerId) : Promise.resolve(null),
    findProductsByIds(db, ctx, productIds),
    loadLineOptions(db),
  ]);
  if (customer === undefined) throw new NotFoundError("Customer");
  if (products.length !== productIds.length) throw new NotFoundError("Product");
  return {
    business,
    customer,
    products: new Map(products.map((product) => [product.id, product])),
    options,
    invoiceDate: istDateFromInstant(now()),
  };
}

/** Recomputes everything about a draft from its lines (CLAUDE.md rule 2). */
function evaluate(draft: InvoiceDraft, context: Context): Evaluation {
  const evaluation = evaluateDraft({
    draft,
    business: context.business,
    customer: context.customer,
    products: context.products,
    options: context.options,
    invoiceDate: context.invoiceDate,
  });
  const { totals } = evaluation;
  return {
    ...evaluation,
    columns: {
      type: evaluation.documentType,
      invoiceDate: context.invoiceDate,
      dueDate: evaluation.dueDate,
      customerId: draft.customerId,
      placeOfSupplyStateCode: evaluation.placeOfSupplyStateCode,
      isInterState: evaluation.isInterState,
      notes: draft.notes.trim() || null,
      draft,
      discountPaise: totals.discountPaise,
      taxablePaise: totals.taxablePaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      utgstPaise: totals.utgstPaise,
      igstPaise: totals.igstPaise,
      roundOffPaise: totals.roundOffPaise,
      grandTotalPaise: totals.grandTotalPaise,
    },
  };
}

/** Why a draft save or issue touched nothing: gone, issued meanwhile, or saved elsewhere. */
async function explainMissingDraft(db: Executor, ctx: TenantContext, id: string): Promise<never> {
  const current = await findInvoiceById(db, ctx, id);
  if (!current) throw new NotFoundError("Invoice");
  if (current.status !== "DRAFT") throw new ConflictError("invoiceAlreadyIssued");
  throw new ConflictError("draftEditedElsewhere");
}

// --- reads -------------------------------------------------------------------------------

/** What the invoice builder needs besides the draft itself. */
export async function getBuilderOptions(ctx: TenantContext): Promise<BuilderOptions> {
  assertCan(ctx, "invoice:issue");
  const db = getDb();
  const [business, units, rates, states] = await Promise.all([
    businessOrThrow(db, ctx),
    listUnits(db),
    listTaxRates(db),
    listStates(db),
  ]);
  return {
    business: {
      gstScheme: business.gstScheme,
      stateCode: business.stateCode,
      roundOffEnabled: business.roundOffEnabled,
      hsnDigitsRequired: hsnDigits(business.hsnDigitsRequired),
      invoicePrefix: business.invoicePrefix,
    },
    rates: rates.map((rate) => ({ rateBp: rate.rateBp, label: rate.label })),
    units: units.map((unit) => ({ code: unit.uqcCode, label: unit.label })),
    states: states.map((state) => ({ code: state.code, name: state.name })),
  };
}

export async function getInvoice(ctx: TenantContext, id: string): Promise<InvoiceDetail> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const invoice = await findInvoiceById(db, ctx, requireId(id, "Invoice"));
  if (!invoice) throw new NotFoundError("Invoice");
  const [lines, creditNotes, returnedMilli] = await Promise.all([
    findInvoiceLines(db, ctx, invoice.id),
    listCreditNotesForInvoice(db, ctx, invoice.id),
    returnedByInvoiceLine(db, ctx, invoice.id),
  ]);
  return { invoice, lines, creditNotes, returnedMilli };
}

export async function listInvoices(ctx: TenantContext, query: unknown): Promise<InvoicePage> {
  assertCan(ctx, "records:view");
  const { status, from, to, customer, q, cursor } = invoiceListQuerySchema.parse(query);
  const rows = await listInvoiceRows(getDb(), ctx, {
    status,
    today: istDateFromInstant(now()),
    from,
    to,
    customerId: customer,
    search: q,
    limit: INVOICES_PAGE_SIZE + 1,
    after: decodeDateCursor(cursor),
  });
  const items = rows.slice(0, INVOICES_PAGE_SIZE);
  const last = items.at(-1)?.invoice;
  const hasMore = rows.length > INVOICES_PAGE_SIZE && last !== undefined;
  return {
    items,
    nextCursor: hasMore ? encodeDateCursor({ date: last.invoiceDate, id: last.id }) : null,
  };
}

// --- drafts ------------------------------------------------------------------------------

/** A new draft (SPEC F4). Half-typed lines are kept; totals count the lines that are valid. */
export async function createDraft(ctx: TenantContext, input: unknown): Promise<Invoice> {
  assertCan(ctx, "invoice:issue");
  const draft = parseInput(draftSchema, input);
  return withTransaction(async (tx) => {
    const { columns } = evaluate(draft, await loadContext(tx, ctx, draft));
    const row = await insertDraft(tx, ctx, columns);
    await insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: row.id,
      action: "invoice.draftCreated",
      diff: { after: { customerId: row.customerId, lineCount: draft.lines.length } },
    });
    return row;
  });
}

/**
 * Autosave. Writes no audit row (decision 3 of the Phase 6 plan): drafts are not financial
 * records yet, and the issue row records the final invoice.
 */
export async function updateDraft(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<Invoice> {
  assertCan(ctx, "invoice:issue");
  const invoiceId = requireId(id, "Invoice");
  const { version, draft } = parseInput(updateDraftSchema, input);
  const db = getDb();
  const { columns } = evaluate(draft, await loadContext(db, ctx, draft));
  const row = await updateDraftRow(db, ctx, invoiceId, version, columns);
  return row ?? explainMissingDraft(db, ctx, invoiceId);
}

export async function deleteDraft(ctx: TenantContext, id: string): Promise<void> {
  assertCan(ctx, "invoice:issue");
  const invoiceId = requireId(id, "Invoice");
  await withTransaction(async (tx) => {
    const row = await deleteDraftRow(tx, ctx, invoiceId);
    if (!row) {
      const current = await findInvoiceById(tx, ctx, invoiceId);
      if (!current) throw new NotFoundError("Invoice");
      throw new ConflictError("invoiceAlreadyIssued");
    }
    await insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: row.id,
      action: "invoice.draftDeleted",
      diff: {
        before: { customerId: row.customerId, grandTotalPaise: row.grandTotalPaise.toString() },
      },
    });
  });
}

// --- issue -------------------------------------------------------------------------------

/**
 * Issues a draft (SPEC §4.6, §4.8): assigns the next gapless number and makes it immutable.
 * Returns `needsConfirmation` (writing nothing) while a warning is not acknowledged.
 */
export async function issueInvoice(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<IssueResult> {
  assertCan(ctx, "invoice:issue");
  const invoiceId = requireId(id, "Invoice");
  const { version, acknowledgedWarnings } = parseInput(issueSchema, input);

  return withTransaction(async (tx) => {
    // 1. Lock the draft: a double click or a second tab waits here, then sees it issued.
    const current = await lockInvoice(tx, ctx, invoiceId);
    if (!current) throw new NotFoundError("Invoice");
    if (current.status !== "DRAFT" || current.draft === null) {
      throw new ConflictError("invoiceAlreadyIssued");
    }
    if (current.version !== version) throw new ConflictError("draftEditedElsewhere");

    // 2. Recompute from the stored draft with today's business, customer and products.
    const draft = parseInput(draftSchema, current.draft);
    const context = await loadContext(tx, ctx, draft);
    const { customer, business } = context;
    if (customer?.archivedAt) throw new ConflictError("customerArchived");
    const evaluation = evaluate(draft, context);
    // Field problems first; the invoice-level rules need valid lines to judge.
    if (evaluation.issues.length > 0) {
      throw new ValidationError("Some fields need attention", evaluation.issues);
    }
    const rules = checkIssuable({
      documentType: evaluation.documentType,
      recipient: {
        customerId: customer?.id ?? null,
        name: customer?.name ?? draft.walkInName,
        gstin: customer?.gstin ?? null,
        addressLine1: customer?.billingAddressLine1 ?? null,
        stateCode: customer?.billingStateCode ?? null,
      },
      lines: evaluation.lines.map(({ line }) => line),
      hsnDigitsRequired: hsnDigits(business.hsnDigitsRequired),
      grandTotalPaise: evaluation.totals.grandTotalPaise,
      recipientDetailsThresholdPaise: RECIPIENT_DETAILS_THRESHOLD_PAISE,
      placeOfSupplyWarnings: evaluation.placeOfSupply?.warnings ?? [],
    });
    if (rules.errors.length > 0) {
      throw new ValidationError("Some fields need attention", rules.errors);
    }
    const pending = unacknowledged(rules.warnings, acknowledgedWarnings);
    if (pending.length > 0) return { status: "needsConfirmation", warnings: pending };

    // 3. Line snapshots, while the invoice is still a draft (the DB trigger requires it).
    await insertInvoiceLines(
      tx,
      ctx,
      invoiceId,
      evaluation.lines.map(({ line, amounts }, index) => ({
        position: index + 1,
        productId: line.productId,
        description: line.description,
        hsnSac: line.hsnSac,
        unit: line.unit,
        qtyMilli: line.qtyMilli,
        unitPricePaise: line.unitPricePaise,
        priceIncludesTax: line.priceIncludesTax,
        discountPaise: amounts.discountPaise,
        rateBp: line.rateBp,
        taxablePaise: amounts.taxablePaise,
        cgstPaise: amounts.cgstPaise,
        sgstPaise: amounts.sgstPaise,
        utgstPaise: amounts.utgstPaise,
        igstPaise: amounts.igstPaise,
        lineTotalPaise: amounts.totalPaise,
      })),
    );

    // 4. The number, as late as possible so the sequence row stays locked only briefly.
    const fy = fyForDate(context.invoiceDate);
    const number = formatDocumentNumber(
      business.invoicePrefix,
      fy,
      await takeNextNumber(tx, ctx, "INV", fy),
    );

    const issued = await markIssued(tx, ctx, invoiceId, {
      ...evaluation.columns,
      number,
      fy,
      customerSnapshot: customer ? customerSnapshot(customer) : walkInSnapshot(draft.walkInName),
      supplierSnapshot: supplierSnapshot(business),
      publicToken: newPublicToken(),
      issuedAt: now(),
    });
    if (!issued) throw new Error("locked draft vanished while issuing");

    await insertAuditLog(tx, ctx, {
      entity: "invoice",
      entityId: issued.id,
      action: "invoice.issued",
      diff: {
        after: {
          number,
          type: issued.type,
          invoiceDate: issued.invoiceDate,
          placeOfSupplyStateCode: issued.placeOfSupplyStateCode,
          customerId: issued.customerId,
          lineCount: evaluation.lines.length,
          acknowledgedWarnings: rules.warnings,
          ...money(evaluation.totals),
        },
      },
    });
    return { status: "issued", invoice: issued };
  });
}
