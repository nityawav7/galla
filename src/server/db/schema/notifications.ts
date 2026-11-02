import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { audited, id } from "./common";
import { invoices } from "./invoices";

export const REMINDER_KINDS = ["DUE", "D1", "D7", "D14"] as const;
export const REMINDER_CHANNELS = ["EMAIL", "WHATSAPP"] as const;

/** One row per reminder sent; the unique key makes the daily job idempotent (SPEC F9). */
export const remindersSent = pgTable(
  "reminders_sent",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    invoiceId: uuid().notNull(),
    kind: text({ enum: REMINDER_KINDS }).notNull(),
    channel: text({ enum: REMINDER_CHANNELS }).notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...audited(),
  },
  (t) => [
    unique("reminders_sent_invoice_kind_channel_unique").on(
      t.businessId,
      t.invoiceId,
      t.kind,
      t.channel,
    ),
    foreignKey({
      name: "reminders_sent_invoice_fk",
      columns: [t.businessId, t.invoiceId],
      foreignColumns: [invoices.businessId, invoices.id],
    }).onDelete("restrict"),
    check("reminders_sent_kind", sql`${t.kind} in ('DUE', 'D1', 'D7', 'D14')`),
    check("reminders_sent_channel", sql`${t.channel} in ('EMAIL', 'WHATSAPP')`),
  ],
);
