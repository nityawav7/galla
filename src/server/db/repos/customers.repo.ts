import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { customers } from "../schema";
import { type Executor, type Transaction } from "../transaction";
import { type NameCursor } from "./cursor";
import { escapeLike, FUZZY_MATCH_THRESHOLD, type TenantOwned, tenantScope } from "./tenant";

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = Omit<typeof customers.$inferInsert, TenantOwned | "archivedAt">;
export type CustomerPatch = Partial<NewCustomer>;

export interface ListCustomersOptions {
  /** Fuzzy match on the name (pg_trgm), digits of the phone, or a GSTIN prefix. */
  search?: string;
  includeArchived?: boolean;
  /** Only archived customers (the "Archived" view). */
  archivedOnly?: boolean;
  limit?: number;
  /** Keyset pagination (A–Z): rows after this one. Ignored when searching. */
  after?: NameCursor;
}

/** Searching by phone needs at least this many digits, so "2" doesn't match everyone. */
const MIN_PHONE_DIGITS = 4;

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

/** Several customers in one statement (CSV import). Pass the import's transaction. */
export async function insertCustomers(
  db: Executor,
  ctx: TenantContext,
  inputs: readonly NewCustomer[],
): Promise<Customer[]> {
  if (inputs.length === 0) return [];
  return db
    .insert(customers)
    .values(
      inputs.map((input) => ({ ...input, businessId: ctx.businessId, createdBy: ctx.userId })),
    )
    .returning();
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

/**
 * Reads the customer and locks the row until the transaction ends. Every change to a customer's
 * money (payments, voids, credit notes, "Apply advance", the opening balance) takes this lock
 * first, so they run one after the other (ADR 0010).
 */
export async function lockCustomer(
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Customer | undefined> {
  const [row] = await tx
    .select()
    .from(customers)
    .where(tenantScope(ctx, customers, eq(customers.id, id)))
    .for("update");
  return row;
}

/**
 * Active customers with this phone, for the "possible duplicate" warning (phones may repeat).
 * `exceptId` leaves out the customer being edited.
 */
export async function findCustomersByPhone(
  db: Executor,
  ctx: TenantContext,
  phoneE164: string,
  exceptId?: string,
): Promise<Customer[]> {
  return db
    .select()
    .from(customers)
    .where(
      tenantScope(
        ctx,
        customers,
        eq(customers.phoneE164, phoneE164),
        isNull(customers.archivedAt),
        exceptId === undefined ? undefined : ne(customers.id, exceptId),
      ),
    )
    .orderBy(asc(customers.name), asc(customers.id));
}

/** Active customers holding any of these phones (import warnings). */
export async function findCustomersByPhones(
  db: Executor,
  ctx: TenantContext,
  phones: readonly string[],
): Promise<Pick<Customer, "id" | "phoneE164">[]> {
  if (phones.length === 0) return [];
  return db
    .select({ id: customers.id, phoneE164: customers.phoneE164 })
    .from(customers)
    .where(
      tenantScope(
        ctx,
        customers,
        inArray(customers.phoneE164, [...phones]),
        isNull(customers.archivedAt),
      ),
    );
}

/** Active customers holding any of these GSTINs (import duplicate check). */
export async function findCustomersByGstins(
  db: Executor,
  ctx: TenantContext,
  gstins: readonly string[],
): Promise<Pick<Customer, "id" | "gstin">[]> {
  if (gstins.length === 0) return [];
  return db
    .select({ id: customers.id, gstin: customers.gstin })
    .from(customers)
    .where(
      tenantScope(
        ctx,
        customers,
        inArray(customers.gstin, [...gstins]),
        isNull(customers.archivedAt),
      ),
    );
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

export async function restoreCustomer(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Customer | undefined> {
  const [row] = await db
    .update(customers)
    .set({ archivedAt: null })
    .where(tenantScope(ctx, customers, eq(customers.id, id), isNotNull(customers.archivedAt)))
    .returning();
  return row;
}

export async function listCustomers(
  db: Executor,
  ctx: TenantContext,
  {
    search,
    includeArchived = false,
    archivedOnly = false,
    limit = DEFAULT_LIMIT,
    after,
  }: ListCustomersOptions = {},
): Promise<Customer[]> {
  const term = search?.trim();
  const digits = term?.replace(/\D/g, "") ?? "";
  const matches = term
    ? or(
        sql`${customers.name} ilike ${`%${escapeLike(term)}%`}`,
        sql`word_similarity(${term}, ${customers.name}) >= ${FUZZY_MATCH_THRESHOLD}`,
        sql`${customers.gstin} like ${`${escapeLike(term.toUpperCase())}%`}`,
        digits.length >= MIN_PHONE_DIGITS
          ? sql`${customers.phoneE164} like ${`%${digits}%`}`
          : undefined,
      )
    : undefined;
  const page =
    !term && after
      ? sql`(${customers.name}, ${customers.id}) > (${after.name}, ${after.id}::uuid)`
      : undefined;
  return db
    .select()
    .from(customers)
    .where(
      tenantScope(
        ctx,
        customers,
        archivedOnly
          ? isNotNull(customers.archivedAt)
          : includeArchived
            ? undefined
            : isNull(customers.archivedAt),
        and(matches, page),
      ),
    )
    .orderBy(
      ...(term ? [desc(sql`word_similarity(${term}, ${customers.name})`)] : []),
      asc(customers.name),
      asc(customers.id),
    )
    .limit(limit);
}
