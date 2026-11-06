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
import {
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_CSV_REQUIRED,
  CUSTOMER_FIELD_COLUMNS,
  type CustomerInput,
  type CustomerPreviewRow,
  customerRowToForm,
  customerSchema,
} from "@/lib/validation/customers";
import { listQuerySchema } from "@/lib/validation/list-query";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { type AuditEntry, insertAuditLog, insertAuditLogs } from "@/server/db/repos/audit.repo";
import { decodeCursor, encodeCursor } from "@/server/db/repos/cursor";
import {
  archiveCustomer as archiveCustomerRow,
  type Customer,
  findCustomerById,
  findCustomersByGstins,
  findCustomersByPhone,
  findCustomersByPhones,
  insertCustomer,
  insertCustomers,
  listCustomers as listCustomerRows,
  restoreCustomer as restoreCustomerRow,
  updateCustomer as updateCustomerRow,
} from "@/server/db/repos/customers.repo";
import { type Executor, withTransaction } from "@/server/db/transaction";
import { formatINR } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import { findState } from "@/server/domain/states";

import { requireId } from "./ids";
import { parseInput } from "./validate";

/*
 * Customers (SPEC F3). Same pattern as products: the role first, then the shared schema, then
 * one transaction holding the write and its audit row. A GSTIN identifies one active customer
 * per shop (the database enforces it); a phone number may repeat, so it only asks first.
 */

export type { Customer, CustomerPreviewRow };

export const CUSTOMERS_PAGE_SIZE = 50;
const GSTIN_UNIQUE = "customers_business_id_gstin_unique";

const AUDITED_FIELDS = [
  "name",
  "phoneE164",
  "email",
  "gstin",
  "billingAddressLine1",
  "billingAddressLine2",
  "billingCity",
  "billingPincode",
  "billingStateCode",
  "shippingAddressLine1",
  "shippingAddressLine2",
  "shippingCity",
  "shippingPincode",
  "shippingStateCode",
  "openingBalancePaise",
  "creditDays",
] as const satisfies readonly (keyof Customer)[];

export interface CustomerPage {
  items: Customer[];
  /** Pass back as `cursor` for the next page; null on the last page and for searches. */
  nextCursor: string | null;
}

/** Saved, or not saved because other active customers have this phone (ask, then confirm). */
export type SaveCustomerResult =
  | { status: "saved"; customer: Customer }
  | { status: "possibleDuplicate"; matches: { id: string; name: string }[] };

export type ImportReport = Report<CustomerPreviewRow>;
export type ImportResult = Result<CustomerPreviewRow>;

/** Audit diffs are JSON, which has no bigint: money goes in as a decimal string of paise. */
function auditValue(value: Customer[keyof Customer]): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function auditFields(customer: Customer): Record<string, unknown> {
  return Object.fromEntries(AUDITED_FIELDS.map((field) => [field, auditValue(customer[field])]));
}

function gstinTaken(): ValidationError {
  return new ValidationError("Another customer already has this GSTIN", [
    { path: "gstin", message: "gstinTaken" },
  ]);
}

async function customerOrThrow(db: Executor, ctx: TenantContext, id: string): Promise<Customer> {
  const customer = await findCustomerById(db, ctx, requireId(id, "Customer"));
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

/** Other active customers with this phone, unless the user already said "save anyway". */
async function phoneMatches(
  db: Executor,
  ctx: TenantContext,
  input: CustomerInput,
  exceptId?: string,
): Promise<{ id: string; name: string }[]> {
  const phone = input.customer.phoneE164;
  if (!phone || input.confirmDuplicatePhone) return [];
  const rows = await findCustomersByPhone(db, ctx, phone, exceptId);
  return rows.map(({ id, name }) => ({ id, name }));
}

/** Runs a save, mapping a GSTIN clash (also one from a race) to the gstin field. */
async function mapGstinClash<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, GSTIN_UNIQUE)) throw gstinTaken();
    throw error;
  }
}

export async function listCustomers(ctx: TenantContext, query: unknown): Promise<CustomerPage> {
  assertCan(ctx, "records:view");
  const { q, cursor, archived } = listQuerySchema.parse(query);
  const rows = await listCustomerRows(getDb(), ctx, {
    search: q,
    archivedOnly: archived,
    limit: CUSTOMERS_PAGE_SIZE + 1,
    after: decodeCursor(cursor),
  });
  const items = rows.slice(0, CUSTOMERS_PAGE_SIZE);
  const last = items.at(-1);
  const hasMore = !q && rows.length > CUSTOMERS_PAGE_SIZE && last !== undefined;
  return { items, nextCursor: hasMore ? encodeCursor(last) : null };
}

export async function getCustomer(ctx: TenantContext, id: string): Promise<Customer> {
  assertCan(ctx, "records:view");
  return customerOrThrow(getDb(), ctx, id);
}

export async function createCustomer(
  ctx: TenantContext,
  input: unknown,
): Promise<SaveCustomerResult> {
  assertCan(ctx, "catalog:write");
  const parsed = parseInput(customerSchema, input);
  return mapGstinClash(() =>
    withTransaction(async (tx): Promise<SaveCustomerResult> => {
      const matches = await phoneMatches(tx, ctx, parsed);
      if (matches.length > 0) return { status: "possibleDuplicate", matches };
      const row = await insertCustomer(tx, ctx, parsed.customer);
      await insertAuditLog(tx, ctx, {
        entity: "customer",
        entityId: row.id,
        action: "customer.created",
        diff: {
          after: auditFields(row),
          ...(parsed.stateOverride ? { stateOverride: true } : {}),
        },
      });
      return { status: "saved", customer: row };
    }),
  );
}

/** Changes apply to future invoices only: issued invoices keep their customer snapshot. */
export async function updateCustomer(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<SaveCustomerResult> {
  assertCan(ctx, "catalog:write");
  const parsed = parseInput(customerSchema, input);
  return mapGstinClash(() =>
    withTransaction(async (tx): Promise<SaveCustomerResult> => {
      const before = await customerOrThrow(tx, ctx, id);
      // Asking again only makes sense when the phone changed.
      const phoneChanged = parsed.customer.phoneE164 !== before.phoneE164;
      const matches = phoneChanged ? await phoneMatches(tx, ctx, parsed, before.id) : [];
      if (matches.length > 0) return { status: "possibleDuplicate", matches };
      const after = await updateCustomerRow(tx, ctx, before.id, parsed.customer);
      if (!after) throw new NotFoundError("Customer");
      const changed = AUDITED_FIELDS.filter((field) => before[field] !== after[field]);
      if (changed.length > 0) {
        await insertAuditLog(tx, ctx, {
          entity: "customer",
          entityId: after.id,
          action: "customer.updated",
          diff: {
            before: Object.fromEntries(changed.map((f) => [f, auditValue(before[f])])),
            after: Object.fromEntries(changed.map((f) => [f, auditValue(after[f])])),
            ...(parsed.stateOverride ? { stateOverride: true } : {}),
          },
        });
      }
      return { status: "saved", customer: after };
    }),
  );
}

/** Hides the customer from lists and the invoice builder. Their invoices and ledger stay. */
export async function archiveCustomer(ctx: TenantContext, id: string): Promise<Customer> {
  assertCan(ctx, "catalog:write");
  return withTransaction(async (tx) => {
    const before = await customerOrThrow(tx, ctx, id);
    if (before.archivedAt) return before;
    const after = await archiveCustomerRow(tx, ctx, before.id);
    if (!after) throw new NotFoundError("Customer");
    await insertAuditLog(tx, ctx, {
      entity: "customer",
      entityId: after.id,
      action: "customer.archived",
    });
    return after;
  });
}

/** Brings an archived customer back, unless an active customer took their GSTIN meanwhile. */
export async function restoreCustomer(ctx: TenantContext, id: string): Promise<Customer> {
  assertCan(ctx, "catalog:write");
  try {
    return await withTransaction(async (tx) => {
      const before = await customerOrThrow(tx, ctx, id);
      if (!before.archivedAt) return before;
      const after = await restoreCustomerRow(tx, ctx, before.id);
      if (!after) throw new NotFoundError("Customer");
      await insertAuditLog(tx, ctx, {
        entity: "customer",
        entityId: after.id,
        action: "customer.restored",
      });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error, GSTIN_UNIQUE)) {
      throw new ConflictError("Another active customer has this GSTIN");
    }
    throw error;
  }
}

// --- CSV import (ADR 0005) ---------------------------------------------------------------

const csvText = z.string({ error: "csvEmpty" });

type Columns = CustomerInput["customer"];

interface CheckedImport {
  report: ImportReport;
  customers: { line: number; value: Columns }[];
}

function report(
  total: number,
  valid: { line: number; value: Columns }[],
  issues: ImportIssue[],
  warnings: ImportIssue[],
): ImportReport {
  return buildImportReport(total, valid, issues, warnings, ({ line, value }) => ({
    line,
    name: value.name,
    phone: value.phoneE164 ? formatIndianPhone(value.phoneE164) : null,
    gstin: value.gstin,
    state: value.billingStateCode ? (findState(value.billingStateCode)?.name ?? null) : null,
    balance:
      value.openingBalancePaise === 0n
        ? null
        : formatINR(
            value.openingBalancePaise < 0n ? -value.openingBalancePaise : value.openingBalancePaise,
          ),
    advance: value.openingBalancePaise < 0n,
  }));
}

/** Reads and checks the whole file against this business's customers. Writes nothing. */
async function checkImport(db: Executor, ctx: TenantContext, text: string): Promise<CheckedImport> {
  const read = readImportRows(text, CUSTOMER_CSV_COLUMNS, CUSTOMER_CSV_REQUIRED);
  if (!read.ok) return { report: report(0, [], read.issues, []), customers: [] };

  const checked = validateImportRows(
    read.rows,
    customerRowToForm,
    customerSchema,
    CUSTOMER_FIELD_COLUMNS,
  );
  const valid = checked.valid.map(({ line, value }) => ({ line, value: value.customer }));
  const issues = [...checked.issues, ...duplicatesInFile(valid, (c) => c.gstin, "gstin")];
  const warnings = duplicatesInFile(valid, (c) => c.phoneE164, "phone").map(
    (warning): ImportIssue => ({ ...warning, key: "phoneDuplicate" }),
  );

  const gstins = valid.flatMap(({ value }) => (value.gstin ? [value.gstin] : []));
  const phones = valid.flatMap(({ value }) => (value.phoneE164 ? [value.phoneE164] : []));
  const [gstinRows, phoneRows] = await Promise.all([
    findCustomersByGstins(db, ctx, gstins),
    findCustomersByPhones(db, ctx, phones),
  ]);
  const takenGstins = new Set(gstinRows.map((row) => row.gstin));
  const knownPhones = new Set(phoneRows.map((row) => row.phoneE164));
  for (const { line, value } of valid) {
    if (value.gstin && takenGstins.has(value.gstin)) {
      issues.push({ line, column: "gstin", key: "gstinTaken" });
    }
    if (value.phoneE164 && knownPhones.has(value.phoneE164)) {
      warnings.push({ line, column: "phone", key: "phoneDuplicate" });
    }
  }
  return { report: report(read.rows.length, valid, issues, warnings), customers: valid };
}

/** Step 1: what would be imported, every problem and every warning. Nothing is saved. */
export async function previewCustomerImport(
  ctx: TenantContext,
  input: unknown,
): Promise<ImportReport> {
  assertCan(ctx, "catalog:write");
  const text = parseInput(csvText, input);
  return (await checkImport(getDb(), ctx, text)).report;
}

/**
 * Step 2: checks the file again and imports every row in one transaction, or none. Warnings
 * (a phone another customer has) do not block it; the person saw them in the preview.
 */
export async function importCustomers(ctx: TenantContext, input: unknown): Promise<ImportResult> {
  assertCan(ctx, "catalog:write");
  const text = parseInput(csvText, input);
  try {
    return await withTransaction(async (tx) => {
      const checked = await checkImport(tx, ctx, text);
      if (checked.report.issueCount > 0 || checked.customers.length === 0) {
        return { status: "invalid", report: checked.report };
      }
      const rows = await insertCustomers(
        tx,
        ctx,
        checked.customers.map(({ value }) => value),
      );
      await insertAuditLogs(
        tx,
        ctx,
        rows.map((row): AuditEntry => ({
          entity: "customer",
          entityId: row.id,
          action: "customer.created",
          diff: { after: auditFields(row), source: "csv" },
        })),
      );
      return { status: "imported", count: rows.length };
    });
  } catch (error) {
    // Someone saved a customer with one of these GSTINs after the check: nothing was imported.
    if (isUniqueViolation(error, GSTIN_UNIQUE)) {
      throw new ConflictError("A customer with one of these GSTINs was just added");
    }
    throw error;
  }
}
