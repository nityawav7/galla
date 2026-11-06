import { sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";
import { type NumberSeries } from "@/server/domain/numbering";

import { newId } from "../ids";
import { numberSequences } from "../schema";
import { type Transaction } from "../transaction";

/**
 * Takes the next number of a series for a financial year (SPEC §4.6, ADR 0006), in one statement:
 * the upsert creates the counter for a new FY without a race, and the row it touches stays
 * locked until the transaction ends. Concurrent issues in the same business and series wait
 * here, one at a time. A rollback undoes the increment, so a failed issue leaves no gap.
 *
 * Takes a Transaction (not any Executor) on purpose: outside one, the lock would end at once
 * and a later failure could not give the number back. Call it as late in the transaction as
 * possible to keep the lock short.
 */
export async function takeNextNumber(
  tx: Transaction,
  ctx: TenantContext,
  series: NumberSeries,
  fy: string,
): Promise<number> {
  const result = await tx.execute<{ value: number }>(sql`
    insert into ${numberSequences} (id, business_id, series, fy, next_value, created_by)
    values (${newId()}, ${ctx.businessId}, ${series}, ${fy}, 2, ${ctx.userId})
    on conflict (business_id, series, fy)
    do update set next_value = ${numberSequences}.next_value + 1, updated_at = now()
    returning next_value - 1 as value
  `);
  const value = result.rows[0]?.value;
  if (typeof value !== "number") throw new Error("number sequence returned no value");
  return value;
}
