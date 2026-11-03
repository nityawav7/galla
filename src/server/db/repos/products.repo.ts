import { asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import { type TenantContext } from "@/server/authz/context";

import { products } from "../schema";
import { type Executor } from "../transaction";
import { escapeLike, FUZZY_MATCH_THRESHOLD, type TenantOwned, tenantScope } from "./tenant";

export type Product = typeof products.$inferSelect;
export type NewProduct = Omit<typeof products.$inferInsert, TenantOwned | "archivedAt">;
export type ProductPatch = Partial<NewProduct>;

export interface ListProductsOptions {
  /** Fuzzy match on the name (pg_trgm), best match first. */
  search?: string;
  includeArchived?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export async function insertProduct(
  db: Executor,
  ctx: TenantContext,
  input: NewProduct,
): Promise<Product> {
  const [row] = await db
    .insert(products)
    .values({ ...input, businessId: ctx.businessId, createdBy: ctx.userId })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function findProductById(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Product | undefined> {
  const [row] = await db
    .select()
    .from(products)
    .where(tenantScope(ctx, products, eq(products.id, id)));
  return row;
}

export async function updateProduct(
  db: Executor,
  ctx: TenantContext,
  id: string,
  patch: ProductPatch,
): Promise<Product | undefined> {
  const [row] = await db
    .update(products)
    // Re-asserting the tenant keeps a stray `businessId` in the patch from moving the row.
    .set({ ...patch, businessId: ctx.businessId })
    .where(tenantScope(ctx, products, eq(products.id, id)))
    .returning();
  return row;
}

/** Products used on invoices are archived, never deleted (SPEC F2). */
export async function archiveProduct(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Product | undefined> {
  const [row] = await db
    .update(products)
    .set({ archivedAt: new Date() })
    .where(tenantScope(ctx, products, eq(products.id, id), isNull(products.archivedAt)))
    .returning();
  return row;
}

export async function listProducts(
  db: Executor,
  ctx: TenantContext,
  { search, includeArchived = false, limit = DEFAULT_LIMIT }: ListProductsOptions = {},
): Promise<Product[]> {
  const term = search?.trim();
  const matches = term
    ? or(
        sql`${products.name} ilike ${`%${escapeLike(term)}%`}`,
        sql`word_similarity(${term}, ${products.name}) >= ${FUZZY_MATCH_THRESHOLD}`,
      )
    : undefined;
  return db
    .select()
    .from(products)
    .where(
      tenantScope(
        ctx,
        products,
        includeArchived ? undefined : isNull(products.archivedAt),
        matches,
      ),
    )
    .orderBy(
      ...(term ? [desc(sql`word_similarity(${term}, ${products.name})`)] : []),
      asc(products.name),
      asc(products.id),
    )
    .limit(limit);
}
