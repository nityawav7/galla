import { and, eq, type SQL, sql } from "drizzle-orm";
import { type PgColumn } from "drizzle-orm/pg-core";

import { type TenantContext } from "@/server/authz/context";

/**
 * `business_id = ctx.businessId AND …conditions`. Every tenant query's WHERE goes through
 * this, so forgetting the tenant filter is a visible omission in review (ADR 0003).
 */
export function tenantScope(
  ctx: TenantContext,
  table: { businessId: PgColumn },
  ...conditions: (SQL | undefined)[]
): SQL {
  // `and()` only returns undefined with no conditions; fail closed if that ever changes.
  return and(eq(table.businessId, ctx.businessId), ...conditions) ?? sql`false`;
}

/** Columns a caller may never set: the tenant and the actor always come from the context. */
export type TenantOwned = "id" | "businessId" | "createdAt" | "updatedAt" | "createdBy";

/**
 * Minimum pg_trgm `word_similarity` for a fuzzy name match. pg_trgm's own default (0.6) misses
 * one-letter typos in short words ("basmti" → "Basmati" scores 0.57). A substring ILIKE match,
 * which the trigram GIN index serves, always counts too.
 */
export const FUZZY_MATCH_THRESHOLD = 0.5;

/** Escapes `%`, `_` and `\` so user text matches literally inside ILIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
