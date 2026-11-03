import { sql } from "drizzle-orm";

import { GST_STATES } from "@/server/domain/states";

import { states, taxRates, units } from "../schema";
import { type Executor } from "../transaction";

/**
 * GST rates in basis points (SPEC §4.3, GST 2.0 from 22 Sep 2025). 12% and 28% stay as
 * inactive rows so older invoices still render. Verify against CBIC notifications.
 */
export const TAX_RATES = [
  { rateBp: 0, label: "0%", active: true },
  { rateBp: 25, label: "0.25%", active: true },
  { rateBp: 300, label: "3%", active: true },
  { rateBp: 500, label: "5%", active: true },
  { rateBp: 1200, label: "12% (before 22 Sep 2025)", active: false },
  { rateBp: 1800, label: "18%", active: true },
  { rateBp: 2800, label: "28% (before 22 Sep 2025)", active: false },
  { rateBp: 4000, label: "40%", active: true },
] as const;

/** Unit Quantity Codes from the GST portal's UQC list (verify before launch). */
export const UNITS = [
  { uqcCode: "BAG", label: "Bags" },
  { uqcCode: "BAL", label: "Bale" },
  { uqcCode: "BDL", label: "Bundles" },
  { uqcCode: "BKL", label: "Buckles" },
  { uqcCode: "BOU", label: "Billions of units" },
  { uqcCode: "BOX", label: "Box" },
  { uqcCode: "BTL", label: "Bottles" },
  { uqcCode: "BUN", label: "Bunches" },
  { uqcCode: "CAN", label: "Cans" },
  { uqcCode: "CBM", label: "Cubic metres" },
  { uqcCode: "CCM", label: "Cubic centimetres" },
  { uqcCode: "CMS", label: "Centimetres" },
  { uqcCode: "CTN", label: "Cartons" },
  { uqcCode: "DOZ", label: "Dozens" },
  { uqcCode: "DRM", label: "Drums" },
  { uqcCode: "GGK", label: "Great gross" },
  { uqcCode: "GMS", label: "Grams" },
  { uqcCode: "GRS", label: "Gross" },
  { uqcCode: "GYD", label: "Gross yards" },
  { uqcCode: "KGS", label: "Kilograms" },
  { uqcCode: "KLR", label: "Kilolitres" },
  { uqcCode: "KME", label: "Kilometres" },
  { uqcCode: "LTR", label: "Litres" },
  { uqcCode: "MLT", label: "Millilitres" },
  { uqcCode: "MTR", label: "Metres" },
  { uqcCode: "MTS", label: "Metric tonnes" },
  { uqcCode: "NOS", label: "Numbers" },
  { uqcCode: "OTH", label: "Others" },
  { uqcCode: "PAC", label: "Packs" },
  { uqcCode: "PCS", label: "Pieces" },
  { uqcCode: "PRS", label: "Pairs" },
  { uqcCode: "QTL", label: "Quintals" },
  { uqcCode: "ROL", label: "Rolls" },
  { uqcCode: "SET", label: "Sets" },
  { uqcCode: "SQF", label: "Square feet" },
  { uqcCode: "SQM", label: "Square metres" },
  { uqcCode: "SQY", label: "Square yards" },
  { uqcCode: "TBS", label: "Tablets" },
  { uqcCode: "TGM", label: "Ten gross" },
  { uqcCode: "THD", label: "Thousands" },
  { uqcCode: "TON", label: "Tonnes" },
  { uqcCode: "TUB", label: "Tubes" },
  { uqcCode: "UGS", label: "US gallons" },
  { uqcCode: "UNT", label: "Units" },
  { uqcCode: "YDS", label: "Yards" },
] as const;

/**
 * Upserts states, tax rates and units. Safe to run on every deploy: re-running changes
 * nothing unless the source lists changed. Rows are never deleted (old invoices refer to them).
 */
export async function seedReferenceData(db: Executor): Promise<void> {
  await db
    .insert(states)
    .values(
      GST_STATES.map(({ code, name, isUtWithoutLegislature, active }) => ({
        code,
        name,
        isUtWithoutLegislature,
        active,
      })),
    )
    .onConflictDoUpdate({
      target: states.code,
      set: {
        name: sql`excluded.name`,
        isUtWithoutLegislature: sql`excluded.is_ut_without_legislature`,
        active: sql`excluded.active`,
      },
    });

  await db
    .insert(taxRates)
    .values([...TAX_RATES])
    .onConflictDoUpdate({
      target: taxRates.rateBp,
      set: { label: sql`excluded.label`, active: sql`excluded.active` },
    });

  await db
    .insert(units)
    .values([...UNITS])
    .onConflictDoUpdate({ target: units.uqcCode, set: { label: sql`excluded.label` } });
}
