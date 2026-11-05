import { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  buildImportReport,
  duplicatesInFile,
  type ImportIssue,
  type ImportReport as Report,
  type ImportResult as Result,
  readImportRows,
  validateImportRows,
} from "@/lib/validation/csv-import";
import { listQuerySchema } from "@/lib/validation/list-query";
import {
  type CatalogOptions,
  type ImportPreviewRow,
  PRODUCT_CSV_COLUMNS,
  PRODUCT_CSV_REQUIRED,
  PRODUCT_FIELD_COLUMNS,
  type ProductInput,
  productRowToForm,
  productSchema,
} from "@/lib/validation/products";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { type AuditEntry, insertAuditLog, insertAuditLogs } from "@/server/db/repos/audit.repo";
import { decodeCursor, encodeCursor } from "@/server/db/repos/cursor";
import {
  archiveProduct as archiveProductRow,
  findProductById,
  findProductsBySkus,
  insertProduct,
  insertProducts,
  listProducts as listProductRows,
  type Product,
  restoreProduct as restoreProductRow,
  updateProduct as updateProductRow,
} from "@/server/db/repos/products.repo";
import { listTaxRates, listUnits } from "@/server/db/repos/reference.repo";
import { type Executor, withTransaction } from "@/server/db/transaction";
import { formatINR } from "@/server/domain/money";
import { formatRatePercent } from "@/server/domain/tax-rate";

import { requireId } from "./ids";
import { parseInput } from "./validate";

/*
 * Products (SPEC F2). Every function checks the role first; writes and their audit rows share
 * one transaction (CLAUDE.md rule 10). Products are archived, never deleted, so invoices that
 * used them keep their history; invoice lines copy what they need at issue anyway.
 */

export type { ImportPreviewRow, Product };

export const PRODUCTS_PAGE_SIZE = 50;
const SKU_UNIQUE = "products_business_id_sku_unique";

const AUDITED_FIELDS = [
  "name",
  "hsnSac",
  "unit",
  "pricePaise",
  "rateBp",
  "priceIncludesTax",
  "sku",
] as const satisfies readonly (keyof Product)[];

export interface ProductPage {
  items: Product[];
  /** Pass back as `cursor` for the next page; null on the last page and for searches. */
  nextCursor: string | null;
}

export interface ProductFormOptions {
  units: { code: string; label: string }[];
  rates: { rateBp: number; label: string }[];
}

export type ImportReport = Report<ImportPreviewRow>;
export type ImportResult = Result<ImportPreviewRow>;

/** Audit diffs are JSON, which has no bigint: money goes in as a decimal string of paise. */
function auditValue(value: Product[keyof Product]): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function auditFields(product: Product): Record<string, unknown> {
  return Object.fromEntries(AUDITED_FIELDS.map((field) => [field, auditValue(product[field])]));
}

async function loadOptions(db: Executor, currentRateBp?: number): Promise<CatalogOptions> {
  const [units, rates] = await Promise.all([listUnits(db), listTaxRates(db)]);
  const rateBps = rates.map((rate) => rate.rateBp);
  // A product made at a rate since retired (12% before GST 2.0) can still be edited as it is.
  if (currentRateBp !== undefined && !rateBps.includes(currentRateBp)) rateBps.push(currentRateBp);
  return { units: units.map((unit) => unit.uqcCode), rateBps };
}

function skuTaken(): ValidationError {
  return new ValidationError("Another product already has this SKU", [
    { path: "sku", message: "skuTaken" },
  ]);
}

async function productOrThrow(db: Executor, ctx: TenantContext, id: string): Promise<Product> {
  const product = await findProductById(db, ctx, requireId(id, "Product"));
  if (!product) throw new NotFoundError("Product");
  return product;
}

export async function listProducts(ctx: TenantContext, query: unknown): Promise<ProductPage> {
  assertCan(ctx, "records:view");
  const { q, cursor, archived } = listQuerySchema.parse(query);
  const rows = await listProductRows(getDb(), ctx, {
    search: q,
    archivedOnly: archived,
    limit: PRODUCTS_PAGE_SIZE + 1,
    after: decodeCursor(cursor),
  });
  const items = rows.slice(0, PRODUCTS_PAGE_SIZE);
  const last = items.at(-1);
  const hasMore = !q && rows.length > PRODUCTS_PAGE_SIZE && last !== undefined;
  return { items, nextCursor: hasMore ? encodeCursor(last) : null };
}

export async function getProduct(ctx: TenantContext, id: string): Promise<Product> {
  assertCan(ctx, "records:view");
  return productOrThrow(getDb(), ctx, id);
}

/** Units and active GST rates for the product form, plus `currentRateBp` if it was retired. */
export async function getProductFormOptions(
  ctx: TenantContext,
  currentRateBp?: number,
): Promise<ProductFormOptions> {
  assertCan(ctx, "catalog:write");
  const db = getDb();
  const [units, rates] = await Promise.all([
    listUnits(db),
    listTaxRates(db, { activeOnly: false }),
  ]);
  return {
    units: units.map((unit) => ({ code: unit.uqcCode, label: unit.label })),
    rates: rates
      .filter((rate) => rate.active || rate.rateBp === currentRateBp)
      .map((rate) => ({ rateBp: rate.rateBp, label: rate.label })),
  };
}

export async function createProduct(ctx: TenantContext, input: unknown): Promise<Product> {
  assertCan(ctx, "catalog:write");
  const product = parseInput(productSchema(await loadOptions(getDb())), input);
  try {
    return await withTransaction(async (tx) => {
      const row = await insertProduct(tx, ctx, product);
      await insertAuditLog(tx, ctx, {
        entity: "product",
        entityId: row.id,
        action: "product.created",
        diff: { after: auditFields(row) },
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, SKU_UNIQUE)) throw skuTaken();
    throw error;
  }
}

/** Changes apply to future invoices only: issued invoices keep their own copy of the line. */
export async function updateProduct(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<Product> {
  assertCan(ctx, "catalog:write");
  try {
    return await withTransaction(async (tx) => {
      const before = await productOrThrow(tx, ctx, id);
      const patch = parseInput(productSchema(await loadOptions(tx, before.rateBp)), input);
      const after = await updateProductRow(tx, ctx, before.id, patch);
      if (!after) throw new NotFoundError("Product");
      const changed = AUDITED_FIELDS.filter((field) => before[field] !== after[field]);
      if (changed.length > 0) {
        await insertAuditLog(tx, ctx, {
          entity: "product",
          entityId: after.id,
          action: "product.updated",
          diff: {
            before: Object.fromEntries(changed.map((f) => [f, auditValue(before[f])])),
            after: Object.fromEntries(changed.map((f) => [f, auditValue(after[f])])),
          },
        });
      }
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error, SKU_UNIQUE)) throw skuTaken();
    throw error;
  }
}

/** Hides the product from lists and the invoice builder. Archiving twice changes nothing. */
export async function archiveProduct(ctx: TenantContext, id: string): Promise<Product> {
  assertCan(ctx, "catalog:write");
  return withTransaction(async (tx) => {
    const before = await productOrThrow(tx, ctx, id);
    if (before.archivedAt) return before;
    const after = await archiveProductRow(tx, ctx, before.id);
    if (!after) throw new NotFoundError("Product");
    await insertAuditLog(tx, ctx, {
      entity: "product",
      entityId: after.id,
      action: "product.archived",
    });
    return after;
  });
}

/** Brings an archived product back, unless an active product took its SKU meanwhile. */
export async function restoreProduct(ctx: TenantContext, id: string): Promise<Product> {
  assertCan(ctx, "catalog:write");
  try {
    return await withTransaction(async (tx) => {
      const before = await productOrThrow(tx, ctx, id);
      if (!before.archivedAt) return before;
      const after = await restoreProductRow(tx, ctx, before.id);
      if (!after) throw new NotFoundError("Product");
      await insertAuditLog(tx, ctx, {
        entity: "product",
        entityId: after.id,
        action: "product.restored",
      });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error, SKU_UNIQUE)) {
      throw new ConflictError("Another active product has this SKU");
    }
    throw error;
  }
}

// --- CSV import (ADR 0005) ---------------------------------------------------------------

const csvText = z.string({ error: "csvEmpty" });

interface CheckedImport {
  report: ImportReport;
  products: { line: number; value: ProductInput }[];
}

function report(
  total: number,
  valid: { line: number; value: ProductInput }[],
  issues: ImportIssue[],
): ImportReport {
  return buildImportReport(total, valid, issues, [], ({ line, value }) => ({
    line,
    name: value.name,
    unit: value.unit,
    price: formatINR(value.pricePaise),
    rate: formatRatePercent(value.rateBp),
    sku: value.sku,
  }));
}

/** Reads and checks the whole file against this business's products. Writes nothing. */
async function checkImport(db: Executor, ctx: TenantContext, text: string): Promise<CheckedImport> {
  const read = readImportRows(text, PRODUCT_CSV_COLUMNS, PRODUCT_CSV_REQUIRED);
  if (!read.ok) return { report: report(0, [], read.issues), products: [] };

  const { valid, issues } = validateImportRows(
    read.rows,
    productRowToForm,
    productSchema(await loadOptions(db)),
    PRODUCT_FIELD_COLUMNS,
  );
  issues.push(...duplicatesInFile(valid, (product) => product.sku, "sku"));
  const skus = valid.flatMap(({ value }) => (value.sku ? [value.sku] : []));
  const taken = new Set((await findProductsBySkus(db, ctx, skus)).map((row) => row.sku));
  for (const { line, value } of valid) {
    if (value.sku && taken.has(value.sku)) issues.push({ line, column: "sku", key: "skuTaken" });
  }
  return { report: report(read.rows.length, valid, issues), products: valid };
}

/** Step 1: what would be imported, and every problem with its line. Nothing is saved. */
export async function previewProductImport(
  ctx: TenantContext,
  input: unknown,
): Promise<ImportReport> {
  assertCan(ctx, "catalog:write");
  const text = parseInput(csvText, input);
  return (await checkImport(getDb(), ctx, text)).report;
}

/**
 * Step 2: checks the file again (the preview is never trusted) and imports every row in one
 * transaction, or none: any problem returns the report and saves nothing.
 */
export async function importProducts(ctx: TenantContext, input: unknown): Promise<ImportResult> {
  assertCan(ctx, "catalog:write");
  const text = parseInput(csvText, input);
  try {
    return await withTransaction(async (tx) => {
      const checked = await checkImport(tx, ctx, text);
      if (checked.report.issueCount > 0 || checked.products.length === 0) {
        return { status: "invalid", report: checked.report };
      }
      const rows = await insertProducts(
        tx,
        ctx,
        checked.products.map(({ value }) => value),
      );
      await insertAuditLogs(
        tx,
        ctx,
        rows.map((row): AuditEntry => ({
          entity: "product",
          entityId: row.id,
          action: "product.created",
          diff: { after: auditFields(row), source: "csv" },
        })),
      );
      return { status: "imported", count: rows.length };
    });
  } catch (error) {
    // Someone saved a product with one of these SKUs after the check: nothing was imported.
    if (isUniqueViolation(error, SKU_UNIQUE)) {
      throw new ConflictError("A product with one of these SKUs was just added");
    }
    throw error;
  }
}
