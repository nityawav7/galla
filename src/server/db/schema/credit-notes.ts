import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { customers, products } from "./catalog";
import { audited, id } from "./common";
import {
  type CustomerSnapshot,
  documentChecks,
  documentTotals,
  lineChecks,
  lineSnapshot,
} from "./document-columns";
import { invoices } from "./invoices";
import { states } from "./reference";

/**
 * Credit notes are issued directly (no drafts), so the number, FY and snapshot are always set.
 * They use their own `CN` series (SPEC §4.6).
 */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    invoiceId: uuid().notNull(),
    customerId: uuid(),
    number: text().notNull(),
    fy: text().notNull(),
    noteDate: date({ mode: "string" }).notNull(),
    reason: text().notNull(),
    customerSnapshot: jsonb().$type<CustomerSnapshot>().notNull(),
    placeOfSupplyStateCode: text()
      .notNull()
      .references(() => states.code, { onDelete: "restrict" }),
    isInterState: boolean().notNull(),
    ...documentTotals(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...audited(),
  },
  (t) => [
    unique("credit_notes_business_id_id_unique").on(t.businessId, t.id),
    unique("credit_notes_business_id_number_unique").on(t.businessId, t.number),
    foreignKey({
      name: "credit_notes_invoice_fk",
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoices.businessId, invoices.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_notes_customer_fk",
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }).onDelete("restrict"),
    ...documentChecks("credit_notes", t),
    check("credit_notes_number_format", sql`${t.number} ~ '^[A-Za-z0-9/-]{1,16}$'`),
    check("credit_notes_fy_format", sql`${t.fy} ~ '^[0-9]{2}-[0-9]{2}$'`),
    check("credit_notes_reason_not_blank", sql`length(trim(${t.reason})) > 0`),
    index("credit_notes_business_id_created_at_idx").on(t.businessId, t.createdAt),
    index("credit_notes_business_id_note_date_idx").on(t.businessId, t.noteDate),
    index("credit_notes_business_id_invoice_id_idx").on(t.businessId, t.invoiceId),
    index("credit_notes_business_id_customer_id_idx").on(t.businessId, t.customerId),
    index("credit_notes_place_of_supply_state_code_idx").on(t.placeOfSupplyStateCode),
  ],
);

export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    creditNoteId: uuid().notNull(),
    productId: uuid(),
    ...lineSnapshot(),
    ...audited(),
  },
  (t) => [
    unique("credit_note_lines_credit_note_position_unique").on(
      t.businessId,
      t.creditNoteId,
      t.position,
    ),
    foreignKey({
      name: "credit_note_lines_credit_note_fk",
      columns: [t.businessId, t.creditNoteId],
      foreignColumns: [creditNotes.businessId, creditNotes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "credit_note_lines_product_fk",
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }).onDelete("restrict"),
    ...lineChecks("credit_note_lines", t),
    index("credit_note_lines_business_id_product_id_idx").on(t.businessId, t.productId),
  ],
);
