import { asc, eq } from "drizzle-orm";

import { states, taxRates, units } from "../schema";
import { type Executor } from "../transaction";

// Reference data is shared by every business, so these reads take no TenantContext.

export type StateRow = typeof states.$inferSelect;
export type TaxRateRow = typeof taxRates.$inferSelect;
export type UnitRow = typeof units.$inferSelect;

export function listStates(db: Executor, { activeOnly = true } = {}): Promise<StateRow[]> {
  return db
    .select()
    .from(states)
    .where(activeOnly ? eq(states.active, true) : undefined)
    .orderBy(asc(states.code));
}

export function listTaxRates(db: Executor, { activeOnly = true } = {}): Promise<TaxRateRow[]> {
  return db
    .select()
    .from(taxRates)
    .where(activeOnly ? eq(taxRates.active, true) : undefined)
    .orderBy(asc(taxRates.rateBp));
}

export function listUnits(db: Executor): Promise<UnitRow[]> {
  return db.select().from(units).orderBy(asc(units.uqcCode));
}
