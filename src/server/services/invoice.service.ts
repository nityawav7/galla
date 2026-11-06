import { randomBytes } from "node:crypto";

import { ConflictError, type FieldIssue, NotFoundError, ValidationError } from "@/lib/errors";
import { RECIPIENT_DETAILS_THRESHOLD_PAISE } from "@/lib/gst-config";
import {
  type DraftLine,
  draftSchema,
  type InvoiceDraft,
  invoiceListQuerySchema,
  type IssueLine,
  issueLineSchema,
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
import { addDays, fyForDate, istDateFromInstant } from "@/server/domain/fy";
import {
  computeInvoice,
  computeLine,
  type InvoiceTotals,
  type LineAmounts,
} from "@/server/domain/gst/calc";
import {
  determinePlaceOfSupply,
  type DocumentType,
  documentTypeFor,
  type PlaceOfSupply,
  type TaxMode,
} from "@/server/domain/gst/place-of-supply";
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
import { isActiveStateCode } from "@/server/domain/states";

import { requireId } from "./ids";
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

interface Evaluation {
  columns: DraftColumns;
  /** Every problem found; a draft is saved anyway, an issue is refused. */
  issues: FieldIssue[];
  /** The lines that passed, with their amounts, in order. */
  lines: { line: IssueLine; amounts: LineAmounts }[];
  placeOfSupply: PlaceOfSupply | null;
  documentType: DocumentType;
  totals: InvoiceTotals;
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

function prefixIssues(path: string, issues: readonly FieldIssue[]): FieldIssue[] {
  return issues.map((issue) => ({ ...issue, path: issue.path ? `${path}.${issue.path}` : path }));
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

/**
 * A product line takes its HSN, unit, GST rate and "price includes tax" from the product, so
 * the client can't change the rate of a catalogue item. Without GST (`NONE`) the rate is 0.
 */
function resolveLine(line: DraftLine, context: Context, taxMode: TaxMode) {
  const product = line.productId ? context.products.get(line.productId) : undefined;
  const fromProduct = product
    ? {
        hsnSac: product.hsnSac ?? "",
        unit: product.unit,
        rateBp: product.rateBp,
        priceIncludesTax: product.priceIncludesTax,
      }
    : {};
  const resolved = { ...line, ...fromProduct };
  return taxMode === "NONE" ? { ...resolved, rateBp: 0, priceIncludesTax: false } : resolved;
}

function placeOfSupplyFor(
  draft: InvoiceDraft,
  context: Context,
): { placeOfSupply: PlaceOfSupply | null; issues: FieldIssue[] } {
  const override = draft.placeOfSupplyOverride;
  if (override !== null && !isActiveStateCode(override)) {
    return {
      placeOfSupply: null,
      issues: [{ path: "placeOfSupplyOverride", message: "placeOfSupplyInvalid" }],
    };
  }
  try {
    return {
      placeOfSupply: determinePlaceOfSupply({
        businessStateCode: context.business.stateCode,
        scheme: context.business.gstScheme,
        customerShippingStateCode: context.customer?.shippingStateCode,
        customerBillingStateCode: context.customer?.billingStateCode,
        overrideStateCode: override,
      }),
      issues: [],
    };
  } catch (error) {
    // Composition business billing another state (CGST Act s.10(2)(c)).
    if (error instanceof ValidationError) return { placeOfSupply: null, issues: [...error.issues] };
    throw error;
  }
}

function dueDateFor(
  draft: InvoiceDraft,
  context: Context,
): { dueDate: string | null; issues: FieldIssue[] } {
  const chosen =
    draft.dueDate ??
    (context.customer ? addDays(context.invoiceDate, context.customer.creditDays) : null);
  if (chosen !== null && chosen < context.invoiceDate) {
    return { dueDate: null, issues: [{ path: "dueDate", message: "dueDateBeforeInvoiceDate" }] };
  }
  return { dueDate: chosen, issues: [] };
}

/** Recomputes everything about a draft from its lines (CLAUDE.md rule 2). */
function evaluate(draft: InvoiceDraft, context: Context): Evaluation {
  const documentType = documentTypeFor(context.business.gstScheme);
  const pos = placeOfSupplyFor(draft, context);
  const due = dueDateFor(draft, context);
  // Without a valid place of supply the lines are still checked; taxes wait for a valid one.
  const taxMode: TaxMode = pos.placeOfSupply?.taxMode ?? "NONE";
  const schema = issueLineSchema(context.options);

  const issues: FieldIssue[] = [...pos.issues, ...due.issues];
  const lines: Evaluation["lines"] = [];
  draft.lines.forEach((draftLine, index) => {
    const path = `lines.${String(index)}`;
    const parsed = schema.safeParse(resolveLine(draftLine, context, taxMode));
    if (!parsed.success) {
      issues.push(
        ...parsed.error.issues.map((issue) => ({
          path: [path, ...issue.path.map(String)].join("."),
          message: issue.message,
        })),
      );
      return;
    }
    try {
      lines.push({ line: parsed.data, amounts: computeLine(parsed.data, taxMode) });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(...prefixIssues(path, error.issues));
    }
  });

  const { totals } = computeInvoice({
    lines: lines.map(({ line }) => line),
    taxMode,
    roundOff: context.business.roundOffEnabled,
  });
  const placeOfSupplyStateCode = pos.placeOfSupply?.stateCode ?? context.business.stateCode;

  return {
    issues,
    lines,
    placeOfSupply: pos.placeOfSupply,
    documentType,
    totals,
    columns: {
      type: documentType,
      invoiceDate: context.invoiceDate,
      dueDate: due.dueDate,
      customerId: draft.customerId,
      placeOfSupplyStateCode,
      isInterState: placeOfSupplyStateCode !== context.business.stateCode,
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
  return { invoice, lines: await findInvoiceLines(db, ctx, invoice.id) };
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

/** 128 random bits for the public link (SPEC F5), 22 base64url characters. */
function newPublicToken(): string {
  return randomBytes(16).toString("base64url");
}

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
