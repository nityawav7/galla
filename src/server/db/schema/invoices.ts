import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { customers, products } from "./catalog";
import { audited, id, paise } from "./common";
// Relative import: drizzle-kit loads schema files without the "@/" path alias. Type only.
import {
  type CustomerSnapshot,
  documentChecks,
  documentTotals,
  lineChecks,
  lineSnapshot,
  type SupplierSnapshot,
} from "./document-columns";
import { states } from "./reference";
import { type InvoiceDraft } from "../../../lib/validation/invoices";

export const DOCUMENT_SERIES = ["INV", "CN"] as const;
export const INVOICE_TYPES = ["TAX_INVOICE", "BILL_OF_SUPPLY", "INVOICE"] as const;
/** OVERDUE is derived (due date passed and balance > 0), never stored (SPEC §4.8). */
export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;

/** One gapless counter per business, series and financial year, locked when issuing (SPEC §4.6). */
export const numberSequences = pgTable(
  "number_sequences",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    series: text({ enum: DOCUMENT_SERIES }).notNull(),
    fy: text().notNull(),
    nextValue: integer().notNull().default(1),
    ...audited(),
  },
  (t) => [
    unique("number_sequences_business_id_series_fy_unique").on(t.businessId, t.series, t.fy),
    check("number_sequences_series", sql`${t.series} in ('INV', 'CN')`),
    check("number_sequences_fy_format", sql`${t.fy} ~ '^[0-9]{2}-[0-9]{2}$'`),
    check("number_sequences_next_value_positive", sql`${t.nextValue} >= 1`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    type: text({ enum: INVOICE_TYPES }).notNull(),
    status: text({ enum: INVOICE_STATUSES }).notNull().default("DRAFT"),
    /** Assigned only at issue, inside the transaction that locks the number sequence. */
    number: text(),
    fy: text(),
    invoiceDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }),
    /** Null for a walk-in customer. */
    customerId: uuid(),
    customerSnapshot: jsonb().$type<CustomerSnapshot>(),
    /** The business as printed, copied at issue (Rule 46 supplier fields). */
    supplierSnapshot: jsonb().$type<SupplierSnapshot>(),
    /** The builder's working copy; only drafts have one. Lines are written at issue (ADR 0006). */
    draft: jsonb().$type<InvoiceDraft>(),
    placeOfSupplyStateCode: text()
      .notNull()
      .references(() => states.code, { onDelete: "restrict" }),
    isInterState: boolean().notNull(),
    reverseCharge: boolean().notNull().default(false),
    ...documentTotals(),
    amountPaidPaise: paise()
      .notNull()
      .default(sql`0`),
    /** Σ credit notes against this invoice, kept under the invoice row lock. */
    amountCreditedPaise: paise()
      .notNull()
      .default(sql`0`),
    notes: text(),
    publicToken: text().unique(),
    tokenRevokedAt: timestamp({ withTimezone: true }),
    issuedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    /** Optimistic locking for draft edits. */
    version: integer().notNull().default(1),
    ...audited(),
  },
  (t) => [
    unique("invoices_business_id_id_unique").on(t.businessId, t.id),
    unique("invoices_business_id_number_unique").on(t.businessId, t.number),
    foreignKey({
      name: "invoices_customer_fk",
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }).onDelete("restrict"),
    check("invoices_type", sql`${t.type} in ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE')`),
    check(
      "invoices_status",
      sql`${t.status} in ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')`,
    ),
    // Only a tax invoice carries GST; a bill of supply or an unregistered invoice never does.
    check(
      "invoices_tax_only_on_tax_invoice",
      sql`${t.type} = 'TAX_INVOICE' or (${t.cgstPaise} = 0 and ${t.sgstPaise} = 0 and ${t.utgstPaise} = 0 and ${t.igstPaise} = 0)`,
    ),
    ...documentChecks("invoices", t),
    // balance = grand total − paid − credited never goes below zero (SPEC §4.8).
    check(
      "invoices_settled_range",
      sql`${t.amountPaidPaise} >= 0 and ${t.amountCreditedPaise} >= 0 and ${t.amountPaidPaise} + ${t.amountCreditedPaise} <= ${t.grandTotalPaise}`,
    ),
    // Drafts have no number; everything issued has a number, FY and issue time.
    check("invoices_number_iff_issued", sql`(${t.status} = 'DRAFT') = (${t.number} is null)`),
    check("invoices_fy_with_number", sql`(${t.number} is null) = (${t.fy} is null)`),
    check("invoices_issued_at_iff_issued", sql`(${t.status} = 'DRAFT') = (${t.issuedAt} is null)`),
    check(
      "invoices_snapshot_when_issued",
      sql`${t.status} = 'DRAFT' or ${t.customerSnapshot} is not null`,
    ),
    check(
      "invoices_supplier_snapshot_when_issued",
      sql`${t.status} = 'DRAFT' or ${t.supplierSnapshot} is not null`,
    ),
    check("invoices_draft_iff_draft", sql`(${t.status} = 'DRAFT') = (${t.draft} is not null)`),
    check("invoices_number_format", sql`${t.number} ~ '^[A-Za-z0-9/-]{1,16}$'`),
    check("invoices_fy_format", sql`${t.fy} ~ '^[0-9]{2}-[0-9]{2}$'`),
    check(
      "invoices_cancelled_at_iff_cancelled",
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null)`,
    ),
    check(
      "invoices_cancel_reason_when_cancelled",
      sql`${t.status} <> 'CANCELLED' or coalesce(length(trim(${t.cancelReason})), 0) > 0`,
    ),
    check("invoices_due_date_after_invoice_date", sql`${t.dueDate} >= ${t.invoiceDate}`),
    check("invoices_public_token_format", sql`${t.publicToken} ~ '^[A-Za-z0-9_-]{22}$'`),
    check("invoices_version_positive", sql`${t.version} >= 1`),
    index("invoices_business_id_created_at_idx").on(t.businessId, t.createdAt),
    index("invoices_business_id_status_idx").on(t.businessId, t.status),
    index("invoices_business_id_invoice_date_idx").on(t.businessId, t.invoiceDate),
    // Keyset pages of the invoice list: newest date first, id breaks ties.
    index("invoices_business_id_invoice_date_id_idx").on(t.businessId, t.invoiceDate, t.id),
    // Overdue filter: only invoices that can still owe money.
    index("invoices_business_id_due_date_open_idx")
      .on(t.businessId, t.dueDate)
      .where(sql`${t.status} in ('ISSUED', 'PARTIALLY_PAID')`),
    index("invoices_business_id_customer_id_idx").on(t.businessId, t.customerId),
    index("invoices_place_of_supply_state_code_idx").on(t.placeOfSupplyStateCode),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    invoiceId: uuid().notNull(),
    /** Null for a one-off item typed on the invoice. */
    productId: uuid(),
    ...lineSnapshot(),
    ...audited(),
  },
  (t) => [
    unique("invoice_lines_invoice_position_unique").on(t.businessId, t.invoiceId, t.position),
    foreignKey({
      name: "invoice_lines_invoice_fk",
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoices.businessId, invoices.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invoice_lines_product_fk",
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }).onDelete("restrict"),
    ...lineChecks("invoice_lines", t),
    index("invoice_lines_business_id_product_id_idx").on(t.businessId, t.productId),
  ],
);
