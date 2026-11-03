import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text } from "drizzle-orm/pg-core";

/** GST state codes (SPEC §4.2), seeded from `src/server/domain/states.ts`. */
export const states = pgTable(
  "states",
  {
    code: text().primaryKey(),
    name: text().notNull(),
    isUtWithoutLegislature: boolean().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [check("states_code_format", sql`${t.code} ~ '^[0-9]{2}$'`)],
);

/** GST rates in basis points (SPEC §4.3). Old slabs stay as inactive rows. */
export const taxRates = pgTable(
  "tax_rates",
  {
    rateBp: integer().primaryKey(),
    label: text().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [check("tax_rates_rate_bp_range", sql`${t.rateBp} >= 0 and ${t.rateBp} < 10000`)],
);

/** Unit Quantity Codes (UQC) used on invoices and in GSTR-1. */
export const units = pgTable(
  "units",
  {
    uqcCode: text().primaryKey(),
    label: text().notNull(),
  },
  (t) => [check("units_uqc_code_format", sql`${t.uqcCode} ~ '^[A-Z]{3}$'`)],
);
