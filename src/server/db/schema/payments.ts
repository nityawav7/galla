import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { customers } from "./catalog";
import { audited, id, paise } from "./common";
import { creditNotes } from "./credit-notes";
import { invoices } from "./invoices";

export const PAYMENT_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    /** Null only for a walk-in invoice paid at the counter. */
    customerId: uuid(),
    paymentDate: date({ mode: "string" }).notNull(),
    amountPaise: paise().notNull(),
    mode: text({ enum: PAYMENT_MODES }).notNull(),
    /** UTR or cheque number. */
    reference: text(),
    notes: text(),
    /** A payment is never edited or deleted; the owner voids it (ADR 0010). */
    voidedAt: timestamp({ withTimezone: true }),
    /** Like `created_by`, no foreign key, so history outlives a deleted user. */
    voidedBy: uuid(),
    voidReason: text(),
    ...audited(),
  },
  (t) => [
    unique("payments_business_id_id_unique").on(t.businessId, t.id),
    foreignKey({
      name: "payments_customer_fk",
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }).onDelete("restrict"),
    check("payments_amount_positive", sql`${t.amountPaise} > 0`),
    // ₹10 crore, the same limit as PAYMENT_MAX_PAISE in src/lib/config.ts.
    check("payments_amount_max", sql`${t.amountPaise} <= 10000000000`),
    check(
      "payments_voided_fields",
      sql`(${t.voidedAt} is null) = (${t.voidedBy} is null) and (${t.voidedAt} is null) = (${t.voidReason} is null) and (${t.voidReason} is null or length(trim(${t.voidReason})) > 0)`,
    ),
    check(
      "payments_mode",
      sql`${t.mode} in ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER')`,
    ),
    index("payments_business_id_created_at_idx").on(t.businessId, t.createdAt),
    index("payments_business_id_payment_date_idx").on(t.businessId, t.paymentDate),
    // The customer's ledger and payments list, by date.
    index("payments_business_id_customer_id_date_idx").on(
      t.businessId,
      t.customerId,
      t.paymentDate,
      t.id,
    ),
  ],
);

/**
 * The part of a payment applied to one invoice; the unallocated rest is "on account". The opening
 * balance is an end too (ADR 0010): a null `payment_id` is money from the customer's opening
 * advance, a null `invoice_id` pays the customer's opening balance owed.
 */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    /** Null = from the customer's opening advance. */
    paymentId: uuid(),
    /** Null = towards the customer's opening balance owed. */
    invoiceId: uuid(),
    /** Null only for a walk-in invoice paid at the counter. */
    customerId: uuid(),
    amountPaise: paise().notNull(),
    ...audited(),
  },
  (t) => [
    unique("payment_allocations_payment_invoice_unique")
      .on(t.businessId, t.paymentId, t.invoiceId)
      .nullsNotDistinct(),
    foreignKey({
      name: "payment_allocations_payment_fk",
      columns: [t.businessId, t.paymentId],
      foreignColumns: [payments.businessId, payments.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_allocations_invoice_fk",
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoices.businessId, invoices.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_allocations_customer_fk",
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }).onDelete("restrict"),
    check("payment_allocations_amount_positive", sql`${t.amountPaise} > 0`),
    // The opening balance is one signed number: it can't pay itself.
    check(
      "payment_allocations_has_an_end",
      sql`${t.paymentId} is not null or ${t.invoiceId} is not null`,
    ),
    // Opening-balance rows need the customer; only a walk-in payment has none.
    check(
      "payment_allocations_customer_unless_walk_in",
      sql`${t.customerId} is not null or (${t.paymentId} is not null and ${t.invoiceId} is not null)`,
    ),
    index("payment_allocations_business_id_invoice_id_idx").on(t.businessId, t.invoiceId),
    index("payment_allocations_business_id_customer_id_idx").on(t.businessId, t.customerId),
  ],
);

/**
 * Money paid back (ADR 0011): money on account returned to a customer, or, for a walk-in sale, what
 * a credit note released from its payment, given back at the counter. Never edited or deleted;
 * the owner voids one, like a payment.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    /** Null only for a walk-in refund, which then has its credit note. */
    customerId: uuid(),
    /** The credit note whose released money this pays back (walk-in sales). */
    creditNoteId: uuid(),
    refundDate: date({ mode: "string" }).notNull(),
    amountPaise: paise().notNull(),
    mode: text({ enum: PAYMENT_MODES }).notNull(),
    reference: text(),
    notes: text(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: uuid(),
    voidReason: text(),
    ...audited(),
  },
  (t) => [
    unique("refunds_business_id_id_unique").on(t.businessId, t.id),
    foreignKey({
      name: "refunds_customer_fk",
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "refunds_credit_note_fk",
      columns: [t.businessId, t.creditNoteId],
      foreignColumns: [creditNotes.businessId, creditNotes.id],
    }).onDelete("restrict"),
    check("refunds_amount_positive", sql`${t.amountPaise} > 0`),
    check("refunds_amount_max", sql`${t.amountPaise} <= 10000000000`),
    check(
      "refunds_has_an_owner",
      sql`${t.customerId} is not null or ${t.creditNoteId} is not null`,
    ),
    check(
      "refunds_voided_fields",
      sql`(${t.voidedAt} is null) = (${t.voidedBy} is null) and (${t.voidedAt} is null) = (${t.voidReason} is null) and (${t.voidReason} is null or length(trim(${t.voidReason})) > 0)`,
    ),
    check(
      "refunds_mode",
      sql`${t.mode} in ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER')`,
    ),
    index("refunds_business_id_customer_id_date_idx").on(
      t.businessId,
      t.customerId,
      t.refundDate,
      t.id,
    ),
    index("refunds_business_id_credit_note_id_idx").on(t.businessId, t.creditNoteId),
  ],
);
