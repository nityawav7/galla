import { sql } from "drizzle-orm";
import { boolean, check, integer, type PgColumn, text } from "drizzle-orm/pg-core";

import { milli, paise } from "./common";

// Columns and CHECKs shared by invoices and credit notes (same shape, SPEC §7.4).

export interface AddressSnapshot {
  line1: string | null;
  line2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
}

/** The customer as printed on an issued document; later edits to the customer never change it. */
export interface CustomerSnapshot {
  name: string;
  gstin: string | null;
  phoneE164: string | null;
  email: string | null;
  billing: AddressSnapshot | null;
  shipping: AddressSnapshot | null;
}

export const documentTotals = () => ({
  discountPaise: paise()
    .notNull()
    .default(sql`0`),
  taxablePaise: paise()
    .notNull()
    .default(sql`0`),
  cgstPaise: paise()
    .notNull()
    .default(sql`0`),
  sgstPaise: paise()
    .notNull()
    .default(sql`0`),
  utgstPaise: paise()
    .notNull()
    .default(sql`0`),
  igstPaise: paise()
    .notNull()
    .default(sql`0`),
  roundOffPaise: paise()
    .notNull()
    .default(sql`0`),
  grandTotalPaise: paise()
    .notNull()
    .default(sql`0`),
});

/** A line is a snapshot: description, HSN, unit and rate are copied, not referenced. */
export const lineSnapshot = () => ({
  position: integer().notNull(),
  description: text().notNull(),
  hsnSac: text(),
  unit: text().notNull(),
  qtyMilli: milli().notNull(),
  unitPricePaise: paise().notNull(),
  priceIncludesTax: boolean().notNull(),
  discountPaise: paise()
    .notNull()
    .default(sql`0`),
  rateBp: integer().notNull(),
  taxablePaise: paise().notNull(),
  cgstPaise: paise().notNull(),
  sgstPaise: paise().notNull(),
  utgstPaise: paise().notNull(),
  igstPaise: paise().notNull(),
  lineTotalPaise: paise().notNull(),
});

interface TaxColumns {
  taxablePaise: PgColumn;
  cgstPaise: PgColumn;
  sgstPaise: PgColumn;
  utgstPaise: PgColumn;
  igstPaise: PgColumn;
}

/**
 * Intra-state: no IGST, CGST equals SGST or UTGST (never both). Inter-state: IGST only.
 * A zero-tax line satisfies both branches.
 */
function taxSplitCheck(table: string, t: TaxColumns) {
  return check(
    `${table}_tax_split`,
    sql`(${t.igstPaise} = 0 and ${t.cgstPaise} = ${t.sgstPaise} + ${t.utgstPaise} and (${t.sgstPaise} = 0 or ${t.utgstPaise} = 0))
      or (${t.cgstPaise} = 0 and ${t.sgstPaise} = 0 and ${t.utgstPaise} = 0)`,
  );
}

function taxesNonNegative(table: string, t: TaxColumns) {
  return check(
    `${table}_amounts_non_negative`,
    sql`${t.taxablePaise} >= 0 and ${t.cgstPaise} >= 0 and ${t.sgstPaise} >= 0 and ${t.utgstPaise} >= 0 and ${t.igstPaise} >= 0`,
  );
}

type TotalsColumns = TaxColumns & {
  discountPaise: PgColumn;
  roundOffPaise: PgColumn;
  grandTotalPaise: PgColumn;
  isInterState: PgColumn;
};

export function documentChecks(table: string, t: TotalsColumns) {
  return [
    taxSplitCheck(table, t),
    taxesNonNegative(table, t),
    check(`${table}_discount_non_negative`, sql`${t.discountPaise} >= 0`),
    check(
      `${table}_place_of_supply_tax`,
      sql`(${t.isInterState} and ${t.cgstPaise} = 0 and ${t.sgstPaise} = 0 and ${t.utgstPaise} = 0)
        or (not ${t.isInterState} and ${t.igstPaise} = 0)`,
    ),
    // SPEC §4.5: round-off to the nearest rupee, 50 paise rounds up.
    check(`${table}_round_off_range`, sql`${t.roundOffPaise} between -49 and 50`),
    check(
      `${table}_grand_total`,
      sql`${t.grandTotalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.utgstPaise} + ${t.igstPaise} + ${t.roundOffPaise}`,
    ),
  ];
}

type LineColumns = TaxColumns & {
  position: PgColumn;
  description: PgColumn;
  hsnSac: PgColumn;
  unit: PgColumn;
  qtyMilli: PgColumn;
  unitPricePaise: PgColumn;
  discountPaise: PgColumn;
  rateBp: PgColumn;
  lineTotalPaise: PgColumn;
};

export function lineChecks(table: string, t: LineColumns) {
  return [
    taxSplitCheck(table, t),
    taxesNonNegative(table, t),
    check(`${table}_position_positive`, sql`${t.position} >= 1`),
    check(`${table}_description_not_blank`, sql`length(trim(${t.description})) > 0`),
    check(`${table}_hsn_sac_format`, sql`${t.hsnSac} ~ '^[0-9]{4,8}$'`),
    check(`${table}_unit_format`, sql`${t.unit} ~ '^[A-Z]{3}$'`),
    check(`${table}_qty_positive`, sql`${t.qtyMilli} > 0`),
    check(`${table}_unit_price_non_negative`, sql`${t.unitPricePaise} >= 0`),
    check(`${table}_discount_non_negative`, sql`${t.discountPaise} >= 0`),
    check(`${table}_rate_bp_range`, sql`${t.rateBp} >= 0 and ${t.rateBp} < 10000`),
    check(
      `${table}_line_total`,
      sql`${t.lineTotalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.utgstPaise} + ${t.igstPaise}`,
    ),
  ];
}
