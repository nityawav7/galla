import { asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { customers } from "../schema";
import { type Executor } from "../transaction";
import { escapeLike, FUZZY_MATCH_THRESHOLD, type TenantOwned, tenantScope } from "./tenant";

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = Omit<typeof customers.$inferInsert, TenantOwned | "archivedAt">;
export type CustomerPatch = Partial<NewCustomer>;

export interface ListCustomersOptions {
  /** Fuzzy match on the name (pg_trgm), best match first. */
  search?: string;
  includeArchived?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export async function insertCustomer(
  db: Executor,
  ctx: TenantContext,
  input: NewCustomer,
): Promise<Customer> {
  const [row] = await db
    .insert(customers)
    .values({ ...input, businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function findCustomerById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Customer | undefined> {
  const [row] = await db
    .select()
    .from(customers)
    .where(tenantScope(ctx, customers, eq(customers.id, id)));
  return row;
}

/** Active customers with this phone, for the "possible duplicate" warning (phones may repeat). */
export async function findCustomersByPhone(
  db: Executor,
  ctx: TenantContext,
  phoneE164: string,
): Promise<Customer[]> {
  return db
    .select()
    .from(customers)
    .where(
      tenantScope(ctx, customers, eq(customers.phoneE164, phoneE164), isNull(customers.archivedAt)),
    )
    .orderBy(asc(customers.name), asc(customers.id));
}

export async function updateCustomer(
  db: Executor,
  ctx: TenantContext,
  id: string,
  patch: CustomerPatch,
): Promise<Customer | undefined> {
  const [row] = await db
    .update(customers)
    // Re-asserting the tenant keeps a stray `businessId` in the patch from moving the row.
    .set({ ...patch, businessId: ctx.businessId })
    .where(tenantScope(ctx, customers, eq(customers.id, id)))
    .returning();
  return row;
}

export async function archiveCustomer(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Customer | undefined> {
  const [row] = await db
    .update(customers)
    .set({ archivedAt: new Date() })
    .where(tenantScope(ctx, customers, eq(customers.id, id), isNull(customers.archivedAt)))
    .returning();
  return row;
}

export async function listCustomers(
  db: Executor,
  ctx: TenantContext,
  { search, includeArchived = false, limit = DEFAULT_LIMIT }: ListCustomersOptions = {},
): Promise<Customer[]> {
  const term = search?.trim();
  const matches = term
    ? or(
        sql`${customers.name} ilike ${`%${escapeLike(term)}%`}`,
        sql`word_similarity(${term}, ${customers.name}) >= ${FUZZY_MATCH_THRESHOLD}`,
      )
    : undefined;
  return db
    .select()
    .from(customers)
    .where(
      tenantScope(
        ctx,
        customers,
        includeArchived ? undefined : isNull(customers.archivedAt),
        matches,
      ),
    )
    .orderBy(
      ...(term ? [desc(sql`word_similarity(${term}, ${customers.name})`)] : []),
      asc(customers.name),
      asc(customers.id),
    )
    .limit(limit);
}
