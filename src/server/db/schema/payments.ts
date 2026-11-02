import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { customers } from "./catalog";
import { audited, id, paise } from "./common";
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
    check(
      "payments_mode",
      sql`${t.mode} in ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER')`,
    ),
    index("payments_business_id_created_at_idx").on(t.businessId, t.createdAt),
    index("payments_business_id_payment_date_idx").on(t.businessId, t.paymentDate),
    index("payments_business_id_customer_id_idx").on(t.businessId, t.customerId),
  ],
);

/** The part of a payment applied to one invoice; the unallocated rest is "on account". */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    paymentId: uuid().notNull(),
    invoiceId: uuid().notNull(),
    amountPaise: paise().notNull(),
    ...audited(),
  },
  (t) => [
    unique("payment_allocations_payment_invoice_unique").on(t.businessId, t.paymentId, t.invoiceId),
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
    check("payment_allocations_amount_positive", sql`${t.amountPaise} > 0`),
    index("payment_allocations_business_id_invoice_id_idx").on(t.businessId, t.invoiceId),
  ],
);
